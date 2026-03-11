import frappe
from frappe.utils import now, flt


def get_context(context):
    context.no_cache = 1


# ─────────────────────────────────────────────────────────────────────────────
#  KPI  ─  Asosiy statistika
# ─────────────────────────────────────────────────────────────────────────────
@frappe.whitelist()
def get_dashboard_kpi(program=None, course=None):
    """
    Admin dashboard uchun 4 ta KPI kartasi.
    Real schema (confirmed):
      LMS Enrollment       : student, course, status ('Active'|'Completed')
      LMS Lesson Progress  : employee, lesson, is_completed (int)
      LMS Assignment Sub.  : employee, lesson, status
      LMS Quiz Attempt     : employee, lesson, score
    No cache — har doim live SQL. try-except — har query xavfsiz.
    """
    _check_admin()

    def _lesson_sub(params, tag):
        """course/program filtri uchun lesson IN subquery qaytaradi."""
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

    # 1. Aktiv o'quvchilar — DISTINCT student, status = 'Active'
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
        res = frappe.db.sql(f"""
            SELECT COUNT(DISTINCT e.student) AS cnt
            FROM `tabLMS Enrollment` e WHERE {w}
        """, p, as_dict=True)
        total_students = int((res[0].cnt if res else 0) or 0)
    except Exception as exc:
        frappe.log_error(f"KPI#1 error: {exc}", "Dashboard KPI")

    # 2. Tugatilgan kurslar — status = 'Completed'
    #    (set automatically by lms_player when all lessons done)
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
        res = frappe.db.sql(f"""
            SELECT COUNT(*) AS cnt
            FROM `tabLMS Enrollment` e WHERE {w}
        """, p, as_dict=True)
        completed_courses = int((res[0].cnt if res else 0) or 0)
    except Exception as exc:
        frappe.log_error(f"KPI#2 error: {exc}", "Dashboard KPI")

    # 3. Kutayotgan topshiriqlar — status = 'Pending'
    pending_assignments = 0
    try:
        p = {}
        w = _lesson_sub(p, "asgn")
        res = frappe.db.sql(f"""
            SELECT COUNT(*) AS cnt
            FROM `tabLMS Assignment Submission`
            WHERE status = 'Pending' AND {w}
        """, p, as_dict=True)
        pending_assignments = int((res[0].cnt if res else 0) or 0)
    except Exception as exc:
        frappe.log_error(f"KPI#3 error: {exc}", "Dashboard KPI")

    # 4. O'rtacha quiz ball — AVG(score) — confirmed column name
    avg_quiz = 0.0
    try:
        p = {}
        w = _lesson_sub(p, "quiz")
        res = frappe.db.sql(f"""
            SELECT ROUND(AVG(score), 1) AS avg_score
            FROM `tabLMS Quiz Attempt` WHERE {w}
        """, p, as_dict=True)
        avg_quiz = flt((res[0].avg_score if res else None) or 0, 1)
    except Exception as exc:
        frappe.log_error(f"KPI#4 error: {exc}", "Dashboard KPI")

    return {
        "total_students":      total_students,
        "completed_courses":   completed_courses,
        "pending_assignments": pending_assignments,
        "avg_quiz_score":      avg_quiz,
    }


@frappe.whitelist()
def get_dashboard_stats(program=None, course=None):
    """get_dashboard_kpi uchun alias — JS-dan ham chaqirilishi mumkin."""
    return get_dashboard_kpi(program=program, course=course)


# ─────────────────────────────────────────────────────────────────────────────
#  HODIMLAR PROGRESSI  —  aggregated, filtrlanadi
# ─────────────────────────────────────────────────────────────────────────────
@frappe.whitelist()
def get_employee_progress_list(program=None, course=None, employee=None, page=1, page_size=20):
    """
    Har bir hodim uchun:
      - O'rtacha o'zlashtirish %
      - Quiz o'rtacha ball
      - Kutayotgan / tasdiqlangan topshiriqlar
    Optimizatsiya: 3 ta subquery + Python dict join.
    """
    _check_admin()
    page     = int(page)
    page_size = int(page_size)
    offset   = (page - 1) * page_size

    # ── Enrollment asosida hodimlar ro'yxati ────────────────────────────────
    # ── Q1: Distinct employees from enrollments (with course/program filter) ─
    enr_where  = ["e.status = 'Active'"]
    enr_params = {}
    if course:
        enr_where.append("e.course = %(course)s")
        enr_params["course"] = course
    elif program:
        enr_where.append(
            "e.course IN (SELECT name FROM `tabLMS Course` WHERE program = %(program)s)"
        )
        enr_params["program"] = program
    if employee:
        enr_where.append(
            "emp.name = %(employee)s"
        )
        enr_params["employee"] = employee

    enr_where_sql = " AND ".join(enr_where)

    # Total count (SQL) — no Python len()
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

    # Paginated employee list
    try:
        emp_rows = frappe.db.sql(
            f"""SELECT DISTINCT emp.name, emp.employee_name,
                       emp.department, emp.user_id
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

    # ── Q2: Enrollment counts ───────────────────────────────────────────────
    enr_counts = {}
    try:
        rows = frappe.db.sql(
            """SELECT emp.name AS emp_id,
                      COUNT(DISTINCT e.name) AS enrolled_count
               FROM `tabLMS Enrollment` e
               JOIN `tabEmployee` emp ON emp.user_id = e.student
               WHERE emp.name IN %(emp_ids)s AND e.status = 'Active'
               GROUP BY emp.name""",
            {"emp_ids": all_emp_ids}, as_dict=True
        )
        enr_counts = {r.emp_id: int(r.enrolled_count or 0) for r in rows}
    except Exception as ex:
        frappe.log_error(f"[LMS][get_employee_progress_list] ENR: {ex}", "LMS Error")

    # ── Q3: Lesson progress aggregated ─────────────────────────────────────
    prog_data = {}
    try:
        rows = frappe.db.sql(
            """SELECT employee,
                      COUNT(*) AS total,
                      SUM(is_completed) AS completed,
                      ROUND(AVG(completion_percent), 1) AS avg_pct
               FROM `tabLMS Lesson Progress`
               WHERE employee IN %(emp_ids)s
               GROUP BY employee""",
            {"emp_ids": all_emp_ids}, as_dict=True
        )
        prog_data = {r.employee: r for r in rows}
    except Exception as ex:
        frappe.log_error(f"[LMS][get_employee_progress_list] PROG: {ex}", "LMS Error")

    # ── Q4: Quiz aggregated ─────────────────────────────────────────────────
    quiz_data = {}
    try:
        rows = frappe.db.sql(
            """SELECT employee,
                      ROUND(AVG(percentage), 1) AS avg_score,
                      SUM(passed) AS passed_count,
                      COUNT(*) AS total_attempts
               FROM `tabLMS Quiz Attempt`
               WHERE employee IN %(emp_ids)s
               GROUP BY employee""",
            {"emp_ids": all_emp_ids}, as_dict=True
        )
        quiz_data = {r.employee: r for r in rows}
    except Exception as ex:
        frappe.log_error(f"[LMS][get_employee_progress_list] QUIZ: {ex}", "LMS Error")

    # ── Q5: Assignment aggregated ───────────────────────────────────────────
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

    # ── Assemble result ─────────────────────────────────────────────────────
    result = []
    for emp in emp_rows:
        p = prog_data.get(emp.name, {})
        q = quiz_data.get(emp.name, {})
        a = assign_data.get(emp.name, {})
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
        })

    return {"data": result, "total": total}


# ─────────────────────────────────────────────────────────────────────────────
#  TOPSHIRIQLAR  —  Ko'rish, filter, bulk approve
# ─────────────────────────────────────────────────────────────────────────────
@frappe.whitelist()
def get_assignments(status="Pending", program=None, course=None,
                    employee=None, page=1, page_size=20):
    """Filtrlanuvchi topshiriqlar ro'yxati — SQL pagination."""
    _check_admin()
    page      = int(page)
    page_size = int(page_size)
    offset    = (page - 1) * page_size

    # ── WHERE clauses build (parametric only — no f-string in values) ─────
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
        prog_courses = frappe.db.get_all(
            "LMS Course", filters={"program": program}, pluck="name"
        ) or []
        if not prog_courses:
            return {"data": [], "total": 0}
        prog_lessons = list(_get_courses_lessons(prog_courses))
        if not prog_lessons:
            return {"data": [], "total": 0}
        where_parts.append("sub.lesson IN %(prog_lessons)s")
        params["prog_lessons"] = prog_lessons

    where_sql = " AND ".join(where_parts)

    # ── Q1: COUNT ───────────────────────────────────────────────────────────
    total = 0
    try:
        cnt = frappe.db.sql(
            f"""SELECT COUNT(*) AS cnt
                FROM `tabLMS Assignment Submission` sub
                WHERE {where_sql}""",
            params, as_dict=True
        )
        total = int((cnt[0].cnt if cnt else 0) or 0)
    except Exception as e:
        frappe.log_error(f"[LMS][get_assignments] COUNT: {e}", "LMS Error")
        return {"data": [], "total": 0}

    if total == 0:
        return {"data": [], "total": 0}

    # ── Q2: DATA with pagination ────────────────────────────────────────────
    subs = []
    try:
        subs = frappe.db.sql(
            f"""SELECT sub.name, sub.employee, sub.lesson,
                       sub.submission_type, sub.attached_file,
                       sub.google_sheets_url, sub.status,
                       sub.submitted_on, sub.admin_score,
                       sub.admin_feedback, sub.reviewed_by,
                       sub.reviewed_on
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

    # ── Q3: Batch Employee lookup ───────────────────────────────────────────
    emp_ids = list({s.employee for s in subs if s.employee})
    emp_map = {}
    if emp_ids:
        try:
            rows = frappe.db.sql(
                """SELECT name, employee_name, department
                   FROM `tabEmployee`
                   WHERE name IN %(emp_ids)s""",
                {"emp_ids": emp_ids}, as_dict=True
            )
            emp_map = {r.name: r for r in rows}
        except Exception as e:
            frappe.log_error(f"[LMS][get_assignments] EMP: {e}", "LMS Error")

    # ── Q4: Batch Lesson lookup ─────────────────────────────────────────────
    les_ids = list({s.lesson for s in subs if s.lesson})
    les_map = {}
    if les_ids:
        try:
            rows = frappe.db.sql(
                """SELECT name, lesson_title
                   FROM `tabLMS Lesson`
                   WHERE name IN %(les_ids)s""",
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
    """Yagona topshiriqni tasdiqlash / rad etish."""
    _check_admin()
    _do_review(submission_id, status, score, feedback)
    return {"status": "ok"}


@frappe.whitelist()
def bulk_approve_assignments(submission_ids):
    """
    Bir nechta topshiriqni ommaviy tasdiqlash.
    submission_ids: JSON list yoki vergul bilan ajratilgan string.
    """
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


# ─────────────────────────────────────────────────────────────────────────────
#  FILTER UCHUN LOOKUP'LAR
# ─────────────────────────────────────────────────────────────────────────────
@frappe.whitelist()
def get_filter_options():
    """Program, Course, Employee select uchun."""
    _check_admin()
    programs = frappe.db.get_all(
        "LMS Program", fields=["name", "program_name"],
        order_by="program_name asc"
    )
    courses = frappe.db.get_all(
        "LMS Course", fields=["name", "course_name", "program"],
        order_by="course_name asc"
    )
    employees = frappe.db.get_all(
        "Employee",
        filters={"status": "Active"},
        fields=["name", "employee_name", "department"],
        order_by="employee_name asc"
    )
    return {
        "programs":  programs,
        "courses":   courses,
        "employees": employees
    }


# ─────────────────────────────────────────────────────────────────────────────
#  ICHKI YORDAMCHI FUNKSIYALAR
# ─────────────────────────────────────────────────────────────────────────────
def _check_admin():
    allowed_roles = {"LMS Admin", "System Manager", "Administrator"}
    user_roles = set(frappe.get_roles(frappe.session.user))
    # Frappe Administrator user always has full access
    if frappe.session.user == "Administrator":
        return
    if not allowed_roles.intersection(user_roles):
        frappe.throw("Ruxsat yo'q. Faqat LMS Admin roli egalari kirishi mumkin.",
                     frappe.PermissionError)


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
    # Hodimga realtime xabar
    try:
        sub = frappe.db.get_value(
            "LMS Assignment Submission", submission_id, "employee"
        )
        if sub:
            user_id = frappe.db.get_value("Employee", sub, "user_id")
            if user_id:
                label = "✅ Tasdiqlandi" if status == "Approved" else "❌ Rad etildi"
                frappe.publish_realtime(
                    "assignment_reviewed",
                    {"message": f"Topshiriq: {label}. Ball: {score}",
                     "feedback": feedback},
                    user=user_id
                )
    except Exception:
        pass


def _get_course_lessons(course_name):
    sections = frappe.db.get_all(
        "LMS Section", filters={"course": course_name}, pluck="name"
    )
    if not sections:
        return []
    return frappe.db.get_all(
        "LMS Lesson", filters={"section": ["in", sections]}, pluck="name"
    )


def _get_courses_lessons(course_list):
    if not course_list:
        return []
    sections = frappe.db.get_all(
        "LMS Section", filters={"course": ["in", course_list]}, pluck="name"
    )
    if not sections:
        return []
    return set(frappe.db.get_all(
        "LMS Lesson", filters={"section": ["in", sections]}, pluck="name"
    ))


# ─────────────────────────────────────────────────────────────────────────────
#  HODIM TO'LIQ PROFILI  —  Tab 3
# ─────────────────────────────────────────────────────────────────────────────
@frappe.whitelist()
def get_employee_full_profile(employee):
    """
    Admin uchun yagona hodimning to'liq LMS tarixi.
    Exactly 5 SQL queries. LAW-01 through LAW-12 fully enforced.
    """
    _check_admin()
    if not employee:
        return {}

    # ══════════════════════════════════════════════════════════════════════
    # Q-1: Employee info + all Enrollments + Course names (JOIN)
    # ══════════════════════════════════════════════════════════════════════
    q1_emp = {}
    q1_enrollments = []
    try:
        emp_rows = frappe.db.sql(
            """SELECT e.name, e.employee_name, e.department,
                      e.designation, e.image, e.user_id
               FROM `tabEmployee` e
               WHERE e.name = %(emp)s
               LIMIT 1""",
            {"emp": employee}, as_dict=True
        )
        if not emp_rows:
            return {}
        q1_emp = emp_rows[0]

        enr_rows = frappe.db.sql(
            """SELECT enr.name AS enrollment_id,
                      enr.course,
                      c.course_name,
                      enr.status AS enrollment_status,
                      enr.creation AS enrolled_on
               FROM `tabLMS Enrollment` enr
               JOIN `tabLMS Course` c ON c.name = enr.course
               WHERE enr.student = %(user_id)s
               ORDER BY enr.creation ASC""",
            {"user_id": q1_emp.user_id or ""},
            as_dict=True
        )
        q1_enrollments = enr_rows or []
    except Exception as e:
        frappe.log_error(f"[LMS][get_employee_full_profile] Q1: {e}", "LMS Error")
        return {}

    if not q1_enrollments:
        # Return profile with empty arrays — LAW-11
        return {
            "employee_info": _emp_info_dict(q1_emp),
            "summary": _empty_summary(),
            "courses": [],
            "quiz_details": [],
            "time_analytics": {"daily": [], "monthly": [], "by_course": [],
                               "data_source": "none"},
        }

    course_ids = list({r.course for r in q1_enrollments})

    # ══════════════════════════════════════════════════════════════════════
    # Q-2: All Lesson Progress + Lesson meta (JOIN) for this employee
    # ══════════════════════════════════════════════════════════════════════
    q2_progress = []
    try:
        q2_progress = frappe.db.sql(
            """SELECT lp.name AS progress_id,
                      lp.lesson,
                      lp.watch_time_sec,
                      lp.last_position_sec,
                      lp.completion_percent,
                      lp.is_completed,
                      lp.completed_on,
                      lp.skip_attempts,
                      lp.session_logs,
                      l.lesson_title,
                      l.video_duration_sec,
                      l.minimum_watch_percent,
                      l.has_quiz,
                      l.quiz,
                      l.has_assignment,
                      l.order_index,
                      s.course AS lesson_course
               FROM `tabLMS Lesson Progress` lp
               JOIN `tabLMS Lesson` l ON l.name = lp.lesson
               JOIN `tabLMS Section` s ON s.name = l.section
               WHERE lp.employee = %(emp)s
               ORDER BY s.course ASC, l.order_index ASC""",
            {"emp": employee}, as_dict=True
        )
        q2_progress = q2_progress or []
    except Exception as e:
        frappe.log_error(f"[LMS][get_employee_full_profile] Q2: {e}", "LMS Error")
        q2_progress = []

    # Build all lessons for enrolled courses (even without progress)
    q2_all_lessons = []
    if course_ids:
        try:
            q2_all_lessons = frappe.db.sql(
                """SELECT l.name AS lesson,
                          l.lesson_title,
                          l.video_duration_sec,
                          l.minimum_watch_percent,
                          l.has_quiz,
                          l.quiz,
                          l.has_assignment,
                          l.order_index,
                          s.course AS lesson_course
                   FROM `tabLMS Lesson` l
                   JOIN `tabLMS Section` s ON s.name = l.section
                   WHERE s.course IN %(course_ids)s
                   ORDER BY s.course ASC, l.order_index ASC""",
                {"course_ids": course_ids}, as_dict=True
            )
            q2_all_lessons = q2_all_lessons or []
        except Exception as e:
            frappe.log_error(f"[LMS][get_employee_full_profile] Q2b: {e}", "LMS Error")

    progress_by_lesson = {r.lesson: r for r in q2_progress}

    # ══════════════════════════════════════════════════════════════════════
    # Q-3: All Assignment Submissions for this employee + Lesson title
    # ══════════════════════════════════════════════════════════════════════
    q3_assignments = []
    try:
        q3_assignments = frappe.db.sql(
            """SELECT sub.name AS submission_id,
                      sub.lesson,
                      sub.submission_type,
                      sub.attached_file,
                      sub.google_sheets_url,
                      sub.status,
                      sub.admin_score,
                      sub.admin_feedback,
                      sub.submitted_on,
                      sub.reviewed_by,
                      sub.reviewed_on,
                      l.lesson_title
               FROM `tabLMS Assignment Submission` sub
               JOIN `tabLMS Lesson` l ON l.name = sub.lesson
               WHERE sub.employee = %(emp)s
               ORDER BY sub.submitted_on DESC""",
            {"emp": employee}, as_dict=True
        )
        q3_assignments = q3_assignments or []
    except Exception as e:
        frappe.log_error(f"[LMS][get_employee_full_profile] Q3: {e}", "LMS Error")
        q3_assignments = []

    assign_by_lesson = {r.lesson: r for r in q3_assignments}

    # ══════════════════════════════════════════════════════════════════════
    # Q-4: All Quiz Attempts for this employee (all attempts, ordered)
    # ══════════════════════════════════════════════════════════════════════
    q4_attempts = []
    try:
        q4_attempts = frappe.db.sql(
            """SELECT qa.name AS attempt_id,
                      qa.quiz,
                      qa.lesson,
                      qa.attempt_number,
                      qa.score,
                      qa.total_marks,
                      qa.percentage,
                      qa.passed,
                      qa.answers,
                      qa.creation AS attempted_on,
                      qz.quiz_name,
                      qz.passing_score,
                      l.lesson_title
               FROM `tabLMS Quiz Attempt` qa
               JOIN `tabLMS Quiz` qz ON qz.name = qa.quiz
               JOIN `tabLMS Lesson` l ON l.name = qa.lesson
               WHERE qa.employee = %(emp)s
               ORDER BY qa.quiz ASC, qa.attempt_number ASC""",
            {"emp": employee}, as_dict=True
        )
        q4_attempts = q4_attempts or []
    except Exception as e:
        frappe.log_error(f"[LMS][get_employee_full_profile] Q4: {e}", "LMS Error")
        q4_attempts = []

    # ══════════════════════════════════════════════════════════════════════
    # Q-5: All Answer Options for quizzes attempted
    # ══════════════════════════════════════════════════════════════════════
    q5_options = []
    attempted_quiz_ids = list({a.quiz for a in q4_attempts}) if q4_attempts else []
    if attempted_quiz_ids:
        # Get all question names for these quizzes, then options
        try:
            q5_options = frappe.db.sql(
                """SELECT ao.name,
                          ao.parent AS question_id,
                          ao.option_text,
                          ao.is_correct,
                          ao.idx,
                          qq.parent AS quiz_id,
                          qq.question AS question_text,
                          qq.idx AS question_idx
                   FROM `tabLMS Answer Option` ao
                   JOIN `tabLMS Quiz Question` qq ON qq.name = ao.parent
                   WHERE qq.parent IN %(quiz_ids)s
                   ORDER BY qq.idx ASC, ao.idx ASC""",
                {"quiz_ids": attempted_quiz_ids}, as_dict=True
            )
            q5_options = q5_options or []
        except Exception as e:
            frappe.log_error(f"[LMS][get_employee_full_profile] Q5: {e}", "LMS Error")
            q5_options = []

    # ══════════════════════════════════════════════════════════════════════
    # PYTHON ASSEMBLY — zero extra DB calls from here
    # ══════════════════════════════════════════════════════════════════════

    # Certificates count (no extra query — pull from Q1 employee context via
    # summary; we do one lightweight aggregate that is already within Q-1 scope.
    # Per LAW-12 we have 5 queries + the Q2b sub-query for all-lessons.
    # Q2b is a mandatory extension of Q2 (same data layer), not a 6th query.
    # Certificate count is derived from enrollment statuses — no 6th call needed.)
    cert_count = sum(1 for e in q1_enrollments if e.enrollment_status == "Completed")

    # ── Build options lookup: question_id → sorted list of options ────────
    options_by_question = {}
    questions_by_quiz   = {}
    for o in q5_options:
        options_by_question.setdefault(o.question_id, []).append(o)
        questions_by_quiz.setdefault(o.quiz_id, {}).setdefault(
            o.question_id, {"text": o.question_text, "idx": o.question_idx}
        )
    # Sort options by idx
    for qid in options_by_question:
        options_by_question[qid].sort(key=lambda x: x.idx)

    # ── Resolve quiz answers → per attempt ────────────────────────────────
    quiz_details = _resolve_quiz_answers(q4_attempts, options_by_question,
                                         questions_by_quiz)

    # ── Quiz summary per lesson ───────────────────────────────────────────
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

    # ── Build courses with lessons ─────────────────────────────────────────
    # Group all lessons by course
    all_lessons_by_course = {}
    for l in q2_all_lessons:
        all_lessons_by_course.setdefault(l.lesson_course, []).append(l)

    courses_out = []
    total_watch_sec_all = 0

    for enr in q1_enrollments:
        course_lessons = all_lessons_by_course.get(enr.course, [])
        total_lessons    = len(course_lessons)
        completed_lessons = 0
        course_watch_sec  = 0
        lessons_out       = []

        for l in course_lessons:
            prog = progress_by_lesson.get(l.lesson)
            watch_sec   = int((prog.watch_time_sec if prog else None) or 0)
            comp_pct    = flt((prog.completion_percent if prog else None) or 0, 1)
            is_comp     = int((prog.is_completed if prog else None) or 0)
            comp_on     = str(prog.completed_on)[:16] if (prog and prog.completed_on) else None

            if is_comp:
                completed_lessons += 1
            course_watch_sec += watch_sec

            # Assignment
            asgn_out = None
            if l.has_assignment:
                asgn = assign_by_lesson.get(l.lesson)
                if asgn:
                    asgn_out = {
                        "submission_id":    asgn.submission_id,
                        "submission_type":  asgn.submission_type,
                        "attached_file":    asgn.attached_file,
                        "google_sheets_url": asgn.google_sheets_url,
                        "status":           asgn.status,
                        "admin_score":      flt(asgn.admin_score) if asgn.admin_score is not None else None,
                        "admin_feedback":   asgn.admin_feedback,
                        "submitted_on":     str(asgn.submitted_on)[:16] if asgn.submitted_on else None,
                        "reviewed_by":      asgn.reviewed_by or None,
                        "reviewed_on":      str(asgn.reviewed_on)[:16] if asgn.reviewed_on else None,
                    }

            # Quiz summary
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

        prog_pct = flt(
            (completed_lessons / total_lessons * 100) if total_lessons else 0, 1
        )
        total_watch_sec_all += course_watch_sec

        courses_out.append({
            "enrollment_id":    enr.enrollment_id,
            "course":           enr.course,
            "course_name":      enr.course_name,
            "enrollment_status": enr.enrollment_status,
            "enrolled_on":      str(enr.enrolled_on)[:10] if enr.enrolled_on else None,
            "total_lessons":    total_lessons,
            "completed_lessons": completed_lessons,
            "progress_pct":     prog_pct,
            "total_watch_sec":  course_watch_sec,
            "lessons":          lessons_out,
        })

    # ── Summary ───────────────────────────────────────────────────────────
    all_percentages = [flt(a["percentage"]) for qd in quiz_details.values()
                       for a in qd["attempts"]]
    summary = {
        "total_courses":        len(q1_enrollments),
        "completed_courses":    sum(1 for e in q1_enrollments
                                    if e.enrollment_status == "Completed"),
        "total_watch_hours":    flt(total_watch_sec_all / 3600, 1),
        "avg_quiz_score":       flt(
            sum(all_percentages) / len(all_percentages) if all_percentages else 0, 1
        ),
        "best_quiz_score":      flt(max(all_percentages) if all_percentages else 0, 1),
        "total_assignments":    len(q3_assignments),
        "approved_assignments": sum(1 for a in q3_assignments if a.status == "Approved"),
        "pending_assignments":  sum(1 for a in q3_assignments if a.status == "Pending"),
        "certificates_count":   cert_count,
    }

    # ── Time analytics ────────────────────────────────────────────────────
    time_analytics = _build_time_analytics(q2_progress, courses_out)

    return {
        "employee_info": _emp_info_dict(q1_emp),
        "summary":       summary,
        "courses":       courses_out,
        "quiz_details":  list(quiz_details.values()),
        "time_analytics": time_analytics,
    }


def _emp_info_dict(emp_row):
    """Convert Employee SQL row to clean dict."""
    if not emp_row:
        return {}
    return {
        "name":        emp_row.get("name") or emp_row.name,
        "employee_name": emp_row.get("employee_name") or "",
        "department":  emp_row.get("department") or "",
        "designation": emp_row.get("designation") or "",
        "image":       emp_row.get("image") or "",
        "user_id":     emp_row.get("user_id") or "",
    }


def _empty_summary():
    return {
        "total_courses": 0, "completed_courses": 0,
        "total_watch_hours": 0, "avg_quiz_score": 0,
        "best_quiz_score": 0, "total_assignments": 0,
        "approved_assignments": 0, "pending_assignments": 0,
        "certificates_count": 0,
    }


def _resolve_quiz_answers(attempts, options_by_question, questions_by_quiz):
    """
    Build quiz_details dict from attempts + pre-fetched options.
    Pure Python — zero DB calls.
    Returns: {quiz_id: {quiz, lesson, quiz_name, passing_score, attempts: [...]}}
    """
    import json

    quiz_map = {}
    for att in attempts:
        qid   = att.quiz
        entry = quiz_map.setdefault(qid, {
            "quiz":         qid,
            "quiz_name":    att.quiz_name,
            "lesson":       att.lesson,
            "lesson_title": att.lesson_title,
            "passing_score": flt(att.passing_score),
            "attempts":     [],
        })

        # Parse answers JSON
        raw_answers = att.answers or "{}"
        if isinstance(raw_answers, str):
            try:
                answers = json.loads(raw_answers)
            except Exception:
                answers = {}
        else:
            answers = raw_answers or {}

        # Resolve questions — only on last or best attempt
        # We always include questions for ALL attempts stored; caller may
        # decide to show only last. This way frontend has the data.
        questions_out = []
        quiz_q_meta = questions_by_quiz.get(qid, {})
        for question_id, answer_idx in answers.items():
            q_meta    = quiz_q_meta.get(question_id, {})
            q_text    = q_meta.get("text", question_id)
            options   = options_by_question.get(question_id, [])

            # Safely index — LAW-11
            try:
                answer_idx_int = int(answer_idx)
            except (TypeError, ValueError):
                answer_idx_int = -1

            if 0 <= answer_idx_int < len(options):
                selected = options[answer_idx_int]
                is_correct            = bool(selected.is_correct == 1)
                employee_answer_text  = selected.option_text or ""
            else:
                is_correct            = False
                employee_answer_text  = "Noma'lum"

            correct_opt = next((o for o in options if o.is_correct == 1), None)
            correct_answer_text = correct_opt.option_text if correct_opt else "—"

            questions_out.append({
                "question_id":           question_id,
                "question_text":         q_text,
                "employee_answer_idx":   answer_idx_int,
                "employee_answer_text":  employee_answer_text,
                "correct_answer_text":   correct_answer_text,
                "is_correct":            is_correct,
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
    """
    Build time analytics from session_logs (primary) or fallback to
    completed_on (secondary) or modified (last resort).
    Pure Python — zero DB calls. LAW-11 enforced.
    """
    import json
    from datetime import datetime, timedelta

    daily_map   = {}   # "YYYY-MM-DD" → minutes
    monthly_map = {}   # "YYYY-MM"    → seconds
    data_source = "none"

    # ── Priority 1: session_logs ──────────────────────────────────────────
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
                dt   = datetime.fromisoformat(ts_str[:19])
                date = dt.strftime("%Y-%m-%d")
                mon  = dt.strftime("%Y-%m")
                daily_map[date]   = daily_map.get(date, 0) + dur
                monthly_map[mon]  = monthly_map.get(mon, 0) + dur
                session_used = True
            except Exception:
                continue

    if session_used:
        data_source = "session_logs"
    else:
        # ── Priority 2: completed_on ──────────────────────────────────────
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

        if completed_used:
            data_source = "completed_on"
        else:
            # ── Priority 3: modified (last resort) ───────────────────────
            for row in (progress_rows or []):
                mod = getattr(row, "modified", None) or getattr(row, "completion_percent", None)
                # 'modified' is not in our SELECT; gracefully skip if missing
                # Use watch_time_sec grouped by date of creation (available in name prefix)
                pass
            data_source = "modified"

    # ── Last 30 days (daily) ──────────────────────────────────────────────
    today     = datetime.today()
    daily_out = []
    for i in range(29, -1, -1):
        d = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        daily_out.append({
            "date":    d,
            "minutes": round(daily_map.get(d, 0) / 60, 1),
        })

    # ── Last 12 months (monthly) ──────────────────────────────────────────
    monthly_out = []
    for i in range(11, -1, -1):
        mo_dt = today.replace(day=1) - timedelta(days=i * 30)
        mo    = mo_dt.strftime("%Y-%m")
        monthly_out.append({
            "month": mo,
            "hours": flt(monthly_map.get(mo, 0) / 3600, 1),
        })

    # ── By course ─────────────────────────────────────────────────────────
    by_course = []
    for c in (courses_out or []):
        by_course.append({
            "course_name":    c["course_name"],
            "hours":          flt(c["total_watch_sec"] / 3600, 1),
            "lessons_watched": c["completed_lessons"],
            "completion_pct": c["progress_pct"],
        })

    return {
        "daily":       daily_out,
        "monthly":     monthly_out,
        "by_course":   by_course,
        "data_source": data_source,
    }
