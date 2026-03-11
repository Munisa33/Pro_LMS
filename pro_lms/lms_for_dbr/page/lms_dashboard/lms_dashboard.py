"""
LMS Student Dashboard — Backend API  v4.0.0
Fixes:
  • LMS Course has no image/description fields → removed
  • Added: time_spent, assignment detail, quiz per-question, open-answer review
"""
import json
import frappe
from frappe.utils import flt, cint


def get_context(context):
    context.no_cache = 1


# ═══════════════════════════════════════════════════════════════════════════════
#  MAIN DASHBOARD
# ═══════════════════════════════════════════════════════════════════════════════
@frappe.whitelist()
def get_dashboard_data():
    user   = frappe.session.user
    emp    = _get_employee(user)
    if not emp:
        return {"error": True, "message": "Hodim topilmadi. HR modulida foydalanuvchini Employee ga bog'lang."}

    emp_id = emp["name"]

    # ── 1. Enrollments ───────────────────────────────────────────────────────
    enrollments = frappe.db.get_all(
        "LMS Enrollment",
        filters={"student": user},
        fields=["name", "course", "status"],
        ignore_permissions=True
    )
    if not enrollments:
        return _empty_response(emp)

    course_ids    = [e.course for e in enrollments]
    enr_by_course = {e.course: e for e in enrollments}

    # ── 2. Course info (only fields that actually exist) ─────────────────────
    courses = frappe.db.get_all(
        "LMS Course",
        filters={"name": ["in", course_ids]},
        fields=["name", "course_name", "program", "passing_score",
                "is_sequential", "allow_skip"],
        ignore_permissions=True
    )
    course_map = {c.name: c for c in courses}

    # ── 3. Total lessons per course ──────────────────────────────────────────
    lesson_count_rows = frappe.db.sql("""
        SELECT s.course, COUNT(l.name) AS total
        FROM `tabLMS Lesson`  l
        JOIN `tabLMS Section` s ON s.name = l.section
        WHERE s.course IN %(courses)s
        GROUP BY s.course
    """, {"courses": course_ids}, as_dict=True)
    total_by_course = {r.course: r.total for r in lesson_count_rows}

    # ── 4. Completed lessons per course ──────────────────────────────────────
    completed_rows = frappe.db.sql("""
        SELECT s.course,
               COUNT(lp.name)       AS completed,
               MAX(lp.completed_on) AS last_activity
        FROM `tabLMS Lesson Progress` lp
        JOIN `tabLMS Lesson`          l  ON l.name  = lp.lesson
        JOIN `tabLMS Section`         s  ON s.name  = l.section
        WHERE lp.employee     = %(emp)s
          AND lp.is_completed = 1
          AND s.course IN %(courses)s
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

    # ── 6. Time spent per course (LMS Time Log) ──────────────────────────────
    time_rows = frappe.db.sql("""
        SELECT tl.course, SUM(tl.duration_sec) AS total_sec
        FROM `tabLMS Time Log` tl
        WHERE tl.employee = %(emp)s
          AND tl.course IN %(courses)s
          AND tl.is_completed_session = 1
        GROUP BY tl.course
    """, {"emp": emp_id, "courses": course_ids}, as_dict=True)
    time_by_course = {r.course: cint(r.total_sec or 0) for r in time_rows}

    # ── 7. Build courses list ────────────────────────────────────────────────
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
            "program":           c.program if c else None,
            "passing_score":     flt(c.passing_score if c else 0),
            "enr_status":        enr.status,
            "total_lessons":     total,
            "done_lessons":      done,
            "progress_pct":      pct,
            "is_completed":      enr.status == "Completed",
            "next_lesson":       nl["lesson_name"] if nl else None,
            "next_lesson_title": nl["lesson_title"] if nl else "Yakunlangan",
            "last_activity":     str(comp["last_activity"])[:16] if comp and comp["last_activity"] else None,
            "time_spent_sec":    time_by_course.get(cid, 0),
        })

    my_courses.sort(key=lambda x: (-x["progress_pct"], x["course_name"]))
    overall_pct = round((total_done / total_all * 100) if total_all > 0 else 0, 1)

    # ── 8. Total time spent (all courses) ────────────────────────────────────
    total_time_row = frappe.db.sql("""
        SELECT SUM(duration_sec) AS total_sec
        FROM `tabLMS Time Log`
        WHERE employee = %(emp)s AND is_completed_session = 1
    """, {"emp": emp_id}, as_dict=True)
    total_time_sec = cint((total_time_row[0].total_sec if total_time_row else 0) or 0)

    # ── 9. Activity timeline ─────────────────────────────────────────────────
    timeline_rows = frappe.db.sql("""
        (
            SELECT 'lesson'              AS atype,
                   lp.completed_on       AS atime,
                   l.lesson_title        AS title,
                   c.course_name         AS subtitle,
                   lp.completion_percent AS value,
                   NULL                  AS extra
            FROM `tabLMS Lesson Progress` lp
            JOIN `tabLMS Lesson`          l  ON l.name  = lp.lesson
            JOIN `tabLMS Section`         s  ON s.name  = l.section
            JOIN `tabLMS Course`          c  ON c.name  = s.course
            WHERE lp.employee    = %(emp)s
              AND lp.is_completed = 1
        )
        UNION ALL
        (
            SELECT 'quiz'                              AS atype,
                   qa.submitted_at                     AS atime,
                   CONCAT(l.lesson_title, ' — Quiz')   AS title,
                   c.course_name                       AS subtitle,
                   qa.percentage                       AS value,
                   IF(qa.passed, 'passed', 'failed')   AS extra
            FROM `tabLMS Quiz Attempt`    qa
            JOIN `tabLMS Lesson`          l  ON l.name  = qa.lesson
            JOIN `tabLMS Section`         s  ON s.name  = l.section
            JOIN `tabLMS Course`          c  ON c.name  = s.course
            WHERE qa.employee = %(emp)s
        )
        UNION ALL
        (
            SELECT 'assignment'                        AS atype,
                   asub.submitted_on                   AS atime,
                   CONCAT(l.lesson_title, ' — Topshiriq') AS title,
                   c.course_name                       AS subtitle,
                   COALESCE(asub.admin_score, 0)       AS value,
                   asub.status                         AS extra
            FROM `tabLMS Assignment Submission` asub
            JOIN `tabLMS Lesson`                l  ON l.name  = asub.lesson
            JOIN `tabLMS Section`               s  ON s.name  = l.section
            JOIN `tabLMS Course`                c  ON c.name  = s.course
            WHERE asub.employee = %(emp)s
        )
        UNION ALL
        (
            SELECT 'open_answer'                       AS atype,
                   oa.submitted_on                     AS atime,
                   CONCAT(l.lesson_title, ' — Ochiq savol') AS title,
                   c.course_name                       AS subtitle,
                   COALESCE(oa.score, 0)               AS value,
                   oa.status                           AS extra
            FROM `tabLMS Open Answer`   oa
            JOIN `tabLMS Lesson`        l  ON l.name  = oa.lesson
            JOIN `tabLMS Section`       s  ON s.name  = l.section
            JOIN `tabLMS Course`        c  ON c.name  = s.course
            WHERE oa.employee = %(emp)s
        )
        ORDER BY atime DESC
        LIMIT 40
    """, {"emp": emp_id}, as_dict=True)

    activity_timeline = [{
        "type":     r.atype,
        "time":     str(r.atime)[:16] if r.atime else "",
        "title":    r.title or "",
        "subtitle": r.subtitle or "",
        "value":    flt(r.value, 1),
        "extra":    r.extra or "",
    } for r in timeline_rows]

    # ── 10. Quiz performance ─────────────────────────────────────────────────
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

    # ── 11. Assignment summary ───────────────────────────────────────────────
    ar = frappe.db.sql("""
        SELECT SUM(status = 'Pending')  AS pending,
               SUM(status = 'Approved') AS approved,
               SUM(status = 'Rejected') AS rejected,
               SUM(status = 'Reviewed') AS reviewed
        FROM `tabLMS Assignment Submission`
        WHERE employee = %(emp)s
    """, {"emp": emp_id}, as_dict=True)
    a = ar[0] if ar else {}

    # ── 12. Open answer summary ──────────────────────────────────────────────
    oa_sum = frappe.db.sql("""
        SELECT SUM(status = 'Pending') AS pending,
               SUM(status = 'Graded')  AS graded
        FROM `tabLMS Open Answer`
        WHERE employee = %(emp)s
    """, {"emp": emp_id}, as_dict=True)
    oa = oa_sum[0] if oa_sum else {}

    return {
        "error":            False,
        "employee":         emp,
        "overall_progress": overall_pct,
        "total_lessons":    total_all,
        "done_lessons":     total_done,
        "total_time_sec":   total_time_sec,
        "my_courses":       my_courses,
        "activity_timeline": activity_timeline,
        "quiz_performance": quiz_perf,
        "assignment_summary": {
            "pending":  cint(a.get("pending")  or 0),
            "approved": cint(a.get("approved") or 0),
            "rejected": cint(a.get("rejected") or 0),
            "reviewed": cint(a.get("reviewed") or 0),
        },
        "open_answer_summary": {
            "pending": cint(oa.get("pending") or 0),
            "graded":  cint(oa.get("graded")  or 0),
        },
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  COURSE DETAIL MODAL
# ═══════════════════════════════════════════════════════════════════════════════
@frappe.whitelist()
def get_course_detail(course):
    """Section → Lesson tree + progress + per-lesson assignment/quiz/open_answer."""
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
    if not sections:
        return {"sections": []}

    lessons = frappe.db.get_all(
        "LMS Lesson",
        filters={"section": ["in", [s.name for s in sections]]},
        fields=["name", "lesson_title", "section", "order_index",
                "has_quiz", "quiz", "has_assignment", "assignment_type",
                "has_open_questions", "open_question_set",
                "video_duration_sec", "minimum_watch_percent"],
        order_by="order_index asc",
        ignore_permissions=True
    )
    lesson_ids = [l.name for l in lessons]

    # Lesson progress
    prog_rows = frappe.db.get_all(
        "LMS Lesson Progress",
        filters={"employee": emp_id, "lesson": ["in", lesson_ids]},
        fields=["lesson", "is_completed", "completion_percent",
                "completed_on", "watch_time_sec"],
        ignore_permissions=True
    ) if lesson_ids else []
    prog_map = {p.lesson: p for p in prog_rows}

    # Quiz attempts per lesson (best attempt)
    quiz_rows = frappe.db.sql("""
        SELECT lesson,
               MAX(percentage)  AS best_pct,
               COUNT(*)         AS attempts,
               MAX(passed)      AS passed,
               MAX(submitted_at) AS last_at
        FROM `tabLMS Quiz Attempt`
        WHERE employee = %(emp)s AND lesson IN %(lessons)s
        GROUP BY lesson
    """, {"emp": emp_id, "lessons": lesson_ids}, as_dict=True) if lesson_ids else []
    quiz_map = {r.lesson: r for r in quiz_rows}

    # Assignment submissions per lesson (latest)
    asgn_rows = frappe.db.sql("""
        SELECT lesson, status, admin_score, admin_feedback,
               submitted_on, attached_file, google_sheets_url,
               reviewed_by, reviewed_on, submission_type
        FROM `tabLMS Assignment Submission`
        WHERE employee = %(emp)s AND lesson IN %(lessons)s
        ORDER BY submitted_on DESC
    """, {"emp": emp_id, "lessons": lesson_ids}, as_dict=True) if lesson_ids else []
    # Keep latest per lesson
    asgn_map = {}
    for r in asgn_rows:
        if r.lesson not in asgn_map:
            asgn_map[r.lesson] = r

    # Open answers per lesson (aggregate)
    oa_rows = frappe.db.sql("""
        SELECT lesson,
               COUNT(*)        AS total_questions,
               SUM(status = 'Graded') AS graded_count,
               AVG(score)      AS avg_score
        FROM `tabLMS Open Answer`
        WHERE employee = %(emp)s AND lesson IN %(lessons)s
        GROUP BY lesson
    """, {"emp": emp_id, "lessons": lesson_ids}, as_dict=True) if lesson_ids else []
    oa_map = {r.lesson: r for r in oa_rows}

    sec_map = {
        s.name: {
            "section_title": s.section_title,
            "order_index":   s.order_index,
            "lessons":       []
        }
        for s in sections
    }

    for l in lessons:
        p    = prog_map.get(l.name)
        qz   = quiz_map.get(l.name)
        asub = asgn_map.get(l.name)
        oa   = oa_map.get(l.name)

        obj = {
            "name":               l.name,
            "lesson_title":       l.lesson_title or l.name,
            "order_index":        l.order_index,
            "video_duration_sec": cint(l.video_duration_sec),
            "has_quiz":           cint(l.has_quiz),
            "has_assignment":     cint(l.has_assignment),
            "assignment_type":    l.assignment_type or "",
            "has_open_questions": cint(l.has_open_questions),
            # Progress
            "is_completed":       cint(p.is_completed if p else 0),
            "completion_percent": flt(p.completion_percent if p else 0, 1),
            "watch_time_sec":     cint(p.watch_time_sec if p else 0),
            "completed_on":       str(p.completed_on)[:16] if p and p.completed_on else "",
            # Quiz
            "quiz_attempts":      cint(qz.attempts if qz else 0),
            "quiz_best_pct":      flt(qz.best_pct  if qz else 0, 1),
            "quiz_passed":        bool(qz.passed    if qz else False),
            "quiz_last_at":       str(qz.last_at)[:16] if qz and qz.last_at else "",
            # Assignment
            "asgn_status":        asub.status         if asub else None,
            "asgn_score":         flt(asub.admin_score if asub else 0, 1),
            "asgn_feedback":      asub.admin_feedback  if asub else "",
            "asgn_file":          asub.attached_file   if asub else "",
            "asgn_url":           asub.google_sheets_url if asub else "",
            "asgn_type":          asub.submission_type   if asub else "",
            "asgn_submitted_on":  str(asub.submitted_on)[:16] if asub and asub.submitted_on else "",
            "asgn_reviewed_by":   asub.reviewed_by     if asub else "",
            "asgn_reviewed_on":   str(asub.reviewed_on)[:16] if asub and asub.reviewed_on else "",
            # Open answers
            "oa_total":           cint(oa.total_questions if oa else 0),
            "oa_graded":          cint(oa.graded_count    if oa else 0),
            "oa_avg_score":       flt(oa.avg_score        if oa else 0, 1),
        }
        if l.section and l.section in sec_map:
            sec_map[l.section]["lessons"].append(obj)

    return {
        "sections": sorted(sec_map.values(), key=lambda x: x["order_index"])
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  QUIZ DETAIL — per question breakdown
# ═══════════════════════════════════════════════════════════════════════════════
@frappe.whitelist()
def get_quiz_detail(lesson):
    """Returns best quiz attempt with per-question answer breakdown."""
    user   = frappe.session.user
    emp    = _get_employee(user)
    if not emp:
        return {"error": True}
    emp_id = emp["name"]

    # Best attempt (highest percentage)
    attempts = frappe.db.sql("""
        SELECT name, quiz, score, total_marks, percentage, passed,
               answers, attempt_number, submitted_at, time_taken_sec
        FROM `tabLMS Quiz Attempt`
        WHERE employee = %(emp)s AND lesson = %(lesson)s
        ORDER BY percentage DESC, submitted_at DESC
        LIMIT 1
    """, {"emp": emp_id, "lesson": lesson}, as_dict=True)

    if not attempts:
        return {"attempts": [], "questions": []}

    # All attempts summary
    all_attempts = frappe.db.sql("""
        SELECT attempt_number, percentage, passed, submitted_at, time_taken_sec
        FROM `tabLMS Quiz Attempt`
        WHERE employee = %(emp)s AND lesson = %(lesson)s
        ORDER BY attempt_number ASC
    """, {"emp": emp_id, "lesson": lesson}, as_dict=True)

    best = attempts[0]
    answers_raw = best.answers or "{}"
    try:
        answers_dict = json.loads(answers_raw) if isinstance(answers_raw, str) else (answers_raw or {})
    except Exception:
        answers_dict = {}

    # Fetch quiz questions with options
    quiz_id = best.quiz
    questions_raw = frappe.db.get_all(
        "LMS Quiz Question",
        filters={"quiz": quiz_id},
        fields=["name", "question", "marks"],
        order_by="name asc",
        ignore_permissions=True
    ) if quiz_id else []

    questions_out = []
    for q in questions_raw:
        options = frappe.db.get_all(
            "LMS Answer Option",
            filters={"parent": q.name},
            fields=["name", "option_text", "is_correct"],
            order_by="idx asc",
            ignore_permissions=True
        )
        # answers_dict key: question name OR idx — try both
        student_answer = (
            answers_dict.get(q.name) or
            answers_dict.get(str(q.name)) or
            ""
        )
        correct_option = next((o.option_text for o in options if cint(o.is_correct)), "")
        is_correct_ans = False
        chosen_text    = ""
        for o in options:
            if o.name == student_answer or o.option_text == student_answer:
                chosen_text    = o.option_text
                is_correct_ans = bool(cint(o.is_correct))
                break

        questions_out.append({
            "question":        q.question,
            "marks":           flt(q.marks, 1),
            "options":         [{"text": o.option_text, "is_correct": bool(cint(o.is_correct))} for o in options],
            "student_answer":  chosen_text or str(student_answer),
            "correct_answer":  correct_option,
            "is_correct":      is_correct_ans,
        })

    return {
        "best": {
            "score":          flt(best.score, 1),
            "total_marks":    flt(best.total_marks, 1),
            "percentage":     flt(best.percentage, 1),
            "passed":         bool(best.passed),
            "submitted_at":   str(best.submitted_at)[:16] if best.submitted_at else "",
            "time_taken_sec": cint(best.time_taken_sec),
            "attempt_number": cint(best.attempt_number),
        },
        "all_attempts": [{
            "attempt_number": cint(r.attempt_number),
            "percentage":     flt(r.percentage, 1),
            "passed":         bool(r.passed),
            "submitted_at":   str(r.submitted_at)[:16] if r.submitted_at else "",
            "time_taken_sec": cint(r.time_taken_sec),
        } for r in all_attempts],
        "questions": questions_out,
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  ASSIGNMENT DETAIL
# ═══════════════════════════════════════════════════════════════════════════════
@frappe.whitelist()
def get_assignment_detail(lesson):
    """Returns all assignment submissions for a lesson with full admin feedback."""
    user   = frappe.session.user
    emp    = _get_employee(user)
    if not emp:
        return {"error": True}
    emp_id = emp["name"]

    rows = frappe.db.sql("""
        SELECT name, status, submission_type,
               attached_file, google_sheets_url,
               submitted_on, admin_score, admin_feedback,
               reviewed_by, reviewed_on
        FROM `tabLMS Assignment Submission`
        WHERE employee = %(emp)s AND lesson = %(lesson)s
        ORDER BY submitted_on DESC
    """, {"emp": emp_id, "lesson": lesson}, as_dict=True)

    # Lesson info
    lesson_doc = frappe.db.get_value(
        "LMS Lesson", lesson,
        ["lesson_title", "assignment_type", "assignment_instruction"],
        as_dict=True
    ) or {}

    return {
        "lesson_title":           lesson_doc.get("lesson_title", ""),
        "assignment_type":        lesson_doc.get("assignment_type", ""),
        "assignment_instruction": lesson_doc.get("assignment_instruction", ""),
        "submissions": [{
            "name":           r.name,
            "status":         r.status or "",
            "submission_type": r.submission_type or "",
            "attached_file":  r.attached_file or "",
            "google_sheets_url": r.google_sheets_url or "",
            "submitted_on":   str(r.submitted_on)[:16] if r.submitted_on else "",
            "admin_score":    flt(r.admin_score, 1),
            "admin_feedback": r.admin_feedback or "",
            "reviewed_by":    r.reviewed_by or "",
            "reviewed_on":    str(r.reviewed_on)[:16] if r.reviewed_on else "",
        } for r in rows]
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  OPEN ANSWER DETAIL
# ═══════════════════════════════════════════════════════════════════════════════
@frappe.whitelist()
def get_open_answer_detail(lesson):
    """Returns all open questions for a lesson with student answers and admin grades."""
    user   = frappe.session.user
    emp    = _get_employee(user)
    if not emp:
        return {"error": True}
    emp_id = emp["name"]

    # Get open question set for this lesson
    lesson_doc = frappe.db.get_value(
        "LMS Lesson", lesson,
        ["lesson_title", "open_question_set"],
        as_dict=True
    ) or {}
    oq_set = lesson_doc.get("open_question_set")

    if not oq_set:
        return {"lesson_title": lesson_doc.get("lesson_title", ""), "questions": []}

    # Questions from the set
    questions = frappe.db.get_all(
        "LMS Open Question Item",
        filters={"parent": oq_set},
        fields=["name", "question_text", "question_type", "correct_answer", "marks", "order_index"],
        order_by="order_index asc",
        ignore_permissions=True
    )
    q_ids = [q.name for q in questions]

    # Student answers
    answers = frappe.db.get_all(
        "LMS Open Answer",
        filters={"employee": emp_id, "lesson": lesson, "question_item": ["in", q_ids]},
        fields=["question_item", "answer_text", "is_auto_graded",
                "score", "status", "admin_feedback", "submitted_on",
                "graded_by", "graded_on"],
        ignore_permissions=True
    ) if q_ids else []
    ans_map = {a.question_item: a for a in answers}

    out = []
    for q in questions:
        a = ans_map.get(q.name)
        out.append({
            "question_text":    q.question_text or "",
            "question_type":    q.question_type or "Manual",
            "correct_answer":   q.correct_answer or "",
            "marks":            flt(q.marks, 1),
            "order_index":      cint(q.order_index),
            # Student answer
            "answer_text":      a.answer_text    if a else "",
            "submitted_on":     str(a.submitted_on)[:16] if a and a.submitted_on else "",
            "is_auto_graded":   bool(cint(a.is_auto_graded) if a else False),
            "score":            flt(a.score      if a else 0, 1),
            "status":           a.status         if a else "Not Submitted",
            "admin_feedback":   a.admin_feedback  if a else "",
            "graded_by":        a.graded_by       if a else "",
            "graded_on":        str(a.graded_on)[:16] if a and a.graded_on else "",
        })

    return {
        "lesson_title": lesson_doc.get("lesson_title", ""),
        "oq_set":       oq_set,
        "questions":    out,
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  HELPERS
# ═══════════════════════════════════════════════════════════════════════════════
def _get_employee(user):
    rows = frappe.db.get_all(
        "Employee",
        filters={"user_id": user, "status": "Active"},
        fields=["name", "employee_name", "department", "designation", "image"],
        limit=1,
        ignore_permissions=True
    )
    if not rows:
        return None
    r = rows[0]
    return {
        "name":          r.name,
        "employee_name": r.employee_name,
        "department":    r.department    or "",
        "designation":   r.designation  or "",
        "image":         r.image        or "",
    }


def _empty_response(emp):
    return {
        "error": False, "employee": emp,
        "overall_progress": 0, "total_lessons": 0, "done_lessons": 0,
        "total_time_sec": 0,
        "my_courses": [], "activity_timeline": [],
        "quiz_performance":    {"best_score": 0, "last_score": 0, "total_attempts": 0, "passed": 0},
        "assignment_summary":  {"pending": 0, "approved": 0, "rejected": 0, "reviewed": 0},
        "open_answer_summary": {"pending": 0, "graded": 0},
    }
"""
LMS Activity Review Table — Backend endpoint
Barcha quiz, topshiriq, ochiq javoblarni bir jadvalda ko'rsatadi.
"""
import frappe
from frappe.utils import flt, cint


@frappe.whitelist()
def get_activity_review_table():
    """
    Returns unified review table rows across:
      - LMS Quiz Attempt       (per attempt, not per question)
      - LMS Assignment Submission
      - LMS Open Answer        (per question)
    Each row: course, lesson, type, status, score, admin_feedback, action_url, needs_retry
    """
    user   = frappe.session.user
    emp    = _get_employee(user)
    if not emp:
        return {"error": True, "message": "Hodim topilmadi."}
    emp_id = emp["name"]

    rows = []

    # ── 1. Quiz Attempts ─────────────────────────────────────────────────────
    quiz_rows = frappe.db.sql("""
        SELECT
            qa.name,
            qa.lesson,
            l.lesson_title,
            c.name        AS course_id,
            c.course_name,
            qa.attempt_number,
            qa.score,
            qa.total_marks,
            qa.percentage,
            qa.passed,
            qa.submitted_at,
            qa.time_taken_sec,
            q.passing_score
        FROM `tabLMS Quiz Attempt`    qa
        JOIN `tabLMS Lesson`          l  ON l.name  = qa.lesson
        JOIN `tabLMS Section`         s  ON s.name  = l.section
        JOIN `tabLMS Course`          c  ON c.name  = s.course
        LEFT JOIN `tabLMS Quiz`       q  ON q.name  = qa.quiz
        WHERE qa.employee = %(emp)s
        ORDER BY qa.submitted_at DESC
    """, {"emp": emp_id}, as_dict=True)

    for r in quiz_rows:
        passed     = bool(r.passed)
        pct        = flt(r.percentage, 1)
        pass_score = flt(r.passing_score or 60)
        gap        = round(pass_score - pct, 1) if not passed else 0
        rows.append({
            "type":          "quiz",
            "type_label":    "🧠 Quiz",
            "course_id":     r.course_id   or "",
            "course_name":   r.course_name or "",
            "lesson":        r.lesson      or "",
            "lesson_title":  r.lesson_title or "",
            "detail":        f"Urinish #{cint(r.attempt_number)}",
            "status":        "passed" if passed else "failed",
            "status_label":  "O'tdi" if passed else "O'tmadi",
            "score":         f"{pct}%",
            "score_raw":     pct,
            "admin_feedback": "",          # Quiz auto-graded, no admin feedback
            "file_url":      "",
            "submitted_on":  str(r.submitted_at)[:16] if r.submitted_at else "",
            "needs_retry":   not passed,
            "retry_reason":  f"O'tish chegarasi {pass_score}%, sizda {pct}% (farq: {gap}%)" if not passed else "",
            "action_lesson": r.lesson or "",
        })

    # ── 2. Assignment Submissions ─────────────────────────────────────────────
    asgn_rows = frappe.db.sql("""
        SELECT
            asub.name,
            asub.lesson,
            l.lesson_title,
            c.name        AS course_id,
            c.course_name,
            asub.submission_type,
            asub.attached_file,
            asub.google_sheets_url,
            asub.status,
            asub.admin_score,
            asub.admin_feedback,
            asub.submitted_on,
            asub.reviewed_by,
            asub.reviewed_on
        FROM `tabLMS Assignment Submission` asub
        JOIN `tabLMS Lesson`                l  ON l.name  = asub.lesson
        JOIN `tabLMS Section`               s  ON s.name  = l.section
        JOIN `tabLMS Course`                c  ON c.name  = s.course
        WHERE asub.employee = %(emp)s
        ORDER BY asub.submitted_on DESC
    """, {"emp": emp_id}, as_dict=True)

    for r in asgn_rows:
        status = r.status or "Pending"
        needs_retry = status == "Rejected"
        file_url = r.attached_file or r.google_sheets_url or ""
        sub_type_icon = {
            "File":          "📎",
            "Google Sheets": "🔗",
            "Excel":         "📊",
        }.get(r.submission_type, "📁")

        rows.append({
            "type":          "assignment",
            "type_label":    "📝 Topshiriq",
            "course_id":     r.course_id   or "",
            "course_name":   r.course_name or "",
            "lesson":        r.lesson      or "",
            "lesson_title":  r.lesson_title or "",
            "detail":        f"{sub_type_icon} {r.submission_type or 'Fayl'}",
            "status":        status.lower(),
            "status_label":  {
                "Pending":  "Kutilmoqda",
                "Reviewed": "Ko'rib chiqildi",
                "Approved": "Tasdiqlandi",
                "Rejected": "Rad etildi",
            }.get(status, status),
            "score":         f"{flt(r.admin_score, 1)}" if r.admin_score else "—",
            "score_raw":     flt(r.admin_score or 0),
            "admin_feedback": r.admin_feedback or "",
            "file_url":      file_url,
            "submitted_on":  str(r.submitted_on)[:16] if r.submitted_on else "",
            "reviewed_by":   r.reviewed_by or "",
            "reviewed_on":   str(r.reviewed_on)[:16] if r.reviewed_on else "",
            "needs_retry":   needs_retry,
            "retry_reason":  "Fayl rad etilgan — qayta yuboring" if needs_retry else "",
            "action_lesson": r.lesson or "",
        })

    # ── 3. Open Answers (per question) ───────────────────────────────────────
    oa_rows = frappe.db.sql("""
        SELECT
            oa.name,
            oa.lesson,
            l.lesson_title,
            c.name           AS course_id,
            c.course_name,
            oqi.question_text,
            oqi.question_type,
            oqi.marks,
            oa.answer_text,
            oa.is_auto_graded,
            oa.score,
            oa.status,
            oa.admin_feedback,
            oa.submitted_on,
            oa.graded_by,
            oa.graded_on
        FROM `tabLMS Open Answer`        oa
        JOIN `tabLMS Lesson`             l   ON l.name  = oa.lesson
        JOIN `tabLMS Section`            s   ON s.name  = l.section
        JOIN `tabLMS Course`             c   ON c.name  = s.course
        LEFT JOIN `tabLMS Open Question Item` oqi ON oqi.name = oa.question_item
        WHERE oa.employee = %(emp)s
        ORDER BY oa.submitted_on DESC
    """, {"emp": emp_id}, as_dict=True)

    for r in oa_rows:
        status  = r.status or "Pending"
        graded  = status == "Graded"
        score   = flt(r.score or 0, 1)
        marks   = flt(r.marks or 1)
        pct_val = round((score / marks * 100) if marks > 0 else 0, 1)
        q_short = (r.question_text or "")[:60] + ("…" if len(r.question_text or "") > 60 else "")

        rows.append({
            "type":          "open_answer",
            "type_label":    "✍️ Ochiq savol",
            "course_id":     r.course_id   or "",
            "course_name":   r.course_name or "",
            "lesson":        r.lesson      or "",
            "lesson_title":  r.lesson_title or "",
            "detail":        q_short,
            "status":        "graded" if graded else "pending",
            "status_label":  "Baholandi" if graded else "Baholanmoqda",
            "score":         f"{score}/{marks}" if graded else "—",
            "score_raw":     pct_val,
            "admin_feedback": r.admin_feedback or "",
            "file_url":      "",
            "submitted_on":  str(r.submitted_on)[:16] if r.submitted_on else "",
            "graded_by":     r.graded_by or "",
            "graded_on":     str(r.graded_on)[:16] if r.graded_on else "",
            "needs_retry":   False,
            "retry_reason":  "",
            "action_lesson": r.lesson or "",
        })

    # Sort: needs_retry first, then by submitted_on desc
    rows.sort(key=lambda x: (not x["needs_retry"], x.get("submitted_on", "") or ""), reverse=False)
    # Secondary sort by submitted_on within groups
    rows.sort(key=lambda x: (not x["needs_retry"]))

    return {
        "error": False,
        "rows":  rows,
        "total": len(rows),
        "needs_retry_count": sum(1 for r in rows if r["needs_retry"]),
    }


def _get_employee(user):
    rows = frappe.db.get_all(
        "Employee",
        filters={"user_id": user, "status": "Active"},
        fields=["name", "employee_name", "department", "designation", "image"],
        limit=1,
        ignore_permissions=True
    )
    if not rows:
        return None
    r = rows[0]
    return {
        "name":          r.name,
        "employee_name": r.employee_name,
        "department":    r.department   or "",
        "designation":   r.designation or "",
        "image":         r.image       or "",
    }