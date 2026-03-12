import frappe
from frappe.utils import now, flt


def get_context(context):
    context.no_cache = 1


@frappe.whitelist()
def get_dashboard_kpi(program=None, course=None):
    _check_admin()

    def _lesson_sub(params, tag):
        if course:
            params[f"course_{tag}"] = course
            return f"""lesson IN (
                SELECT l.name FROM `tabLMS Lesson` l
                JOIN `tabLMS Section` s ON s.name = l.section
                WHERE s.course = %(course_{tag})s)"""
        if program:
            params[f"prog_{tag}"] = program
            return f"""lesson IN (
                SELECT l.name FROM `tabLMS Lesson` l
                JOIN `tabLMS Section` s ON s.name = l.section
                JOIN `tabLMS Course` c ON c.name = s.course
                WHERE c.program = %(prog_{tag})s)"""
        return "1=1"

    total_students = 0
    try:
        p = {}
        w = "e.status = 'Active'"
        if course:
            p["enr_course"] = course
            w += " AND e.course = %(enr_course)s"
        elif program:
            p["enr_prog"] = program
            w += " AND e.course IN (SELECT name FROM `tabLMS Course` WHERE program = %(enr_prog)s)"
        res = frappe.db.sql(f"SELECT COUNT(DISTINCT e.student) AS cnt FROM `tabLMS Enrollment` e WHERE {w}", p, as_dict=True)
        total_students = int((res[0].cnt if res else 0) or 0)
    except Exception as exc:
        frappe.log_error(f"KPI#1 error: {exc}", "Dashboard KPI")

    completed_courses = 0
    try:
        p = {}
        w = "e.status = 'Completed'"
        if course:
            p["comp_course"] = course
            w += " AND e.course = %(comp_course)s"
        elif program:
            p["comp_prog"] = program
            w += " AND e.course IN (SELECT name FROM `tabLMS Course` WHERE program = %(comp_prog)s)"
        res = frappe.db.sql(f"SELECT COUNT(*) AS cnt FROM `tabLMS Enrollment` e WHERE {w}", p, as_dict=True)
        completed_courses = int((res[0].cnt if res else 0) or 0)
    except Exception as exc:
        frappe.log_error(f"KPI#2 error: {exc}", "Dashboard KPI")

    pending_assignments = 0
    try:
        p = {}
        w = _lesson_sub(p, "asgn")
        res = frappe.db.sql(f"SELECT COUNT(*) AS cnt FROM `tabLMS Assignment Submission` WHERE status = 'Pending' AND {w}", p, as_dict=True)
        pending_assignments = int((res[0].cnt if res else 0) or 0)
    except Exception as exc:
        frappe.log_error(f"KPI#3 error: {exc}", "Dashboard KPI")

    avg_quiz = 0.0
    try:
        p = {}
        w = _lesson_sub(p, "quiz")
        res = frappe.db.sql(f"SELECT ROUND(AVG(score), 1) AS avg_score FROM `tabLMS Quiz Attempt` WHERE {w}", p, as_dict=True)
        avg_quiz = flt((res[0].avg_score if res else None) or 0, 1)
    except Exception as exc:
        frappe.log_error(f"KPI#4 error: {exc}", "Dashboard KPI")

    # NEW: pending open answers
    pending_open_answers = 0
    try:
        res = frappe.db.sql(
            "SELECT COUNT(*) AS cnt FROM `tabLMS Open Answer` WHERE status = 'Pending'",
            as_dict=True
        )
        pending_open_answers = int((res[0].cnt if res else 0) or 0)
    except Exception as exc:
        frappe.log_error(f"KPI#5 error: {exc}", "Dashboard KPI")

    return {
        "total_students":        total_students,
        "completed_courses":     completed_courses,
        "pending_assignments":   pending_assignments,
        "avg_quiz_score":        avg_quiz,
        "pending_open_answers":  pending_open_answers,
    }


@frappe.whitelist()
def get_dashboard_stats(program=None, course=None):
    return get_dashboard_kpi(program=program, course=course)


@frappe.whitelist()
def get_employee_progress_list(program=None, course=None, employee=None, page=1, page_size=20):
    _check_admin()
    page      = int(page)
    page_size = int(page_size)
    offset    = (page - 1) * page_size

    enr_where  = ["e.status = 'Active'"]
    enr_params = {}
    if course:
        enr_where.append("e.course = %(course)s")
        enr_params["course"] = course
    elif program:
        enr_where.append("e.course IN (SELECT name FROM `tabLMS Course` WHERE program = %(program)s)")
        enr_params["program"] = program
    if employee:
        enr_where.append("emp.name = %(employee)s")
        enr_params["employee"] = employee

    enr_where_sql = " AND ".join(enr_where)

    total = 0
    try:
        cnt = frappe.db.sql(
            f"""SELECT COUNT(DISTINCT emp.name) AS cnt
                FROM `tabLMS Enrollment` e
                JOIN `tabEmployee` emp ON emp.user_id = e.student
                WHERE {enr_where_sql}""",
            enr_params, as_dict=True
        )
        total = int((cnt[0].cnt if cnt else 0) or 0)
    except Exception as ex:
        frappe.log_error(f"[LMS][get_employee_progress_list] COUNT: {ex}", "LMS Error")
        return {"data": [], "total": 0}

    if total == 0:
        return {"data": [], "total": 0}

    try:
        emp_rows = frappe.db.sql(
            f"""SELECT DISTINCT emp.name, emp.employee_name, emp.department, emp.user_id
                FROM `tabLMS Enrollment` e
                JOIN `tabEmployee` emp ON emp.user_id = e.student
                WHERE {enr_where_sql}
                ORDER BY emp.employee_name ASC
                LIMIT %(page_size)s OFFSET %(offset)s""",
            {**enr_params, "page_size": page_size, "offset": offset},
            as_dict=True
        )
    except Exception as ex:
        frappe.log_error(f"[LMS][get_employee_progress_list] EMP: {ex}", "LMS Error")
        return {"data": [], "total": total}

    all_emp_ids = [e.name for e in emp_rows]
    if not all_emp_ids:
        return {"data": [], "total": total}

    enr_counts = {}
    try:
        rows = frappe.db.sql(
            """SELECT emp.name AS emp_id, COUNT(DISTINCT e.name) AS enrolled_count
               FROM `tabLMS Enrollment` e
               JOIN `tabEmployee` emp ON emp.user_id = e.student
               WHERE emp.name IN %(emp_ids)s AND e.status = 'Active'
               GROUP BY emp.name""",
            {"emp_ids": all_emp_ids}, as_dict=True
        )
        enr_counts = {r.emp_id: int(r.enrolled_count or 0) for r in rows}
    except Exception as ex:
        frappe.log_error(f"[LMS][get_employee_progress_list] ENR: {ex}", "LMS Error")

    prog_data = {}
    try:
        rows = frappe.db.sql(
            """SELECT employee, COUNT(*) AS total, SUM(is_completed) AS completed,
                      ROUND(AVG(completion_percent), 1) AS avg_pct
               FROM `tabLMS Lesson Progress`
               WHERE employee IN %(emp_ids)s
               GROUP BY employee""",
            {"emp_ids": all_emp_ids}, as_dict=True
        )
        prog_data = {r.employee: r for r in rows}
    except Exception as ex:
        frappe.log_error(f"[LMS][get_employee_progress_list] PROG: {ex}", "LMS Error")

    quiz_data = {}
    try:
        rows = frappe.db.sql(
            """SELECT employee, ROUND(AVG(percentage), 1) AS avg_score,
                      SUM(passed) AS passed_count, COUNT(*) AS total_attempts
               FROM `tabLMS Quiz Attempt`
               WHERE employee IN %(emp_ids)s
               GROUP BY employee""",
            {"emp_ids": all_emp_ids}, as_dict=True
        )
        quiz_data = {r.employee: r for r in rows}
    except Exception as ex:
        frappe.log_error(f"[LMS][get_employee_progress_list] QUIZ: {ex}", "LMS Error")

    assign_data = {}
    try:
        rows = frappe.db.sql(
            """SELECT employee,
                      SUM(status = 'Pending')  AS pending,
                      SUM(status = 'Approved') AS approved,
                      SUM(status = 'Rejected') AS rejected
               FROM `tabLMS Assignment Submission`
               WHERE employee IN %(emp_ids)s
               GROUP BY employee""",
            {"emp_ids": all_emp_ids}, as_dict=True
        )
        assign_data = {r.employee: r for r in rows}
    except Exception as ex:
        frappe.log_error(f"[LMS][get_employee_progress_list] ASGN: {ex}", "LMS Error")

    # NEW: open answer aggregated
    oa_data = {}
    try:
        rows = frappe.db.sql(
            """SELECT employee,
                      SUM(status = 'Pending') AS oa_pending,
                      SUM(status = 'Graded')  AS oa_graded,
                      COUNT(*)                AS oa_total
               FROM `tabLMS Open Answer`
               WHERE employee IN %(emp_ids)s
               GROUP BY employee""",
            {"emp_ids": all_emp_ids}, as_dict=True
        )
        oa_data = {r.employee: r for r in rows}
    except Exception as ex:
        frappe.log_error(f"[LMS][get_employee_progress_list] OA: {ex}", "LMS Error")

    result = []
    for emp in emp_rows:
        p = prog_data.get(emp.name, {})
        q = quiz_data.get(emp.name, {})
        a = assign_data.get(emp.name, {})
        oa = oa_data.get(emp.name, {})
        result.append({
            "employee":          emp.name,
            "employee_name":     emp.employee_name,
            "department":        emp.department or "—",
            "enrolled_courses":  enr_counts.get(emp.name, 0),
            "total_lessons":     int(p.get("total") or 0),
            "completed_lessons": int(p.get("completed") or 0),
            "avg_progress":      flt(p.get("avg_pct") or 0, 1),
            "avg_quiz_score":    flt(q.get("avg_score") or 0, 1),
            "quiz_passed":       int(q.get("passed_count") or 0),
            "pending_assign":    int(a.get("pending") or 0),
            "approved_assign":   int(a.get("approved") or 0),
            "rejected_assign":   int(a.get("rejected") or 0),
            "oa_pending":        int(oa.get("oa_pending") or 0),
            "oa_graded":         int(oa.get("oa_graded") or 0),
            "oa_total":          int(oa.get("oa_total") or 0),
        })

    return {"data": result, "total": total}


@frappe.whitelist()
def get_assignments(status="Pending", program=None, course=None,
                    employee=None, page=1, page_size=20):
    _check_admin()
    page      = int(page)
    page_size = int(page_size)
    offset    = (page - 1) * page_size

    where_parts = ["1=1"]
    params      = {}

    if status and status != "All":
        where_parts.append("sub.status = %(status)s")
        params["status"] = status

    if employee:
        where_parts.append("sub.employee = %(employee)s")
        params["employee"] = employee

    if course:
        lesson_names = _get_course_lessons(course)
        if not lesson_names:
            return {"data": [], "total": 0}
        where_parts.append("sub.lesson IN %(course_lessons)s")
        params["course_lessons"] = lesson_names
    elif program:
        prog_courses = frappe.db.get_all("LMS Course", filters={"program": program}, pluck="name") or []
        if not prog_courses:
            return {"data": [], "total": 0}
        prog_lessons = list(_get_courses_lessons(prog_courses))
        if not prog_lessons:
            return {"data": [], "total": 0}
        where_parts.append("sub.lesson IN %(prog_lessons)s")
        params["prog_lessons"] = prog_lessons

    where_sql = " AND ".join(where_parts)

    total = 0
    try:
        cnt = frappe.db.sql(
            f"SELECT COUNT(*) AS cnt FROM `tabLMS Assignment Submission` sub WHERE {where_sql}",
            params, as_dict=True
        )
        total = int((cnt[0].cnt if cnt else 0) or 0)
    except Exception as e:
        frappe.log_error(f"[LMS][get_assignments] COUNT: {e}", "LMS Error")
        return {"data": [], "total": 0}

    if total == 0:
        return {"data": [], "total": 0}

    subs = []
    try:
        subs = frappe.db.sql(
            f"""SELECT sub.name, sub.employee, sub.lesson,
                       sub.submission_type, sub.attached_file,
                       sub.google_sheets_url, sub.status,
                       sub.submitted_on, sub.admin_score,
                       sub.admin_feedback, sub.reviewed_by, sub.reviewed_on
                FROM `tabLMS Assignment Submission` sub
                WHERE {where_sql}
                ORDER BY sub.submitted_on DESC
                LIMIT %(page_size)s OFFSET %(offset)s""",
            {**params, "page_size": page_size, "offset": offset},
            as_dict=True
        )
    except Exception as e:
        frappe.log_error(f"[LMS][get_assignments] DATA: {e}", "LMS Error")
        return {"data": [], "total": total}

    emp_ids = list({s.employee for s in subs if s.employee})
    emp_map = {}
    if emp_ids:
        try:
            rows = frappe.db.sql(
                "SELECT name, employee_name, department FROM `tabEmployee` WHERE name IN %(emp_ids)s",
                {"emp_ids": emp_ids}, as_dict=True
            )
            emp_map = {r.name: r for r in rows}
        except Exception as e:
            frappe.log_error(f"[LMS][get_assignments] EMP: {e}", "LMS Error")

    les_ids = list({s.lesson for s in subs if s.lesson})
    les_map = {}
    if les_ids:
        try:
            rows = frappe.db.sql(
                "SELECT name, lesson_title FROM `tabLMS Lesson` WHERE name IN %(les_ids)s",
                {"les_ids": les_ids}, as_dict=True
            )
            les_map = {r.name: r for r in rows}
        except Exception as e:
            frappe.log_error(f"[LMS][get_assignments] LES: {e}", "LMS Error")

    enriched = []
    for s in subs:
        emp = emp_map.get(s.employee, {})
        les = les_map.get(s.lesson, {})
        enriched.append({
            "name":              s.name,
            "employee":          s.employee,
            "employee_name":     emp.get("employee_name") or s.employee,
            "department":        emp.get("department") or "—",
            "lesson":            s.lesson,
            "lesson_title":      les.get("lesson_title") or s.lesson,
            "submission_type":   s.submission_type,
            "attached_file":     s.attached_file,
            "google_sheets_url": s.google_sheets_url,
            "status":            s.status,
            "submitted_on":      str(s.submitted_on)[:16] if s.submitted_on else "—",
            "admin_score":       s.admin_score,
            "admin_feedback":    s.admin_feedback,
            "reviewed_by":       s.reviewed_by or None,
            "reviewed_on":       str(s.reviewed_on)[:16] if s.reviewed_on else None,
        })

    return {"data": enriched, "total": total}


@frappe.whitelist()
def review_assignment_admin(submission_id, status, score=0, feedback=""):
    _check_admin()
    _do_review(submission_id, status, score, feedback)
    return {"status": "ok"}


@frappe.whitelist()
def bulk_approve_assignments(submission_ids):
    _check_admin()
    if isinstance(submission_ids, str):
        import json
        try:
            ids = json.loads(submission_ids)
        except Exception:
            ids = [s.strip() for s in submission_ids.split(",") if s.strip()]
    else:
        ids = list(submission_ids)
    for sid in ids:
        _do_review(sid, "Approved", score=None, feedback="Bulk tasdiqlash")
    return {"approved": len(ids)}


@frappe.whitelist()
def get_filter_options():
    _check_admin()
    programs  = frappe.db.get_all("LMS Program",  fields=["name", "program_name"],  order_by="program_name asc")
    courses   = frappe.db.get_all("LMS Course",   fields=["name", "course_name", "program"], order_by="course_name asc")
    employees = frappe.db.get_all("Employee", filters={"status": "Active"},
                                  fields=["name", "employee_name", "department"], order_by="employee_name asc")
    return {"programs": programs, "courses": courses, "employees": employees}


# ─── NEW: Open Answer endpoints ───────────────────────────────────────────────

@frappe.whitelist()
def get_open_answers_admin(status="Pending", program=None, course=None,
                           employee=None, page=1, page_size=20):
    _check_admin()
    page      = int(page)
    page_size = int(page_size)
    offset    = (page - 1) * page_size

    where_parts = ["1=1"]
    params      = {}

    if status and status != "All":
        where_parts.append("oa.status = %(status)s")
        params["status"] = status

    if employee:
        where_parts.append("oa.employee = %(employee)s")
        params["employee"] = employee

    if course:
        lesson_names = _get_course_lessons(course)
        if not lesson_names:
            return {"data": [], "total": 0}
        where_parts.append("oa.lesson IN %(course_lessons)s")
        params["course_lessons"] = lesson_names
    elif program:
        prog_courses = frappe.db.get_all("LMS Course", filters={"program": program}, pluck="name") or []
        if not prog_courses:
            return {"data": [], "total": 0}
        prog_lessons = list(_get_courses_lessons(prog_courses))
        if not prog_lessons:
            return {"data": [], "total": 0}
        where_parts.append("oa.lesson IN %(prog_lessons)s")
        params["prog_lessons"] = prog_lessons

    where_sql = " AND ".join(where_parts)

    total = 0
    try:
        cnt = frappe.db.sql(
            f"SELECT COUNT(*) AS cnt FROM `tabLMS Open Answer` oa WHERE {where_sql}",
            params, as_dict=True
        )
        total = int((cnt[0].cnt if cnt else 0) or 0)
    except Exception as e:
        frappe.log_error(f"[LMS][get_open_answers_admin] COUNT: {e}", "LMS Error")
        return {"data": [], "total": 0}

    if total == 0:
        return {"data": [], "total": 0}

    rows = []
    try:
        rows = frappe.db.sql(
            f"""SELECT
                    oa.name, oa.employee, oa.lesson, oa.question_item,
                    oa.answer_text, oa.is_auto_graded, oa.score,
                    oa.status, oa.admin_feedback, oa.submitted_on,
                    oa.graded_by, oa.graded_on,
                    l.lesson_title,
                    oqi.question_text, oqi.question_type,
                    oqi.correct_answer, oqi.marks,
                    c.name AS course_id, c.course_name,
                    emp.employee_name, emp.department
                FROM `tabLMS Open Answer`          oa
                JOIN `tabLMS Lesson`               l   ON l.name   = oa.lesson
                JOIN `tabLMS Section`              s   ON s.name   = l.section
                JOIN `tabLMS Course`               c   ON c.name   = s.course
                LEFT JOIN `tabLMS Open Question Item` oqi ON oqi.name = oa.question_item
                LEFT JOIN `tabEmployee`            emp ON emp.name = oa.employee
                WHERE {where_sql}
                ORDER BY FIELD(oa.status,'Pending','Graded'), oa.submitted_on DESC
                LIMIT %(page_size)s OFFSET %(offset)s""",
            {**params, "page_size": page_size, "offset": offset},
            as_dict=True
        )
    except Exception as e:
        frappe.log_error(f"[LMS][get_open_answers_admin] DATA: {e}", "LMS Error")
        return {"data": [], "total": total}

    enriched = [{
        "name":           r.name,
        "employee":       r.employee or "",
        "employee_name":  r.employee_name or r.employee or "",
        "department":     r.department or "—",
        "lesson":         r.lesson or "",
        "lesson_title":   r.lesson_title or "",
        "course_id":      r.course_id or "",
        "course_name":    r.course_name or "",
        "question_item":  r.question_item or "",
        "question_text":  r.question_text or "",
        "question_type":  r.question_type or "Manual",
        "correct_answer": r.correct_answer or "",
        "marks":          flt(r.marks or 0),
        "answer_text":    r.answer_text or "",
        "is_auto_graded": int(r.is_auto_graded or 0),
        "score":          flt(r.score or 0, 1),
        "status":         r.status or "Pending",
        "admin_feedback": r.admin_feedback or "",
        "submitted_on":   str(r.submitted_on)[:16] if r.submitted_on else "—",
        "graded_by":      r.graded_by or "",
        "graded_on":      str(r.graded_on)[:16] if r.graded_on else "",
    } for r in rows]

    return {"data": enriched, "total": total}


@frappe.whitelist()
def grade_open_answer(answer_id, score, feedback=""):
    _check_admin()
    if not answer_id:
        frappe.throw("answer_id talab qilinadi.")

    score = flt(score)
    q_item = frappe.db.get_value("LMS Open Answer", answer_id, "question_item")
    if q_item:
        max_marks = flt(frappe.db.get_value("LMS Open Question Item", q_item, "marks") or 0)
        if score > max_marks:
            frappe.throw(f"Ball maksimal balldan ({max_marks}) oshmasligi kerak.")

    frappe.db.set_value("LMS Open Answer", answer_id, {
        "score":          score,
        "admin_feedback": feedback,
        "status":         "Graded",
        "is_auto_graded": 0,
        "graded_by":      frappe.session.user,
        "graded_on":      now(),
    })

    try:
        emp_id = frappe.db.get_value("LMS Open Answer", answer_id, "employee")
        if emp_id:
            user_id = frappe.db.get_value("Employee", emp_id, "user_id")
            if user_id:
                frappe.publish_realtime(
                    "open_answer_graded",
                    {"message": f"Ochiq savol baholandi. Ball: {score}", "feedback": feedback},
                    user=user_id
                )
    except Exception:
        pass

    return {"status": "ok", "score": score}


@frappe.whitelist()
def get_employee_open_answers(employee):
    _check_admin()
    if not employee:
        return []
    try:
        rows = frappe.db.sql(
            """SELECT
                oa.name, oa.lesson, l.lesson_title, c.course_name,
                oqi.question_text, oqi.question_type, oqi.correct_answer, oqi.marks,
                oa.answer_text, oa.is_auto_graded, oa.score,
                oa.status, oa.admin_feedback, oa.submitted_on,
                oa.graded_by, oa.graded_on
            FROM `tabLMS Open Answer`          oa
            JOIN `tabLMS Lesson`               l   ON l.name   = oa.lesson
            JOIN `tabLMS Section`              s   ON s.name   = l.section
            JOIN `tabLMS Course`               c   ON c.name   = s.course
            LEFT JOIN `tabLMS Open Question Item` oqi ON oqi.name = oa.question_item
            WHERE oa.employee = %(emp)s
            ORDER BY oa.submitted_on DESC""",
            {"emp": employee}, as_dict=True
        )
    except Exception as e:
        frappe.log_error(f"[LMS][get_employee_open_answers]: {e}", "LMS Error")
        return []

    return [{
        "name":           r.name,
        "lesson":         r.lesson or "",
        "lesson_title":   r.lesson_title or "",
        "course_name":    r.course_name or "",
        "question_text":  r.question_text or "",
        "question_type":  r.question_type or "Manual",
        "correct_answer": r.correct_answer or "",
        "marks":          flt(r.marks or 0),
        "answer_text":    r.answer_text or "",
        "is_auto_graded": int(r.is_auto_graded or 0),
        "score":          flt(r.score or 0, 1),
        "status":         r.status or "Pending",
        "admin_feedback": r.admin_feedback or "",
        "submitted_on":   str(r.submitted_on)[:16] if r.submitted_on else "—",
        "graded_by":      r.graded_by or "",
        "graded_on":      str(r.graded_on)[:16] if r.graded_on else "",
    } for r in rows]


# ─── Full Profile (unchanged core, open answers added lazily via separate endpoint) ─

import frappe
from frappe.utils import now, flt
from datetime import datetime, timedelta
import json


# ══════════════════════════════════════════════════════════════════════════════
#  ENHANCED: get_employee_full_profile
#  Primary time source: LMS Time Log (session_start, session_end, duration_sec)
#  Fallback: LMS Lesson Progress.session_logs JSON
# ══════════════════════════════════════════════════════════════════════════════

@frappe.whitelist()
def get_employee_full_profile(employee):
    _check_admin()
    if not employee:
        return {}

    # ── Q1: Employee info + enrollments ──────────────────────────────────────
    emp_rows = frappe.db.sql(
        """SELECT e.name, e.employee_name, e.department,
                  e.designation, e.image, e.user_id, e.date_of_joining
           FROM `tabEmployee` e WHERE e.name = %(emp)s LIMIT 1""",
        {"emp": employee}, as_dict=True
    )
    if not emp_rows:
        return {}
    q1_emp = emp_rows[0]

    enr_rows = frappe.db.sql(
        """SELECT enr.name AS enrollment_id, enr.course, c.course_name,
                  enr.status AS enrollment_status, enr.creation AS enrolled_on
           FROM `tabLMS Enrollment` enr
           JOIN `tabLMS Course` c ON c.name = enr.course
           WHERE enr.student = %(user_id)s ORDER BY enr.creation ASC""",
        {"user_id": q1_emp.user_id or ""}, as_dict=True
    )
    q1_enrollments = enr_rows or []

    if not q1_enrollments:
        return {
            "employee_info": _emp_info_dict(q1_emp),
            "summary": _empty_summary(),
            "courses": [], "quiz_details": [],
            "time_analytics": _empty_time_analytics(),
            "activity_feed": [],
        }

    course_ids = list({r.course for r in q1_enrollments})

    # ── Q2: Lesson Progress ───────────────────────────────────────────────────
    q2_progress = frappe.db.sql(
        """SELECT lp.name AS progress_id, lp.lesson, lp.watch_time_sec,
                  lp.last_position_sec, lp.completion_percent, lp.is_completed,
                  lp.completed_on, lp.skip_attempts, lp.session_logs,
                  l.lesson_title, l.video_duration_sec, l.minimum_watch_percent,
                  l.has_quiz, l.quiz, l.has_assignment, l.order_index,
                  s.course AS lesson_course
           FROM `tabLMS Lesson Progress` lp
           JOIN `tabLMS Lesson` l ON l.name = lp.lesson
           JOIN `tabLMS Section` s ON s.name = l.section
           WHERE lp.employee = %(emp)s
           ORDER BY s.course ASC, l.order_index ASC""",
        {"emp": employee}, as_dict=True
    ) or []

    # ── Q2b: All lessons in enrolled courses ──────────────────────────────────
    q2_all_lessons = frappe.db.sql(
        """SELECT l.name AS lesson, l.lesson_title, l.video_duration_sec,
                  l.minimum_watch_percent, l.has_quiz, l.quiz,
                  l.has_assignment, l.order_index, s.course AS lesson_course
           FROM `tabLMS Lesson` l
           JOIN `tabLMS Section` s ON s.name = l.section
           WHERE s.course IN %(course_ids)s
           ORDER BY s.course ASC, l.order_index ASC""",
        {"course_ids": course_ids}, as_dict=True
    ) or []

    progress_by_lesson = {r.lesson: r for r in q2_progress}

    # ── Q3: Assignment Submissions ────────────────────────────────────────────
    q3_assignments = frappe.db.sql(
        """SELECT sub.name AS submission_id, sub.lesson, sub.submission_type,
                  sub.attached_file, sub.google_sheets_url, sub.status,
                  sub.admin_score, sub.admin_feedback, sub.submitted_on,
                  sub.reviewed_by, sub.reviewed_on, l.lesson_title
           FROM `tabLMS Assignment Submission` sub
           JOIN `tabLMS Lesson` l ON l.name = sub.lesson
           WHERE sub.employee = %(emp)s ORDER BY sub.submitted_on DESC""",
        {"emp": employee}, as_dict=True
    ) or []
    assign_by_lesson = {r.lesson: r for r in q3_assignments}

    # ── Q4: Quiz Attempts ─────────────────────────────────────────────────────
    q4_attempts = frappe.db.sql(
        """SELECT qa.name AS attempt_id, qa.quiz, qa.lesson, qa.attempt_number,
                  qa.score, qa.total_marks, qa.percentage, qa.passed, qa.answers,
                  qa.started_at, qa.submitted_at, qa.time_taken_sec,
                  qa.creation AS attempted_on, qz.quiz_title AS quiz_name, qz.passing_score,
                  l.lesson_title
           FROM `tabLMS Quiz Attempt` qa
           JOIN `tabLMS Quiz` qz ON qz.name = qa.quiz
           JOIN `tabLMS Lesson` l ON l.name = qa.lesson
           WHERE qa.employee = %(emp)s ORDER BY qa.quiz ASC, qa.attempt_number ASC""",
        {"emp": employee}, as_dict=True
    ) or []

    # ── Q5: Quiz Options (for answer decoding) ────────────────────────────────
    attempted_quiz_ids = list({a.quiz for a in q4_attempts}) if q4_attempts else []
    q5_options = []
    if attempted_quiz_ids:
        q5_options = frappe.db.sql(
            """SELECT ao.name, ao.parent AS question_id, ao.option_text,
                      ao.is_correct, ao.idx, qq.parent AS quiz_id,
                      qq.question AS question_text, qq.idx AS question_idx
               FROM `tabLMS Answer Option` ao
               JOIN `tabLMS Quiz Question` qq ON qq.name = ao.parent
               WHERE qq.parent IN %(quiz_ids)s
               ORDER BY qq.idx ASC, ao.idx ASC""",
            {"quiz_ids": attempted_quiz_ids}, as_dict=True
        ) or []

    # ── Q6: LMS Time Log (PRIMARY time source) ────────────────────────────────
    time_logs = frappe.db.sql(
        """SELECT tl.name, tl.lesson, tl.course, tl.activity_type,
                  tl.session_start, tl.session_end, tl.duration_sec,
                  tl.end_reason, tl.is_completed_session,
                  l.lesson_title, c.course_name
           FROM `tabLMS Time Log` tl
           LEFT JOIN `tabLMS Lesson` l ON l.name = tl.lesson
           LEFT JOIN `tabLMS Course` c ON c.name = tl.course
           WHERE tl.employee = %(emp)s
             AND tl.duration_sec > 0
           ORDER BY tl.session_start DESC""",
        {"emp": employee}, as_dict=True
    ) or []

    # ── Q7: Open Answers ──────────────────────────────────────────────────────
    open_answers = frappe.db.sql(
        """SELECT oa.name, oa.lesson, oa.question_item, oa.answer_text,
                  oa.is_auto_graded, oa.score, oa.status, oa.admin_feedback,
                  oa.submitted_on, oa.graded_by, oa.graded_on,
                  l.lesson_title,
                  oqi.question_text, oqi.question_type, oqi.correct_answer, oqi.marks,
                  s.course, c.course_name
           FROM `tabLMS Open Answer` oa
           JOIN `tabLMS Lesson` l ON l.name = oa.lesson
           JOIN `tabLMS Section` s ON s.name = l.section
           JOIN `tabLMS Course` c ON c.name = s.course
           LEFT JOIN `tabLMS Open Question Item` oqi ON oqi.name = oa.question_item
           WHERE oa.employee = %(emp)s
           ORDER BY oa.submitted_on DESC""",
        {"emp": employee}, as_dict=True
    ) or []

    # ── Build quiz details ────────────────────────────────────────────────────
    options_by_question = {}
    questions_by_quiz   = {}
    for o in q5_options:
        options_by_question.setdefault(o.question_id, []).append(o)
        questions_by_quiz.setdefault(o.quiz_id, {}).setdefault(
            o.question_id, {"text": o.question_text, "idx": o.question_idx}
        )
    for qid in options_by_question:
        options_by_question[qid].sort(key=lambda x: x.idx)

    quiz_details = _resolve_quiz_answers(q4_attempts, options_by_question, questions_by_quiz)

    quiz_summary_by_lesson = {}
    for quiz_id, qd in quiz_details.items():
        lesson_id = qd["lesson"]
        attempts  = qd["attempts"]
        if not attempts:
            continue
        percentages = [flt(a["percentage"]) for a in attempts]
        quiz_summary_by_lesson[lesson_id] = {
            "total_attempts":  len(attempts),
            "best_percentage": flt(max(percentages), 1),
            "last_percentage": flt(percentages[-1], 1),
            "passed":          any(a["passed"] for a in attempts),
        }

    # ── Build courses output ──────────────────────────────────────────────────
    all_lessons_by_course = {}
    for l in q2_all_lessons:
        all_lessons_by_course.setdefault(l.lesson_course, []).append(l)

    courses_out = []
    total_watch_sec_all = 0

    for enr in q1_enrollments:
        course_lessons    = all_lessons_by_course.get(enr.course, [])
        total_lessons     = len(course_lessons)
        completed_lessons = 0
        course_watch_sec  = 0
        lessons_out       = []

        for l in course_lessons:
            prog       = progress_by_lesson.get(l.lesson)
            watch_sec  = int((prog.watch_time_sec if prog else None) or 0)
            comp_pct   = flt((prog.completion_percent if prog else None) or 0, 1)
            is_comp    = int((prog.is_completed if prog else None) or 0)
            comp_on    = str(prog.completed_on)[:16] if (prog and prog.completed_on) else None

            if is_comp:
                completed_lessons += 1
            course_watch_sec += watch_sec

            asgn_out = None
            if l.has_assignment:
                asgn = assign_by_lesson.get(l.lesson)
                if asgn:
                    asgn_out = {
                        "submission_id":     asgn.submission_id,
                        "submission_type":   asgn.submission_type,
                        "attached_file":     asgn.attached_file,
                        "google_sheets_url": asgn.google_sheets_url,
                        "status":            asgn.status,
                        "admin_score":       flt(asgn.admin_score) if asgn.admin_score is not None else None,
                        "admin_feedback":    asgn.admin_feedback,
                        "submitted_on":      str(asgn.submitted_on)[:16] if asgn.submitted_on else None,
                        "reviewed_by":       asgn.reviewed_by or None,
                        "reviewed_on":       str(asgn.reviewed_on)[:16] if asgn.reviewed_on else None,
                    }

            qs_out = None
            if l.has_quiz:
                qs_out = quiz_summary_by_lesson.get(l.lesson)

            lessons_out.append({
                "lesson":             l.lesson,
                "lesson_title":       l.lesson_title,
                "video_duration_sec": int(l.video_duration_sec or 0),
                "order_index":        int(l.order_index or 0),
                "watch_time_sec":     watch_sec,
                "completion_percent": comp_pct,
                "is_completed":       is_comp,
                "completed_on":       comp_on,
                "assignment":         asgn_out,
                "quiz_summary":       qs_out,
            })

        prog_pct = flt((completed_lessons / total_lessons * 100) if total_lessons else 0, 1)
        total_watch_sec_all += course_watch_sec

        courses_out.append({
            "enrollment_id":     enr.enrollment_id,
            "course":            enr.course,
            "course_name":       enr.course_name,
            "enrollment_status": enr.enrollment_status,
            "enrolled_on":       str(enr.enrolled_on)[:10] if enr.enrolled_on else None,
            "total_lessons":     total_lessons,
            "completed_lessons": completed_lessons,
            "progress_pct":      prog_pct,
            "total_watch_sec":   course_watch_sec,
            "lessons":           lessons_out,
        })

    # ── Summary ───────────────────────────────────────────────────────────────
    all_percentages = [flt(a["percentage"]) for qd in quiz_details.values() for a in qd["attempts"]]
    total_timelog_sec = sum(int(tl.duration_sec or 0) for tl in time_logs)
    effective_watch   = total_timelog_sec if total_timelog_sec > 0 else total_watch_sec_all

    summary = {
        "total_courses":        len(q1_enrollments),
        "completed_courses":    sum(1 for e in q1_enrollments if e.enrollment_status == "Completed"),
        "total_watch_hours":    flt(effective_watch / 3600, 1),
        "avg_quiz_score":       flt(sum(all_percentages) / len(all_percentages) if all_percentages else 0, 1),
        "best_quiz_score":      flt(max(all_percentages) if all_percentages else 0, 1),
        "total_assignments":    len(q3_assignments),
        "approved_assignments": sum(1 for a in q3_assignments if a.status == "Approved"),
        "pending_assignments":  sum(1 for a in q3_assignments if a.status == "Pending"),
        "certificates_count":   sum(1 for e in q1_enrollments if e.enrollment_status == "Completed"),
        "total_sessions":       len(time_logs),
        "open_answers_total":   len(open_answers),
        "open_answers_graded":  sum(1 for a in open_answers if a.status == "Graded"),
        "open_answers_pending": sum(1 for a in open_answers if a.status == "Pending"),
    }

    # ── Time Analytics (LMS Time Log primary) ─────────────────────────────────
    time_analytics = _build_time_analytics_v2(time_logs, q2_progress, courses_out)

    # ── Activity Feed (last 30 events) ────────────────────────────────────────
    activity_feed = _build_activity_feed(time_logs, q3_assignments, q4_attempts, open_answers)

    # ── Open Answers output ───────────────────────────────────────────────────
    oa_out = [{
        "name":           r.name,
        "lesson":         r.lesson or "",
        "lesson_title":   r.lesson_title or "",
        "course":         r.course or "",
        "course_name":    r.course_name or "",
        "question_text":  r.question_text or "",
        "question_type":  r.question_type or "Manual",
        "correct_answer": r.correct_answer or "",
        "marks":          flt(r.marks or 0),
        "answer_text":    r.answer_text or "",
        "is_auto_graded": int(r.is_auto_graded or 0),
        "score":          flt(r.score or 0, 1),
        "status":         r.status or "Pending",
        "admin_feedback": r.admin_feedback or "",
        "submitted_on":   str(r.submitted_on)[:16] if r.submitted_on else "—",
        "graded_by":      r.graded_by or "",
        "graded_on":      str(r.graded_on)[:16] if r.graded_on else "",
    } for r in open_answers]

    return {
        "employee_info":   _emp_info_dict(q1_emp),
        "summary":         summary,
        "courses":         courses_out,
        "quiz_details":    list(quiz_details.values()),
        "time_analytics":  time_analytics,
        "activity_feed":   activity_feed,
        "open_answers":    oa_out,
    }


# ══════════════════════════════════════════════════════════════════════════════
#  TIME ANALYTICS v2 — LMS Time Log primary
# ══════════════════════════════════════════════════════════════════════════════

def _build_time_analytics_v2(time_logs, progress_rows, courses_out):
    today = datetime.today()

    # ── From LMS Time Log ─────────────────────────────────────────────────────
    daily_sec    = {}
    monthly_sec  = {}
    weekly_sec   = {}
    yearly_sec   = {}
    by_type_sec  = {}   # {activity_type: total_sec}
    by_course_sec = {}  # {course: total_sec}
    by_lesson_sec = {}  # {lesson: total_sec}
    last_activity = None
    session_history = []

    data_source = "none"

    for tl in time_logs:
        dur = int(tl.duration_sec or 0)
        if dur <= 0:
            continue

        ts_raw = tl.session_start
        if not ts_raw:
            continue

        try:
            dt  = datetime.fromisoformat(str(ts_raw)[:19])
        except Exception:
            continue

        date  = dt.strftime("%Y-%m-%d")
        month = dt.strftime("%Y-%m")
        year  = dt.strftime("%Y")
        # ISO week
        week  = dt.strftime("%Y-W%W")

        daily_sec[date]   = daily_sec.get(date, 0)   + dur
        monthly_sec[month] = monthly_sec.get(month, 0) + dur
        weekly_sec[week]  = weekly_sec.get(week, 0)  + dur
        yearly_sec[year]  = yearly_sec.get(year, 0)  + dur

        act_type = tl.activity_type or "Video"
        by_type_sec[act_type] = by_type_sec.get(act_type, 0) + dur

        course_id = tl.course or ""
        if course_id:
            by_course_sec[course_id] = {
                "sec":  by_course_sec.get(course_id, {}).get("sec", 0) + dur,
                "name": tl.course_name or course_id,
            }

        lesson_id = tl.lesson or ""
        if lesson_id:
            by_lesson_sec[lesson_id] = {
                "sec":   by_lesson_sec.get(lesson_id, {}).get("sec", 0) + dur,
                "title": tl.lesson_title or lesson_id,
            }

        if last_activity is None:
            last_activity = {
                "ts":           str(ts_raw)[:16],
                "lesson_title": tl.lesson_title or "",
                "course_name":  tl.course_name or "",
                "activity_type": act_type,
                "duration_sec": dur,
            }

        # Recent sessions (last 20)
        if len(session_history) < 20:
            session_history.append({
                "date":          date,
                "lesson_title":  tl.lesson_title or "",
                "course_name":   tl.course_name or "",
                "activity_type": act_type,
                "duration_min":  round(dur / 60, 1),
                "end_reason":    tl.end_reason or "",
                "completed":     int(tl.is_completed_session or 0),
                "session_start": str(ts_raw)[:16],
                "session_end":   str(tl.session_end)[:16] if tl.session_end else "",
            })

        data_source = "time_log"

    # ── Fallback to session_logs JSON if no Time Log entries ─────────────────
    if data_source == "none":
        for row in (progress_rows or []):
            raw = row.session_logs
            if not raw:
                continue
            try:
                logs = json.loads(raw) if isinstance(raw, str) else (raw or [])
            except Exception:
                logs = []
            for entry in (logs or []):
                ts_str = entry.get("ts", "")
                dur    = int(entry.get("dur", 0) or 0)
                if not ts_str or dur <= 0:
                    continue
                try:
                    dt    = datetime.fromisoformat(ts_str[:19])
                    date  = dt.strftime("%Y-%m-%d")
                    month = dt.strftime("%Y-%m")
                    year  = dt.strftime("%Y")
                    week  = dt.strftime("%Y-W%W")
                    daily_sec[date]    = daily_sec.get(date, 0)    + dur
                    monthly_sec[month] = monthly_sec.get(month, 0) + dur
                    weekly_sec[week]   = weekly_sec.get(week, 0)   + dur
                    yearly_sec[year]   = yearly_sec.get(year, 0)   + dur
                    data_source = "session_logs"
                except Exception:
                    continue

    # ── Build 365-day heatmap ─────────────────────────────────────────────────
    heatmap = []
    for i in range(364, -1, -1):
        d    = today - timedelta(days=i)
        date = d.strftime("%Y-%m-%d")
        heatmap.append({
            "date":    date,
            "minutes": round(daily_sec.get(date, 0) / 60, 1),
            "dow":     d.weekday(),
        })

    # ── Daily: last 30 days ────────────────────────────────────────────────────
    daily_out = []
    for i in range(29, -1, -1):
        d    = today - timedelta(days=i)
        date = d.strftime("%Y-%m-%d")
        daily_out.append({
            "date":    date,
            "minutes": round(daily_sec.get(date, 0) / 60, 1),
        })

    # ── Monthly: last 12 months ────────────────────────────────────────────────
    monthly_out = []
    for i in range(11, -1, -1):
        mo_dt = (today.replace(day=1) - timedelta(days=i * 30)).replace(day=1)
        mo    = mo_dt.strftime("%Y-%m")
        monthly_out.append({"month": mo, "hours": flt(monthly_sec.get(mo, 0) / 3600, 1)})

    # ── Weekly: last 12 weeks ──────────────────────────────────────────────────
    weekly_out = []
    for i in range(11, -1, -1):
        d    = today - timedelta(weeks=i)
        week = d.strftime("%Y-W%W")
        weekly_out.append({"week": week, "hours": flt(weekly_sec.get(week, 0) / 3600, 1)})

    # ── Yearly ────────────────────────────────────────────────────────────────
    yearly_out = []
    for i in range(2, -1, -1):
        year = str(today.year - i)
        yearly_out.append({"year": year, "hours": flt(yearly_sec.get(year, 0) / 3600, 1)})

    # ── By activity type ──────────────────────────────────────────────────────
    by_type_out = [
        {"type": t, "hours": flt(s / 3600, 1), "minutes": round(s / 60, 1)}
        for t, s in sorted(by_type_sec.items(), key=lambda x: -x[1])
    ]

    # ── By course ─────────────────────────────────────────────────────────────
    by_course_out = []
    for c in (courses_out or []):
        cid = c["course"]
        sec = by_course_sec.get(cid, {}).get("sec", 0)
        if sec == 0:
            sec = c.get("total_watch_sec", 0)
        by_course_out.append({
            "course":         cid,
            "course_name":    c["course_name"],
            "hours":          flt(sec / 3600, 1),
            "lessons_done":   c["completed_lessons"],
            "total_lessons":  c["total_lessons"],
            "completion_pct": c["progress_pct"],
        })

    # ── Top lessons by time ────────────────────────────────────────────────────
    top_lessons = sorted(
        [{"lesson": k, "title": v["title"], "hours": flt(v["sec"] / 3600, 2)}
         for k, v in by_lesson_sec.items()],
        key=lambda x: -x["hours"]
    )[:10]

    # ── Streak calculation ────────────────────────────────────────────────────
    current_streak = 0
    longest_streak = 0
    streak_tmp     = 0
    for i in range(364, -1, -1):
        d    = today - timedelta(days=i)
        date = d.strftime("%Y-%m-%d")
        if daily_sec.get(date, 0) > 0:
            streak_tmp += 1
            longest_streak = max(longest_streak, streak_tmp)
        else:
            streak_tmp = 0

    # Current streak from today backwards
    for i in range(0, 365):
        d    = today - timedelta(days=i)
        date = d.strftime("%Y-%m-%d")
        if daily_sec.get(date, 0) > 0:
            current_streak += 1
        else:
            break

    return {
        "heatmap":         heatmap,
        "daily":           daily_out,
        "monthly":         monthly_out,
        "weekly":          weekly_out,
        "yearly":          yearly_out,
        "by_type":         by_type_out,
        "by_course":       by_course_out,
        "top_lessons":     top_lessons,
        "last_activity":   last_activity,
        "session_history": session_history,
        "current_streak":  current_streak,
        "longest_streak":  longest_streak,
        "data_source":     data_source,
    }


# ══════════════════════════════════════════════════════════════════════════════
#  ACTIVITY FEED
# ══════════════════════════════════════════════════════════════════════════════

def _build_activity_feed(time_logs, assignments, attempts, open_answers):
    events = []

    for tl in time_logs[:15]:
        events.append({
            "ts":    str(tl.session_start)[:16] if tl.session_start else "",
            "type":  "session",
            "icon":  "🎥" if tl.activity_type == "Video" else ("🧠" if tl.activity_type == "Quiz" else "✍️"),
            "label": f"{tl.activity_type or 'Dars'} — {tl.lesson_title or tl.lesson or ''}",
            "sub":   f"{round(int(tl.duration_sec or 0) / 60, 0):.0f} daqiqa",
            "color": "blue",
        })

    for a in assignments[:10]:
        events.append({
            "ts":    str(a.submitted_on)[:16] if a.submitted_on else "",
            "type":  "assignment",
            "icon":  "📎",
            "label": f"Topshiriq: {a.lesson_title or ''}",
            "sub":   a.status or "",
            "color": "green" if a.status == "Approved" else ("red" if a.status == "Rejected" else "orange"),
        })

    for qa in attempts[:10]:
        qa_result = "O'tdi" if qa.passed else "O'tmadi"
        events.append({
            "ts":    str(qa.attempted_on)[:16] if qa.attempted_on else "",
            "type":  "quiz",
            "icon":  "✅" if qa.passed else "❌",
            "label": f"Quiz: {qa.quiz_name or qa.quiz}",
            "sub":   f"{flt(qa.percentage, 1)}% — {qa_result}",
            "color": "green" if qa.passed else "red",
        })

    for oa in open_answers[:10]:
        events.append({
            "ts":    str(oa.submitted_on)[:16] if oa.submitted_on else "",
            "type":  "open_answer",
            "icon":  "✏️",
            "label": f"Ochiq savol: {(oa.question_text or '')[:50]}",
            "sub":   f"Status: {oa.status or 'Pending'}",
            "color": "purple" if oa.status == "Graded" else "orange",
        })

    events.sort(key=lambda x: x["ts"], reverse=True)
    return events[:30]


# ══════════════════════════════════════════════════════════════════════════════
#  HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _empty_time_analytics():
    return {
        "heatmap": [], "daily": [], "monthly": [], "weekly": [], "yearly": [],
        "by_type": [], "by_course": [], "top_lessons": [],
        "last_activity": None, "session_history": [],
        "current_streak": 0, "longest_streak": 0, "data_source": "none",
    }


def _check_admin():
    if frappe.session.user == "Administrator":
        return
    allowed = {"LMS Admin", "System Manager", "Administrator"}
    if not allowed.intersection(set(frappe.get_roles(frappe.session.user))):
        frappe.throw("Ruxsat yo'q.", frappe.PermissionError)


def _emp_info_dict(emp_row):
    if not emp_row:
        return {}
    return {
        "name":             emp_row.get("name") or emp_row.name,
        "employee_name":    emp_row.get("employee_name") or "",
        "department":       emp_row.get("department") or "",
        "designation":      emp_row.get("designation") or "",
        "image":            emp_row.get("image") or "",
        "user_id":          emp_row.get("user_id") or "",
        "date_of_joining":  str(emp_row.get("date_of_joining") or "")[:10],
    }


def _empty_summary():
    return {
        "total_courses": 0, "completed_courses": 0, "total_watch_hours": 0,
        "avg_quiz_score": 0, "best_quiz_score": 0, "total_assignments": 0,
        "approved_assignments": 0, "pending_assignments": 0, "certificates_count": 0,
        "total_sessions": 0, "open_answers_total": 0, "open_answers_graded": 0,
        "open_answers_pending": 0,
    }


def _resolve_quiz_answers(attempts, options_by_question, questions_by_quiz):
    quiz_map = {}
    for att in attempts:
        qid   = att.quiz
        entry = quiz_map.setdefault(qid, {
            "quiz": qid, "quiz_name": att.quiz_name,
            "lesson": att.lesson, "lesson_title": att.lesson_title,
            "passing_score": flt(att.passing_score), "attempts": [],
        })
        raw_answers = att.answers or "{}"
        if isinstance(raw_answers, str):
            try:
                answers = json.loads(raw_answers)
            except Exception:
                answers = {}
        else:
            answers = raw_answers or {}

        questions_out = []
        quiz_q_meta   = questions_by_quiz.get(qid, {})
        for question_id, answer_idx in answers.items():
            q_meta  = quiz_q_meta.get(question_id, {})
            q_text  = q_meta.get("text", question_id)
            options = options_by_question.get(question_id, [])
            try:
                answer_idx_int = int(answer_idx)
            except (TypeError, ValueError):
                answer_idx_int = -1

            if 0 <= answer_idx_int < len(options):
                selected             = options[answer_idx_int]
                is_correct           = bool(selected.is_correct == 1)
                employee_answer_text = selected.option_text or ""
            else:
                is_correct           = False
                employee_answer_text = "Noma'lum"

            correct_opt         = next((o for o in options if o.is_correct == 1), None)
            correct_answer_text = correct_opt.option_text if correct_opt else "—"

            questions_out.append({
                "question_id":          question_id,
                "question_text":        q_text,
                "employee_answer_idx":  answer_idx_int,
                "employee_answer_text": employee_answer_text,
                "correct_answer_text":  correct_answer_text,
                "is_correct":           is_correct,
            })

        time_taken = int(att.time_taken_sec or 0)
        entry["attempts"].append({
            "attempt_number": int(att.attempt_number or 0),
            "score":          flt(att.score),
            "total_marks":    flt(att.total_marks),
            "percentage":     flt(att.percentage, 1),
            "passed":         bool(att.passed),
            "attempted_on":   str(att.attempted_on)[:16] if att.attempted_on else None,
            "started_at":     str(att.started_at)[:16] if att.started_at else None,
            "time_taken_min": round(time_taken / 60, 1) if time_taken else None,
            "questions":      questions_out,
        })

    return quiz_map


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _check_admin():
    if frappe.session.user == "Administrator":
        return
    allowed = {"LMS Admin", "System Manager", "Administrator"}
    if not allowed.intersection(set(frappe.get_roles(frappe.session.user))):
        frappe.throw("Ruxsat yo'q. Faqat LMS Admin roli egalari kirishi mumkin.", frappe.PermissionError)


def _do_review(submission_id, status, score=None, feedback=""):
    update_dict = {
        "status":         status,
        "admin_feedback": feedback,
        "reviewed_by":    frappe.session.user,
        "reviewed_on":    now(),
    }
    if score is not None:
        update_dict["admin_score"] = flt(score)
    frappe.db.set_value("LMS Assignment Submission", submission_id, update_dict)
    try:
        sub = frappe.db.get_value("LMS Assignment Submission", submission_id, "employee")
        if sub:
            user_id = frappe.db.get_value("Employee", sub, "user_id")
            if user_id:
                label = "✅ Tasdiqlandi" if status == "Approved" else "❌ Rad etildi"
                frappe.publish_realtime("assignment_reviewed",
                    {"message": f"Topshiriq: {label}. Ball: {score}", "feedback": feedback},
                    user=user_id)
    except Exception:
        pass


def _get_course_lessons(course_name):
    sections = frappe.db.get_all("LMS Section", filters={"course": course_name}, pluck="name")
    if not sections:
        return []
    return frappe.db.get_all("LMS Lesson", filters={"section": ["in", sections]}, pluck="name")


def _get_courses_lessons(course_list):
    if not course_list:
        return []
    sections = frappe.db.get_all("LMS Section", filters={"course": ["in", course_list]}, pluck="name")
    if not sections:
        return []
    return set(frappe.db.get_all("LMS Lesson", filters={"section": ["in", sections]}, pluck="name"))


def _emp_info_dict(emp_row):
    if not emp_row:
        return {}
    return {
        "name":          emp_row.get("name") or emp_row.name,
        "employee_name": emp_row.get("employee_name") or "",
        "department":    emp_row.get("department") or "",
        "designation":   emp_row.get("designation") or "",
        "image":         emp_row.get("image") or "",
        "user_id":       emp_row.get("user_id") or "",
    }


def _empty_summary():
    return {
        "total_courses": 0, "completed_courses": 0, "total_watch_hours": 0,
        "avg_quiz_score": 0, "best_quiz_score": 0, "total_assignments": 0,
        "approved_assignments": 0, "pending_assignments": 0, "certificates_count": 0,
    }


def _resolve_quiz_answers(attempts, options_by_question, questions_by_quiz):
    import json
    quiz_map = {}
    for att in attempts:
        qid   = att.quiz
        entry = quiz_map.setdefault(qid, {
            "quiz": qid, "quiz_name": att.quiz_name,
            "lesson": att.lesson, "lesson_title": att.lesson_title,
            "passing_score": flt(att.passing_score), "attempts": [],
        })
        raw_answers = att.answers or "{}"
        if isinstance(raw_answers, str):
            try:
                answers = json.loads(raw_answers)
            except Exception:
                answers = {}
        else:
            answers = raw_answers or {}

        questions_out = []
        quiz_q_meta   = questions_by_quiz.get(qid, {})
        for question_id, answer_idx in answers.items():
            q_meta  = quiz_q_meta.get(question_id, {})
            q_text  = q_meta.get("text", question_id)
            options = options_by_question.get(question_id, [])
            try:
                answer_idx_int = int(answer_idx)
            except (TypeError, ValueError):
                answer_idx_int = -1

            if 0 <= answer_idx_int < len(options):
                selected             = options[answer_idx_int]
                is_correct           = bool(selected.is_correct == 1)
                employee_answer_text = selected.option_text or ""
            else:
                is_correct           = False
                employee_answer_text = "Noma'lum"

            correct_opt         = next((o for o in options if o.is_correct == 1), None)
            correct_answer_text = correct_opt.option_text if correct_opt else "—"

            questions_out.append({
                "question_id":          question_id,
                "question_text":        q_text,
                "employee_answer_idx":  answer_idx_int,
                "employee_answer_text": employee_answer_text,
                "correct_answer_text":  correct_answer_text,
                "is_correct":           is_correct,
            })

        entry["attempts"].append({
            "attempt_number": int(att.attempt_number or 0),
            "score":          flt(att.score),
            "total_marks":    flt(att.total_marks),
            "percentage":     flt(att.percentage, 1),
            "passed":         bool(att.passed),
            "attempted_on":   str(att.attempted_on)[:16] if att.attempted_on else None,
            "questions":      questions_out,
        })

    return quiz_map


def _build_time_analytics(progress_rows, courses_out):
    import json
    from datetime import datetime, timedelta

    daily_map   = {}
    monthly_map = {}
    data_source = "none"
    session_used = False

    for row in (progress_rows or []):
        raw = row.session_logs
        if not raw:
            continue
        try:
            logs = json.loads(raw) if isinstance(raw, str) else (raw or [])
        except Exception:
            logs = []
        for entry in (logs or []):
            ts_str = entry.get("ts", "")
            dur    = int(entry.get("dur", 0) or 0)
            if not ts_str or dur <= 0:
                continue
            try:
                dt = datetime.fromisoformat(ts_str[:19])
                date = dt.strftime("%Y-%m-%d")
                mon  = dt.strftime("%Y-%m")
                daily_map[date]  = daily_map.get(date, 0) + dur
                monthly_map[mon] = monthly_map.get(mon, 0) + dur
                session_used = True
            except Exception:
                continue

    if session_used:
        data_source = "session_logs"
    else:
        completed_used = False
        for row in (progress_rows or []):
            if not row.is_completed or not row.completed_on:
                continue
            try:
                dt   = datetime.fromisoformat(str(row.completed_on)[:19])
                date = dt.strftime("%Y-%m-%d")
                mon  = dt.strftime("%Y-%m")
                dur  = int(row.watch_time_sec or 0)
                daily_map[date]  = daily_map.get(date, 0) + dur
                monthly_map[mon] = monthly_map.get(mon, 0) + dur
                completed_used = True
            except Exception:
                continue
        data_source = "completed_on" if completed_used else "modified"

    today = datetime.today()
    daily_out = [
        {"date": (today - timedelta(days=i)).strftime("%Y-%m-%d"),
         "minutes": round(daily_map.get((today - timedelta(days=i)).strftime("%Y-%m-%d"), 0) / 60, 1)}
        for i in range(29, -1, -1)
    ]
    monthly_out = []
    for i in range(11, -1, -1):
        mo_dt = today.replace(day=1) - timedelta(days=i * 30)
        mo    = mo_dt.strftime("%Y-%m")
        monthly_out.append({"month": mo, "hours": flt(monthly_map.get(mo, 0) / 3600, 1)})

    by_course = [{
        "course_name":     c["course_name"],
        "hours":           flt(c["total_watch_sec"] / 3600, 1),
        "lessons_watched": c["completed_lessons"],
        "completion_pct":  c["progress_pct"],
    } for c in (courses_out or [])]

    return {"daily": daily_out, "monthly": monthly_out, "by_course": by_course, "data_source": data_source}
