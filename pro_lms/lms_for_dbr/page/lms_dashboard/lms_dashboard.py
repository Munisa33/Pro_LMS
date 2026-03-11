"""
LMS Student Dashboard — Backend API
Lesson → Section → Course zanjiri orqali to'g'ri JOIN.
"""
import frappe
from frappe.utils import flt, cint


def get_context(context):
    context.no_cache = 1


@frappe.whitelist()
def get_dashboard_data():
    user   = frappe.session.user
    emp    = _get_employee(user)
    if not emp:
        return {"error": True, "message": "Hodim topilmadi. HR modulida foydalanuvchini Employee ga bog'lang."}

    emp_id = emp["name"]

    # ── 1. Enrollment list ───────────────────────────────────────────────────
    enrollments = frappe.db.get_all(
        "LMS Enrollment",
        filters={"student": user},
        fields=["name", "course", "status"],
        ignore_permissions=True
    )
    if not enrollments:
        return _empty_response(emp)

    course_ids = [e.course for e in enrollments]
    enr_by_course = {e.course: e for e in enrollments}

    # ── 2. Course info ───────────────────────────────────────────────────────
    courses = frappe.db.get_all(
        "LMS Course",
        filters={"name": ["in", course_ids]},
        fields=["name", "course_name", "image", "description", "program"],
        ignore_permissions=True
    )
    course_map = {c.name: c for c in courses}

    # ── 3. Total lessons per course  (Lesson → Section → Course) ────────────
    #   LMS Lesson.course = NULL, bog'liqlik: Lesson.section → Section.course
    lesson_count_rows = frappe.db.sql("""
        SELECT s.course, COUNT(l.name) AS total
        FROM `tabLMS Lesson`  l
        JOIN `tabLMS Section` s ON s.name = l.section
        WHERE s.course IN %(courses)s
        GROUP BY s.course
    """, {"courses": course_ids}, as_dict=True)
    total_by_course = {r.course: r.total for r in lesson_count_rows}

    # ── 4. Completed lessons per course ─────────────────────────────────────
    completed_rows = frappe.db.sql("""
        SELECT s.course,
               COUNT(lp.name)       AS completed,
               MAX(lp.completed_on) AS last_activity
        FROM `tabLMS Lesson Progress` lp
        JOIN `tabLMS Lesson`          l  ON l.name  = lp.lesson
        JOIN `tabLMS Section`         s  ON s.name  = l.section
        WHERE lp.employee    = %(emp)s
          AND lp.is_completed = 1
          AND s.course        IN %(courses)s
        GROUP BY s.course
    """, {"emp": emp_id, "courses": course_ids}, as_dict=True)
    completed_by_course = {r.course: r for r in completed_rows}

    # ── 5. Next incomplete lesson per course ─────────────────────────────────
    next_rows = frappe.db.sql("""
        SELECT s.course, l.name AS lesson_name, l.lesson_title, l.order_index
        FROM `tabLMS Lesson`  l
        JOIN `tabLMS Section` s ON s.name = l.section
        WHERE s.course IN %(courses)s
          AND l.name NOT IN (
              SELECT lp.lesson
              FROM `tabLMS Lesson Progress` lp
              WHERE lp.employee = %(emp)s AND lp.is_completed = 1
          )
        ORDER BY s.course, l.order_index ASC
    """, {"courses": course_ids, "emp": emp_id}, as_dict=True)
    next_by_course = {}
    for nl in next_rows:
        if nl.course not in next_by_course:
            next_by_course[nl.course] = nl

    # ── 6. Build courses list ────────────────────────────────────────────────
    my_courses = []
    total_all  = 0
    total_done = 0

    for enr in enrollments:
        cid   = enr.course
        c     = course_map.get(cid)
        comp  = completed_by_course.get(cid)
        total = cint(total_by_course.get(cid, 0))
        done  = cint(comp["completed"] if comp else 0)
        pct   = round((done / total * 100) if total > 0 else 0, 1)
        total_all  += total
        total_done += done
        nl = next_by_course.get(cid)
        my_courses.append({
            "course":            cid,
            "course_name":       c.course_name if c else cid,
            "image":             c.image if c else None,
            "description":       (c.description or "")[:120] if c else "",
            "program":           c.program if c else None,
            "enr_status":        enr.status,
            "total_lessons":     total,
            "done_lessons":      done,
            "progress_pct":      pct,
            "is_completed":      enr.status == "Completed",
            "next_lesson":       nl["lesson_name"] if nl else None,
            "next_lesson_title": nl["lesson_title"] if nl else "Yakunlangan",
            "last_activity":     str(comp["last_activity"])[:16] if comp and comp["last_activity"] else None,
        })

    my_courses.sort(key=lambda x: (-x["progress_pct"], x["course_name"]))
    overall_pct = round((total_done / total_all * 100) if total_all > 0 else 0, 1)

    # ── 7. Activity timeline ─────────────────────────────────────────────────
    timeline_rows = frappe.db.sql("""
        (
            SELECT 'lesson' AS atype,
                   lp.completed_on          AS atime,
                   l.lesson_title           AS title,
                   c.course_name            AS subtitle,
                   lp.completion_percent    AS value,
                   NULL                     AS extra
            FROM `tabLMS Lesson Progress` lp
            JOIN `tabLMS Lesson`          l  ON l.name = lp.lesson
            JOIN `tabLMS Section`         s  ON s.name = l.section
            JOIN `tabLMS Course`          c  ON c.name = s.course
            WHERE lp.employee    = %(emp)s
              AND lp.is_completed = 1
        )
        UNION ALL
        (
            SELECT 'quiz'                        AS atype,
                   qa.submitted_at               AS atime,
                   CONCAT(l.lesson_title, ' — Quiz') AS title,
                   c.course_name                AS subtitle,
                   qa.percentage                AS value,
                   IF(qa.passed, 'passed', 'failed') AS extra
            FROM `tabLMS Quiz Attempt`    qa
            JOIN `tabLMS Lesson`          l  ON l.name = qa.lesson
            JOIN `tabLMS Section`         s  ON s.name = l.section
            JOIN `tabLMS Course`          c  ON c.name = s.course
            WHERE qa.employee = %(emp)s
        )
        ORDER BY atime DESC
        LIMIT 30
    """, {"emp": emp_id}, as_dict=True)

    activity_timeline = [{
        "type":     r.atype,
        "time":     str(r.atime)[:16] if r.atime else "",
        "title":    r.title or "",
        "subtitle": r.subtitle or "",
        "value":    flt(r.value, 1),
        "extra":    r.extra,
    } for r in timeline_rows]

    # ── 8. Quiz performance ──────────────────────────────────────────────────
    best = frappe.db.sql("""
        SELECT MAX(percentage) AS best_score,
               COUNT(*)        AS total_attempts,
               SUM(passed)     AS passed_count
        FROM `tabLMS Quiz Attempt`
        WHERE employee = %(emp)s
    """, {"emp": emp_id}, as_dict=True)
    last = frappe.db.sql("""
        SELECT percentage AS last_score
        FROM `tabLMS Quiz Attempt`
        WHERE employee = %(emp)s
        ORDER BY submitted_at DESC LIMIT 1
    """, {"emp": emp_id}, as_dict=True)

    quiz_perf = {
        "best_score":     flt((best[0].best_score     if best else 0) or 0, 1),
        "last_score":     flt((last[0].last_score     if last else 0) or 0, 1),
        "total_attempts": cint((best[0].total_attempts if best else 0) or 0),
        "passed":         cint((best[0].passed_count   if best else 0) or 0),
    }

    # ── 9. Assignment summary ────────────────────────────────────────────────
    ar = frappe.db.sql("""
        SELECT SUM(status = 'Pending')  AS pending,
               SUM(status = 'Approved') AS approved,
               SUM(status = 'Rejected') AS rejected
        FROM `tabLMS Assignment Submission`
        WHERE employee = %(emp)s
    """, {"emp": emp_id}, as_dict=True)
    a = ar[0] if ar else {}

    return {
        "error":            False,
        "employee":         emp,
        "overall_progress": overall_pct,
        "total_lessons":    total_all,
        "done_lessons":     total_done,
        "my_courses":       my_courses,
        "activity_timeline": activity_timeline,
        "quiz_performance": quiz_perf,
        "assignment_summary": {
            "pending":  cint(a.get("pending")  or 0),
            "approved": cint(a.get("approved") or 0),
            "rejected": cint(a.get("rejected") or 0),
        },
    }


@frappe.whitelist()
def get_course_detail(course):
    """Kurs modal: section → lesson tree + progress."""
    user   = frappe.session.user
    emp    = _get_employee(user)
    if not emp:
        return {"error": True}
    emp_id = emp["name"]

    sections = frappe.db.get_all(
        "LMS Section",
        filters={"course": course},
        fields=["name", "section_title", "order_index"],
        order_by="order_index asc",
        ignore_permissions=True
    )
    lessons = frappe.db.get_all(
        "LMS Lesson",
        filters={"section": ["in", [s.name for s in sections]]} if sections else {"name": "__never__"},
        fields=["name", "lesson_title", "section", "order_index", "has_quiz", "has_assignment", "type"],
        order_by="order_index asc",
        ignore_permissions=True
    )
    lesson_ids = [l.name for l in lessons]
    prog_rows = frappe.db.get_all(
        "LMS Lesson Progress",
        filters={"employee": emp_id, "lesson": ["in", lesson_ids]},
        fields=["lesson", "is_completed", "completion_percent", "completed_on"],
        ignore_permissions=True
    ) if lesson_ids else []
    prog_map = {p.lesson: p for p in prog_rows}

    sec_map = {s.name: {"section_title": s.section_title, "order_index": s.order_index, "lessons": []} for s in sections}
    for l in lessons:
        p = prog_map.get(l.name)
        obj = {
            "name":               l.name,
            "lesson_title":       l.lesson_title or l.name,
            "order_index":        l.order_index,
            "type":               l.type,
            "has_quiz":           cint(l.has_quiz),
            "has_assignment":     cint(l.has_assignment),
            "is_completed":       cint(p.is_completed if p else 0),
            "completion_percent": flt(p.completion_percent if p else 0, 1),
            "completed_on":       str(p.completed_on)[:16] if p and p.completed_on else "",
        }
        if l.section and l.section in sec_map:
            sec_map[l.section]["lessons"].append(obj)

    return {"sections": sorted(sec_map.values(), key=lambda x: x["order_index"])}


def _get_employee(user):
    rows = frappe.db.get_all(
        "Employee",
        filters={"user_id": user, "status": "Active"},
        fields=["name", "employee_name", "department", "image"],
        limit=1,
        ignore_permissions=True
    )
    if not rows:
        return None
    r = rows[0]
    return {
        "name":          r.name,
        "employee_name": r.employee_name,
        "department":    r.department or "",
        "image":         r.image or "",
    }


def _empty_response(emp):
    return {
        "error": False, "employee": emp,
        "overall_progress": 0, "total_lessons": 0, "done_lessons": 0,
        "my_courses": [], "activity_timeline": [],
        "quiz_performance":   {"best_score": 0, "last_score": 0, "total_attempts": 0, "passed": 0},
        "assignment_summary": {"pending": 0, "approved": 0, "rejected": 0},
    }
