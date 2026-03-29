import frappe
from frappe import _


def _get_employee():
    """Resolve current user to their Employee record. Raises if not found."""
    employee = frappe.db.get_value(
        "Employee", {"user_id": frappe.session.user}, "name"
    )
    if not employee:
        frappe.throw(_("Joriy foydalanuvchi uchun Xodim yozuvi topilmadi."))
    return employee


@frappe.whitelist()
def get_dashboard_data():
    """
    Returns complete LMS dashboard data for the logged-in employee.
    Single entry point — no waterfall calls from frontend.

    Query budget: 8 SQL queries maximum.
    """
    user = frappe.session.user
    employee = _get_employee()

    # ── Query 1: Enrollments with course and program data ──────────────────────
    enrollments = frappe.db.sql(
        """
        SELECT
            e.name            AS enrollment_name,
            e.status          AS enrollment_status,
            e.course          AS course_id,
            c.course_name,
            c.is_sequential,
            c.allow_skip,
            c.passing_score,
            c.instructor,
            c.order_index     AS course_order_index,
            c.program         AS program_id,
            p.program_name,
            p.order_index     AS program_order_index,
            p.passing_percentage AS program_passing_percentage
        FROM `tabLMS Enrollment` e
        INNER JOIN `tabLMS Course` c ON c.name = e.course
        LEFT JOIN  `tabLMS Program` p ON p.name = c.program
        WHERE e.student = %s
        ORDER BY COALESCE(p.order_index, 99999), p.program_name,
                 COALESCE(c.order_index, 99999), c.course_name
        """,
        user,
        as_dict=True,
    )

    if not enrollments:
        return {
            "summary": {
                "total_courses": 0,
                "completed_courses": 0,
                "average_score": 0,
                "total_time_spent_sec": 0,
            },
            "tree": [],
            "tasks_table": [],
        }

    course_ids = list({e.course_id for e in enrollments})
    placeholders = ", ".join(["%s"] * len(course_ids))

    # ── Query 2: Sections and lessons for all enrolled courses ─────────────────
    lessons_raw = frappe.db.sql(
        f"""
        SELECT
            l.name                   AS lesson_name,
            l.lesson_title,
            l.section                AS section_id,
            l.video_duration_sec,
            l.minimum_watch_percent,
            l.has_quiz,
            l.quiz                   AS quiz_id,
            l.has_assignment,
            l.assignment_type,
            l.has_open_questions,
            l.open_question_set      AS oq_set_id,
            l.order_index            AS lesson_order_index,
            l.is_free_preview,
            s.section_title,
            s.course                 AS course_id,
            s.order_index            AS section_order_index,
            s.name                   AS section_name,
            q.quiz_title,
            q.passing_score          AS quiz_passing_score,
            q.max_attempts           AS quiz_max_attempts,
            q.time_limit_min,
            oq.title                 AS oq_title,
            oq.passing_score         AS oq_passing_score
        FROM `tabLMS Lesson` l
        INNER JOIN `tabLMS Section` s ON s.name = l.section
        LEFT JOIN  `tabLMS Quiz` q    ON q.name  = l.quiz
        LEFT JOIN  `tabLMS Open Question` oq ON oq.name = l.open_question_set
        WHERE s.course IN ({placeholders})
        ORDER BY s.course, s.order_index, l.order_index
        """,
        course_ids,
        as_dict=True,
    )

    lesson_names = [l.lesson_name for l in lessons_raw]
    if not lesson_names:
        # Courses exist but have no lessons yet
        return _build_empty_summary(enrollments)

    lp = ", ".join(["%s"] * len(lesson_names))

    # ── Query 3: Lesson progress ───────────────────────────────────────────────
    progress_rows = frappe.db.sql(
        f"""
        SELECT
            lesson, watch_time_sec, last_position_sec,
            completion_percent, is_completed, completed_on, skip_attempts
        FROM `tabLMS Lesson Progress`
        WHERE employee = %s AND lesson IN ({lp})
        """,
        [employee] + lesson_names,
        as_dict=True,
    )
    progress_map = {r.lesson: r for r in progress_rows}

    # ── Query 4: Best quiz attempt per quiz ────────────────────────────────────
    quiz_ids = list({l.quiz_id for l in lessons_raw if l.quiz_id})
    quiz_best = {}
    quiz_attempt_counts = {}

    if quiz_ids:
        qp = ", ".join(["%s"] * len(quiz_ids))
        attempt_rows = frappe.db.sql(
            f"""
            SELECT
                name AS attempt_name,
                quiz, lesson, attempt_number,
                score, total_marks, percentage, passed, submitted_at, time_taken_sec
            FROM `tabLMS Quiz Attempt`
            WHERE employee = %s AND quiz IN ({qp})
            ORDER BY quiz, percentage DESC, submitted_at DESC
            """,
            [employee] + quiz_ids,
            as_dict=True,
        )
        for row in attempt_rows:
            quiz_attempt_counts[row.quiz] = quiz_attempt_counts.get(row.quiz, 0) + 1
            if row.quiz not in quiz_best:
                quiz_best[row.quiz] = row  # first = best due to ORDER BY percentage DESC

    # ── Query 5: Assignment submissions (most recent per lesson) ───────────────
    assign_lessons = [l.lesson_name for l in lessons_raw if l.has_assignment]
    assignment_map = {}

    if assign_lessons:
        ap = ", ".join(["%s"] * len(assign_lessons))
        sub_rows = frappe.db.sql(
            f"""
            SELECT
                name AS submission_name,
                lesson, submission_type, attached_file,
                google_sheets_url, submitted_on, status,
                admin_score, admin_feedback, reviewed_by, reviewed_on
            FROM `tabLMS Assignment Submission`
            WHERE employee = %s AND lesson IN ({ap})
            ORDER BY submitted_on DESC
            """,
            [employee] + assign_lessons,
            as_dict=True,
        )
        for row in sub_rows:
            if row.lesson not in assignment_map:
                assignment_map[row.lesson] = row

    # ── Query 6: Open question answers aggregated per lesson ──────────────────
    oq_lessons = [l.lesson_name for l in lessons_raw if l.has_open_questions]
    oq_map = {}

    if oq_lessons:
        op = ", ".join(["%s"] * len(oq_lessons))
        oq_rows = frappe.db.sql(
            f"""
            SELECT
                oa.lesson,
                COUNT(oa.name)                                    AS answered_count,
                SUM(oa.score)                                     AS raw_score,
                SUM(CASE WHEN oa.status = 'Graded'  THEN 1 ELSE 0 END) AS graded_count,
                SUM(CASE WHEN oa.status = 'Pending' THEN 1 ELSE 0 END) AS pending_count,
                MAX(oa.submitted_on)                              AS last_submitted,
                GROUP_CONCAT(
                    CASE WHEN oa.admin_feedback IS NOT NULL AND oa.admin_feedback != ''
                    THEN oa.admin_feedback END
                    ORDER BY oa.submitted_on
                    SEPARATOR ' | '
                )                                                 AS feedbacks
            FROM `tabLMS Open Answer` oa
            WHERE oa.employee = %s AND oa.lesson IN ({op})
            GROUP BY oa.lesson
            """,
            [employee] + oq_lessons,
            as_dict=True,
        )
        oq_map = {r.lesson: r for r in oq_rows}

    # ── Query 7: OQ total possible marks per open_question_set ────────────────
    oq_set_ids = list({l.oq_set_id for l in lessons_raw if l.oq_set_id})
    oq_max_marks = {}

    if oq_set_ids:
        sp = ", ".join(["%s"] * len(oq_set_ids))
        oq_meta_rows = frappe.db.sql(
            f"""
            SELECT
                oqi.parent AS oq_set_id,
                COUNT(oqi.name)  AS total_questions,
                SUM(oqi.marks)   AS total_marks
            FROM `tabLMS Open Question Item` oqi
            WHERE oqi.parent IN ({sp})
            GROUP BY oqi.parent
            """,
            oq_set_ids,
            as_dict=True,
        )
        oq_max_marks = {r.oq_set_id: r for r in oq_meta_rows}

    # ── Query 8: Total learning time ──────────────────────────────────────────
    time_result = frappe.db.sql(
        """
        SELECT COALESCE(SUM(duration_sec), 0) AS total_sec
        FROM `tabLMS Time Log`
        WHERE employee = %s AND is_completed_session = 1
        """,
        employee,
        as_dict=True,
    )
    total_time_sec = int(time_result[0].total_sec or 0) if time_result else 0

    # ── Assemble lesson nodes ──────────────────────────────────────────────────
    def build_lesson_node(lesson):
        prog = progress_map.get(lesson.lesson_name) or {}
        is_completed = bool(prog.get("is_completed"))
        completion_pct = float(prog.get("completion_percent") or 0)

        node = {
            "lesson_name": lesson.lesson_name,
            "lesson_title": lesson.lesson_title,
            "video_duration_sec": lesson.video_duration_sec or 0,
            "is_free_preview": bool(lesson.is_free_preview),
            "order_index": lesson.lesson_order_index or 0,
            "is_locked": False,
            "progress": {
                "is_completed": is_completed,
                "completion_percent": completion_pct,
                "watch_time_sec": int(prog.get("watch_time_sec") or 0),
                "completed_on": (
                    str(prog["completed_on"]) if prog.get("completed_on") else None
                ),
            },
            "quiz": None,
            "assignment": None,
            "open_questions": None,
        }

        # Quiz
        if lesson.has_quiz and lesson.quiz_id:
            best = quiz_best.get(lesson.quiz_id)
            used = quiz_attempt_counts.get(lesson.quiz_id, 0)
            max_att = lesson.quiz_max_attempts or 0
            node["quiz"] = {
                "quiz_id": lesson.quiz_id,
                "quiz_title": lesson.quiz_title or "Quiz",
                "passing_score": lesson.quiz_passing_score,
                "max_attempts": max_att,
                "time_limit_min": lesson.time_limit_min,
                "attempts_used": used,
                "can_retry": max_att == 0 or used < max_att,
                "best_attempt": {
                    "attempt_name": best.attempt_name,
                    "attempt_number": best.attempt_number,
                    "percentage": round(float(best.percentage or 0), 1),
                    "passed": bool(best.passed),
                    "submitted_at": str(best.submitted_at) if best.submitted_at else None,
                    "time_taken_sec": best.time_taken_sec,
                }
                if best
                else None,
            }

        # Assignment
        if lesson.has_assignment:
            sub = assignment_map.get(lesson.lesson_name)
            node["assignment"] = {
                "assignment_type": lesson.assignment_type,
                "submission": {
                    "submission_name": sub.submission_name,
                    "status": sub.status,
                    "score": sub.admin_score,
                    "submitted_on": str(sub.submitted_on) if sub.submitted_on else None,
                    "feedback": sub.admin_feedback,
                }
                if sub
                else None,
            }

        # Open questions
        if lesson.has_open_questions and lesson.oq_set_id:
            oqa = oq_map.get(lesson.lesson_name) or {}
            meta = oq_max_marks.get(lesson.oq_set_id) or {}
            total_q = int(meta.get("total_questions") or 0)
            total_marks = float(meta.get("total_marks") or 0)
            raw_score = float(oqa.get("raw_score") or 0)
            answered = int(oqa.get("answered_count") or 0)
            graded = int(oqa.get("graded_count") or 0)
            pending = int(oqa.get("pending_count") or 0)

            score_pct = round(raw_score / total_marks * 100, 1) if total_marks > 0 else 0

            if answered == 0:
                oq_status = "Not Started"
            elif pending > 0:
                oq_status = "Pending"
            elif graded == answered:
                oq_status = "Graded"
            else:
                oq_status = "Partially Graded"

            node["open_questions"] = {
                "oq_set_id": lesson.oq_set_id,
                "oq_title": lesson.oq_title or "Ochiq savollar",
                "passing_score": lesson.oq_passing_score,
                "total_questions": total_q,
                "answered": answered,
                "graded_count": graded,
                "pending_count": pending,
                "raw_score": raw_score,
                "score_percent": score_pct,
                "status": oq_status,
                "last_submitted": str(oqa["last_submitted"]) if oqa.get("last_submitted") else None,
            }

        return node

    # ── Group lessons into sections → courses → programs ──────────────────────
    # sections_map: course_id → section_name → {meta, lessons[]}
    sections_map = {}
    for lesson in lessons_raw:
        cid = lesson.course_id
        sid = lesson.section_name
        if cid not in sections_map:
            sections_map[cid] = {}
        if sid not in sections_map[cid]:
            sections_map[cid][sid] = {
                "section_name": sid,
                "section_title": lesson.section_title,
                "section_order_index": lesson.section_order_index or 0,
                "lessons": [],
            }
        sections_map[cid][sid]["lessons"].append(build_lesson_node(lesson))

    def build_course_tree(enr):
        raw_sections = sections_map.get(enr.course_id, {})
        sections = sorted(
            raw_sections.values(), key=lambda x: x["section_order_index"]
        )

        all_lessons_flat = []
        for sec in sections:
            sec["lessons"] = sorted(
                sec["lessons"], key=lambda x: x["order_index"]
            )
            all_lessons_flat.extend(sec["lessons"])

        # Sequential locking — tugallangan darslar HECH QACHON lock bo'lmaydi
        is_seq = bool(enr.is_sequential)
        for i, lesson in enumerate(all_lessons_flat):
            if not is_seq or lesson["is_free_preview"]:
                lesson["is_locked"] = False
                continue
            is_completed = lesson["progress"]["is_completed"]
            if i == 0 or is_completed:
                lesson["is_locked"] = False
            else:
                lesson["is_locked"] = not all_lessons_flat[i - 1]["progress"]["is_completed"]

        # Section-level progress + locking
        for i, sec in enumerate(sections):
            total_s = len(sec["lessons"])
            done_s = sum(1 for l in sec["lessons"] if l["progress"]["is_completed"])
            sec["section_progress"] = (
                round(done_s / total_s * 100) if total_s > 0 else 0
            )
            if not is_seq or i == 0:
                sec["is_locked"] = False
            else:
                prev_sec = sections[i - 1]
                sec["is_locked"] = not all(
                    l["progress"]["is_completed"] for l in prev_sec["lessons"]
                )

        total_l = len(all_lessons_flat)
        done_l = sum(1 for l in all_lessons_flat if l["progress"]["is_completed"])
        course_progress = round(done_l / total_l * 100) if total_l > 0 else 0

        return {
            "course_id": enr.course_id,
            "course_name": enr.course_name,
            "enrollment_name": enr.enrollment_name,
            "enrollment_status": enr.enrollment_status,
            "is_sequential": bool(enr.is_sequential),
            "passing_score": enr.passing_score,
            "course_progress": course_progress,
            "instructor": enr.instructor,
            "order_index": enr.course_order_index or 0,
            "is_locked": False,
            "sections": sections,
        }

    # Build program/standalone tree
    programs = {}
    standalone = []
    for enr in enrollments:
        if enr.program_id:
            if enr.program_id not in programs:
                programs[enr.program_id] = {
                    "program_id": enr.program_id,
                    "program_name": enr.program_name,
                    "program_order_index": enr.program_order_index or 0,
                    "program_passing_percentage": enr.program_passing_percentage,
                    "courses": [],
                }
            programs[enr.program_id]["courses"].append(build_course_tree(enr))
        else:
            standalone.append(build_course_tree(enr))

    # Sort programs by order_index, then build tree
    sorted_programs = sorted(
        programs.values(), key=lambda p: p.get("program_order_index") or 0
    )

    tree = []
    for prog in sorted_programs:
        # Sort courses within each program by order_index
        prog["courses"].sort(key=lambda c: c.get("order_index") or 0)
        # Course-level sequential locking — oldingi kursni tugatmay keyingisiga o'tib bo'lmaydi
        for i, course in enumerate(prog["courses"]):
            if i == 0:
                course["is_locked"] = False
            else:
                course["is_locked"] = prog["courses"][i - 1]["course_progress"] < 100
        prog_scores = [c["course_progress"] for c in prog["courses"]]
        prog["program_progress"] = (
            round(sum(prog_scores) / len(prog_scores)) if prog_scores else 0
        )
        tree.append(prog)

    # Sort standalone courses by order_index
    standalone.sort(key=lambda c: c.get("order_index") or 0)

    for course in standalone:
        tree.append({
            "program_id": None,
            "program_name": None,
            "program_progress": course["course_progress"],
            "program_passing_percentage": None,
            "courses": [course],
        })

    # ── Tasks table ───────────────────────────────────────────────────────────
    # Build a course_id → enrollment lookup for tasks
    enr_by_course = {e.course_id: e for e in enrollments}

    tasks_table = []
    for lesson in lessons_raw:
        enr = enr_by_course.get(lesson.course_id)
        if not enr:
            continue

        # Quiz row
        if lesson.has_quiz and lesson.quiz_id:
            best = quiz_best.get(lesson.quiz_id)
            used = quiz_attempt_counts.get(lesson.quiz_id, 0)
            max_att = lesson.quiz_max_attempts or 0
            if best:
                tasks_table.append({
                    "course_name": enr.course_name,
                    "lesson_title": lesson.lesson_title,
                    "lesson_name": lesson.lesson_name,
                    "enrollment_name": enr.enrollment_name,
                    "type": "Quiz",
                    "title": lesson.quiz_title or "Quiz",
                    "status": "O'tdi" if best.passed else "O'tmadi",
                    "score": round(float(best.percentage or 0), 1),
                    "date": str(best.submitted_at)[:10] if best.submitted_at else "",
                    "can_retry": max_att == 0 or used < max_att,
                    "attempt_detail_name": best.attempt_name,
                })

        # Assignment row
        if lesson.has_assignment:
            sub = assignment_map.get(lesson.lesson_name)
            if sub:
                status_labels = {
                    "Pending": "Tekshirilmoqda",
                    "Reviewed": "Ko'rib chiqildi",
                    "Approved": "Tasdiqlandi",
                    "Rejected": "Rad etildi",
                }
                tasks_table.append({
                    "course_name": enr.course_name,
                    "lesson_title": lesson.lesson_title,
                    "lesson_name": lesson.lesson_name,
                    "enrollment_name": enr.enrollment_name,
                    "type": "Assignment",
                    "title": "Topshiriq",
                    "status": status_labels.get(sub.status, sub.status),
                    "score": sub.admin_score,
                    "date": str(sub.submitted_on)[:10] if sub.submitted_on else "",
                    "can_retry": sub.status == "Rejected",
                    "attempt_detail_name": sub.submission_name,
                    "submission_type": sub.submission_type,
                    "attached_file": sub.attached_file or "",
                    "google_sheets_url": sub.google_sheets_url or "",
                    "admin_feedback": sub.admin_feedback or "",
                })

        # Open question row
        if lesson.has_open_questions:
            oqa = oq_map.get(lesson.lesson_name)
            if oqa:
                meta = oq_max_marks.get(lesson.oq_set_id or "") or {}
                total_marks = float(meta.get("total_marks") or 0)
                raw_score = float(oqa.get("raw_score") or 0)
                score_pct = round(raw_score / total_marks * 100, 1) if total_marks > 0 else None
                pending = int(oqa.get("pending_count") or 0)
                graded = int(oqa.get("graded_count") or 0)
                answered = int(oqa.get("answered_count") or 0)

                if answered == 0:
                    oq_status_label = "Javob berilmagan"
                elif pending > 0:
                    oq_status_label = "Tekshirilmoqda"
                elif graded == answered:
                    oq_status_label = "Baholandi"
                else:
                    oq_status_label = "Qisman baholandi"

                tasks_table.append({
                    "course_name": enr.course_name,
                    "lesson_title": lesson.lesson_title,
                    "lesson_name": lesson.lesson_name,
                    "enrollment_name": enr.enrollment_name,
                    "type": "Open Q",
                    "title": lesson.oq_title or "Ochiq savollar",
                    "status": oq_status_label,
                    "score": score_pct,
                    "date": str(oqa["last_submitted"])[:10] if oqa.get("last_submitted") else "",
                    "can_retry": False,
                    "attempt_detail_name": None,
                    "admin_feedback": oqa.get("feedbacks") or "",
                })

    # ── Summary ───────────────────────────────────────────────────────────────
    completed_courses = sum(1 for e in enrollments if e.enrollment_status == "Completed")
    all_scores = (
        [round(float(b.percentage or 0), 1) for b in quiz_best.values() if b.percentage is not None]
        + [float(s.admin_score) for s in assignment_map.values() if s.admin_score is not None]
    )
    avg_score = round(sum(all_scores) / len(all_scores), 1) if all_scores else 0

    return {
        "summary": {
            "total_courses": len(enrollments),
            "completed_courses": completed_courses,
            "average_score": avg_score,
            "total_time_spent_sec": total_time_sec,
        },
        "tree": tree,
        "tasks_table": tasks_table,
    }


@frappe.whitelist()
def get_oq_answers(lesson):
    """Return all open-question answers for the current employee in a given lesson."""
    employee = _get_employee()
    rows = frappe.db.sql(
        """
        SELECT
            oa.name,
            oqi.question_text,
            oqi.marks,
            oqi.order_index,
            oa.answer_text,
            oa.score,
            oa.status,
            oa.admin_feedback
        FROM `tabLMS Open Answer` oa
        JOIN `tabLMS Open Question Item` oqi ON oqi.name = oa.question_item
        WHERE oa.employee = %s AND oa.lesson = %s
        ORDER BY oqi.order_index
        """,
        [employee, lesson],
        as_dict=True,
    )
    return rows


def _build_empty_summary(enrollments):
    return {
        "summary": {
            "total_courses": len(enrollments),
            "completed_courses": 0,
            "average_score": 0,
            "total_time_spent_sec": 0,
        },
        "tree": [],
        "tasks_table": [],
    }
