import frappe
import json
import random
from frappe import _


# ═══════════════════════════════════════════════════════════════
# INTERNAL HELPERS
# ═══════════════════════════════════════════════════════════════

def _get_employee():
    employee = frappe.db.get_value(
        "Employee", {"user_id": frappe.session.user}, "name"
    )
    if not employee:
        frappe.throw(_("Joriy foydalanuvchi uchun Xodim yozuvi topilmadi."))
    return employee


def _validate_enrollment(enrollment_name, employee=None):
    if not employee:
        employee = _get_employee()
    enr = frappe.db.get_value(
        "LMS Enrollment", enrollment_name,
        ["name", "student", "course", "status"], as_dict=True
    )
    if not enr:
        frappe.throw(_("Yozilish topilmadi."))
    if enr.student != frappe.session.user:
        frappe.throw(_("Ruxsat yo'q."))
    return enr


def _is_lesson_sidebar_complete(lesson_node):
    """Check if a sidebar lesson is fully done for sequential unlocking."""
    if not lesson_node.get("is_completed"):
        return False
    if lesson_node.get("has_quiz") and not lesson_node.get("quiz_passed"):
        return False
    if lesson_node.get("has_open_questions"):
        if lesson_node.get("require_admin_approval"):
            if not lesson_node.get("oq_graded"):
                return False
        else:
            if not lesson_node.get("oq_all_answered"):
                return False
    if lesson_node.get("has_assignment"):
        if lesson_node.get("require_admin_approval"):
            if not lesson_node.get("assignment_accepted"):
                return False
        else:
            if not lesson_node.get("assignment_submitted"):
                return False
    return True


def _check_can_go_next(lesson_row, progress, quiz_best_map, oq_data, assignment_data):
    min_watch = float(lesson_row.get("minimum_watch_percent") or 80)
    comp_pct = float((progress or {}).get("completion_percent") or 0)

    if comp_pct < min_watch:
        return False, "video_incomplete"

    if lesson_row.get("has_quiz") and lesson_row.get("quiz_id"):
        best = quiz_best_map.get(lesson_row["quiz_id"])
        if not best or not best.passed:
            return False, "quiz_not_passed"

    if lesson_row.get("has_open_questions") and oq_data:
        if not oq_data.get("all_answered"):
            return False, "open_questions_incomplete"
        if lesson_row.get("require_admin_approval"):
            if not oq_data.get("all_graded"):
                return False, "open_questions_pending_review"

    if lesson_row.get("has_assignment") and assignment_data:
        sub = assignment_data.get("submission")
        if not sub or sub.get("status") == "Rejected":
            return False, "assignment_missing"
        if lesson_row.get("require_admin_approval"):
            if sub.get("status") not in ("Approved", "Reviewed"):
                return False, "assignment_pending_review"

    return True, None


# ═══════════════════════════════════════════════════════════════
# MAIN DATA LOADER
# ═══════════════════════════════════════════════════════════════

@frappe.whitelist()
def get_player_data(lesson_name, enrollment_name):
    """
    Single entry point — loads everything the player needs.
    Max 8 SQL queries total.
    """
    employee = _get_employee()
    enr = _validate_enrollment(enrollment_name, employee)
    course_id = enr.course

    # ── Query 1: Current lesson + section + course + program + employee ────
    row = frappe.db.sql("""
        SELECT
            l.name AS lesson_name, l.lesson_title, l.video_url,
            l.video_duration_sec, l.minimum_watch_percent,
            l.has_quiz, l.quiz AS quiz_id,
            l.has_assignment, l.assignment_type, l.assignment_instruction,
            l.lesson_description,
            l.require_admin_approval,
            l.has_open_questions, l.open_question_set AS oq_set_id,
            l.order_index, l.is_free_preview, l.section AS section_id,
            c.name AS course_id, c.course_name, c.is_sequential,
            c.allow_skip, c.passing_score, c.instructor, c.program AS program_id,
            p.program_name,
            e.employee_name AS emp_display_name
        FROM `tabLMS Lesson` l
        INNER JOIN `tabLMS Section` s ON s.name = l.section
        INNER JOIN `tabLMS Course` c   ON c.name = s.course
        LEFT JOIN  `tabLMS Program` p  ON p.name = c.program
        CROSS JOIN `tabEmployee` e     ON e.name = %s
        WHERE l.name = %s AND s.course = %s
    """, (employee, lesson_name, course_id), as_dict=True)

    if not row:
        frappe.throw(_("Dars topilmadi yoki kursga tegishli emas."))
    row = row[0]

    # ── Query 2: All sections + lessons for sidebar ────────────────────────
    sidebar_raw = frappe.db.sql("""
        SELECT
            s.name AS section_name, s.section_title,
            s.order_index AS section_order,
            l.name AS lesson_name, l.lesson_title,
            l.video_duration_sec, l.order_index AS lesson_order,
            l.has_quiz, l.quiz AS quiz_id,
            l.has_open_questions, l.open_question_set AS oq_set_id,
            l.has_assignment, l.require_admin_approval, l.is_free_preview
        FROM `tabLMS Section` s
        INNER JOIN `tabLMS Lesson` l ON l.section = s.name
        WHERE s.course = %s
        ORDER BY s.order_index, l.order_index
    """, course_id, as_dict=True)

    all_lesson_names = [r.lesson_name for r in sidebar_raw]

    # ── Query 3: Lesson progress for all lessons ───────────────────────────
    progress_map = {}
    if all_lesson_names:
        lp_ph = ", ".join(["%s"] * len(all_lesson_names))
        prog_rows = frappe.db.sql(
            f"""
            SELECT lesson, watch_time_sec, last_position_sec,
                   completion_percent, is_completed, completed_on
            FROM `tabLMS Lesson Progress`
            WHERE employee = %s AND lesson IN ({lp_ph})
            """,
            [employee] + all_lesson_names, as_dict=True
        )
        progress_map = {r.lesson: r for r in prog_rows}

    # ── Query 4: Quiz attempts for all quiz IDs ────────────────────────────
    all_quiz_ids = list({r.quiz_id for r in sidebar_raw if r.quiz_id})
    quiz_best_map = {}
    quiz_all_attempts_map = {}

    if all_quiz_ids:
        qp_ph = ", ".join(["%s"] * len(all_quiz_ids))
        qa_rows = frappe.db.sql(
            f"""
            SELECT name AS attempt_name, quiz, lesson, attempt_number,
                   score, total_marks, percentage, passed,
                   submitted_at, time_taken_sec, started_at
            FROM `tabLMS Quiz Attempt`
            WHERE employee = %s AND quiz IN ({qp_ph})
            ORDER BY quiz, percentage DESC, submitted_at DESC
            """,
            [employee] + all_quiz_ids, as_dict=True
        )
        for r in qa_rows:
            quiz_all_attempts_map.setdefault(r.quiz, []).append(r)
            if r.quiz not in quiz_best_map:
                quiz_best_map[r.quiz] = r

    # ── Query 5: Open question assignment status for sidebar ───────────────
    # Aggregate per-lesson: are all OQ answers graded?
    oq_lesson_names = [r.lesson_name for r in sidebar_raw if r.has_open_questions]
    oq_graded_map = {}
    if oq_lesson_names:
        oq_ph = ", ".join(["%s"] * len(oq_lesson_names))
        oq_agg = frappe.db.sql(
            f"""
            SELECT oa.lesson,
                COUNT(oa.name) AS answered,
                SUM(CASE WHEN oa.status = 'Graded' THEN 1 ELSE 0 END) AS graded
            FROM `tabLMS Open Answer` oa
            WHERE oa.employee = %s AND oa.lesson IN ({oq_ph})
            GROUP BY oa.lesson
            """,
            [employee] + oq_lesson_names, as_dict=True
        )
        for r in oq_agg:
            oq_graded_map[r.lesson] = r

    # ── Query 6: Assignment statuses for sidebar ───────────────────────────
    assign_lesson_names = [r.lesson_name for r in sidebar_raw if r.has_assignment]
    assign_map = {}
    if assign_lesson_names:
        ap_ph = ", ".join(["%s"] * len(assign_lesson_names))
        assign_rows = frappe.db.sql(
            f"""
            SELECT lesson, status, admin_score, admin_feedback,
                   attached_file, google_sheets_url, submitted_on,
                   reviewed_by, reviewed_on, submission_type,
                   name AS submission_name
            FROM `tabLMS Assignment Submission`
            WHERE employee = %s AND lesson IN ({ap_ph})
            ORDER BY submitted_on DESC
            """,
            [employee] + assign_lesson_names, as_dict=True
        )
        for r in assign_rows:
            if r.lesson not in assign_map:
                assign_map[r.lesson] = r

    # ── Build sidebar tree ────────────────────────────────────────────────
    sections_map = {}
    for r in sidebar_raw:
        sn = r.section_name
        if sn not in sections_map:
            sections_map[sn] = {
                "section_name": sn,
                "section_title": r.section_title,
                "section_order": r.section_order or 0,
                "is_locked": False,
                "lessons": [],
            }
        prog = progress_map.get(r.lesson_name) or {}
        best_qa = quiz_best_map.get(r.quiz_id) if r.quiz_id else None
        oq_agg_r = oq_graded_map.get(r.lesson_name) or {}
        sub_r = assign_map.get(r.lesson_name)

        # Determine OQ graded / answered status
        has_oq = bool(r.has_open_questions)
        oq_graded = False
        oq_all_answered = False
        if has_oq and oq_agg_r:
            oq_graded = int(oq_agg_r.get("graded") or 0) > 0
            oq_all_answered = int(oq_agg_r.get("answered") or 0) > 0

        # Determine assignment accepted / submitted
        has_assign = bool(r.has_assignment)
        assign_accepted = False
        assign_submitted = False
        if has_assign and sub_r:
            assign_accepted = sub_r.status in ("Approved", "Reviewed")
            assign_submitted = sub_r.status not in ("Rejected",)

        sections_map[sn]["lessons"].append({
            "lesson_name": r.lesson_name,
            "lesson_title": r.lesson_title,
            "video_duration_sec": r.video_duration_sec or 0,
            "order_index": r.lesson_order or 0,
            "is_current": r.lesson_name == lesson_name,
            "is_locked": False,
            "is_completed": bool(prog.get("is_completed")),
            "completion_percent": float(prog.get("completion_percent") or 0),
            "has_quiz": bool(r.has_quiz),
            "quiz_passed": bool(best_qa and best_qa.passed),
            "has_open_questions": has_oq,
            "oq_graded": oq_graded,
            "oq_all_answered": oq_all_answered,
            "has_assignment": has_assign,
            "require_admin_approval": bool(r.require_admin_approval),
            "assignment_accepted": assign_accepted,
            "assignment_submitted": assign_submitted,
            "is_free_preview": bool(r.is_free_preview),
        })

    sections = sorted(sections_map.values(), key=lambda x: x["section_order"])
    for sec in sections:
        sec["lessons"] = sorted(sec["lessons"], key=lambda x: x["order_index"])

    # Apply sequential locking
    is_sequential = bool(row.is_sequential) and not bool(row.allow_skip)
    all_lessons_flat = []
    for sec in sections:
        all_lessons_flat.extend(sec["lessons"])

    for i, lesson in enumerate(all_lessons_flat):
        if not is_sequential or lesson.get("is_free_preview"):
            lesson["is_locked"] = False
            continue
        if i == 0:
            lesson["is_locked"] = False
        else:
            lesson["is_locked"] = not _is_lesson_sidebar_complete(all_lessons_flat[i - 1])

    # Section locking + completion counters
    for i, sec in enumerate(sections):
        done = sum(1 for l in sec["lessons"] if l["is_completed"])
        sec["completion"] = {"done": done, "total": len(sec["lessons"])}
        if i == 0:
            sec["is_locked"] = False
        else:
            prev_sec = sections[i - 1]
            sec["is_locked"] = not all(
                _is_lesson_sidebar_complete(l) for l in prev_sec["lessons"]
            )

    # ── Navigation ────────────────────────────────────────────────────────
    flat_names = [l["lesson_name"] for l in all_lessons_flat]
    try:
        idx = flat_names.index(lesson_name)
    except ValueError:
        idx = 0

    prev_lesson = flat_names[idx - 1] if idx > 0 else None
    next_lesson = flat_names[idx + 1] if idx < len(flat_names) - 1 else None

    # ── Open questions for current lesson ─────────────────────────────────
    oq_data = None
    if row.has_open_questions and row.oq_set_id:
        oq_set = frappe.db.get_value(
            "LMS Open Question", row.oq_set_id,
            ["name", "title", "passing_score"], as_dict=True
        )
        oq_items = frappe.db.sql("""
            SELECT name, question_text, question_type, marks, order_index
            FROM `tabLMS Open Question Item`
            WHERE parent = %s
            ORDER BY order_index
        """, row.oq_set_id, as_dict=True)

        item_names = [i.name for i in oq_items]
        answer_map = {}
        if item_names:
            ia_ph = ", ".join(["%s"] * len(item_names))
            ans_rows = frappe.db.sql(
                f"""
                SELECT name AS answer_name, question_item, answer_text,
                       status, score, admin_feedback, is_auto_graded, submitted_on
                FROM `tabLMS Open Answer`
                WHERE employee = %s AND lesson = %s
                  AND question_item IN ({ia_ph})
                """,
                [employee, lesson_name] + item_names, as_dict=True
            )
            answer_map = {r.question_item: r for r in ans_rows}

        total_marks = 0.0
        earned_marks = 0.0
        all_answered = True
        all_graded = True
        questions_out = []

        for item in oq_items:
            total_marks += float(item.marks or 0)
            ans = answer_map.get(item.name)
            if not ans:
                all_answered = False
                all_graded = False
            elif ans.status != "Graded":
                all_graded = False
            else:
                earned_marks += float(ans.score or 0)

            questions_out.append({
                "item_name": item.name,
                "question_text": item.question_text,
                "question_type": item.question_type,
                "marks": item.marks,
                "order_index": item.order_index,
                "answer": {
                    "answer_name": ans.answer_name,
                    "answer_text": ans.answer_text,
                    "status": ans.status,
                    "score": ans.score,
                    "admin_feedback": ans.admin_feedback,
                    "is_auto_graded": bool(ans.is_auto_graded),
                } if ans else None,
            })

        oq_data = {
            "set_name": row.oq_set_id,
            "title": oq_set.title if oq_set else "Ochiq savollar",
            "passing_score": oq_set.passing_score if oq_set else 60,
            "questions": questions_out,
            "total_marks": total_marks,
            "earned_marks": earned_marks,
            "all_answered": all_answered,
            "all_graded": all_graded,
        }

    # ── Assignment for current lesson ─────────────────────────────────────
    assignment_data = None
    if row.has_assignment:
        sub = assign_map.get(lesson_name)
        assignment_data = {
            "has_assignment": True,
            "type": row.assignment_type,
            "instruction": row.assignment_instruction or "",
            "submission": {
                "name": sub.submission_name,
                "submission_type": sub.submission_type,
                "attached_file": sub.attached_file,
                "google_sheets_url": sub.google_sheets_url,
                "status": sub.status,
                "admin_score": sub.admin_score,
                "admin_feedback": sub.admin_feedback,
                "reviewed_by": sub.reviewed_by,
                "submitted_on": str(sub.submitted_on) if sub.submitted_on else None,
            } if sub else None,
        }

    # ── Quiz detail for current lesson ─────────────────────────────────────
    quiz_out = None
    if row.has_quiz and row.quiz_id:
        q_meta = frappe.db.get_value(
            "LMS Quiz", row.quiz_id,
            ["quiz_title", "questions_to_show", "time_limit_min",
             "passing_score", "shuffle_questions", "max_attempts"],
            as_dict=True
        )
        attempts_list = quiz_all_attempts_map.get(row.quiz_id, [])
        submitted_attempts = [a for a in attempts_list if a.submitted_at]
        best_qa = quiz_best_map.get(row.quiz_id)
        used = len(submitted_attempts)
        max_att = int(q_meta.max_attempts or 0)

        # Check for incomplete attempt (page reload during quiz)
        incomplete = next(
            (a for a in attempts_list if not a.submitted_at), None
        )

        quiz_out = {
            "quiz_name": row.quiz_id,
            "quiz_title": q_meta.quiz_title,
            "questions_to_show": q_meta.questions_to_show,
            "time_limit_min": q_meta.time_limit_min,
            "passing_score": q_meta.passing_score,
            "shuffle_questions": bool(q_meta.shuffle_questions),
            "max_attempts": max_att,
            "attempts": [
                {
                    "attempt_number": a.attempt_number,
                    "percentage": round(float(a.percentage or 0), 1),
                    "passed": bool(a.passed),
                    "submitted_at": str(a.submitted_at),
                    "time_taken_sec": a.time_taken_sec,
                }
                for a in submitted_attempts
            ],
            "attempts_used": used,
            "can_retry": max_att == 0 or used < max_att,
            "best_percentage": round(float(best_qa.percentage or 0), 1) if best_qa else None,
            "is_passed": bool(best_qa and best_qa.passed),
            "incomplete_attempt_name": incomplete.attempt_name if incomplete else None,
        }

    # ── Current lesson progress ────────────────────────────────────────────
    current_prog = progress_map.get(lesson_name) or {}

    can_go_next, block_reason = _check_can_go_next(
        {
            "minimum_watch_percent": row.minimum_watch_percent,
            "has_quiz": row.has_quiz,
            "quiz_id": row.quiz_id,
            "has_open_questions": row.has_open_questions,
            "has_assignment": row.has_assignment,
            "require_admin_approval": row.require_admin_approval,
        },
        current_prog, quiz_best_map, oq_data, assignment_data
    )

    navigation = {
        "previous_lesson": prev_lesson,
        "next_lesson": next_lesson,
        "is_first": idx == 0,
        "is_last": idx == len(flat_names) - 1,
        "can_go_next": can_go_next,
        "next_blocked_reason": block_reason,
    }

    # ── Create Time Log ────────────────────────────────────────────────────
    tl = frappe.get_doc({
        "doctype": "LMS Time Log",
        "employee": employee,
        "course": course_id,
        "lesson": lesson_name,
        "activity_type": "Video",
        "session_start": frappe.utils.now(),
    })
    tl.insert(ignore_permissions=True)
    frappe.db.commit()

    return {
        "employee": employee,
        "employee_name": row.emp_display_name,
        "course": {
            "name": course_id,
            "course_name": row.course_name,
            "is_sequential": bool(row.is_sequential),
            "allow_skip": bool(row.allow_skip),
            "passing_score": row.passing_score,
            "instructor": row.instructor,
            "program_name": row.program_name,
        },
        "enrollment": {"name": enrollment_name, "status": enr.status},
        "current_lesson": {
            "name": lesson_name,
            "lesson_title": row.lesson_title,
            "video_url": row.video_url or "",
            "video_duration_sec": int(row.video_duration_sec or 0),
            "minimum_watch_percent": float(row.minimum_watch_percent or 80),
            "has_quiz": bool(row.has_quiz),
            "has_assignment": bool(row.has_assignment),
            "require_admin_approval": bool(row.require_admin_approval),
            "assignment_type": row.assignment_type or "",
            "assignment_instruction": row.assignment_instruction or "",
            "lesson_description": row.lesson_description or "",
            "has_open_questions": bool(row.has_open_questions),
            "is_free_preview": bool(row.is_free_preview),
            "order_index": int(row.order_index or 0),
        },
        "progress": {
            "watch_time_sec": int(current_prog.get("watch_time_sec") or 0),
            "last_position_sec": int(current_prog.get("last_position_sec") or 0),
            "completion_percent": float(current_prog.get("completion_percent") or 0),
            "is_completed": bool(current_prog.get("is_completed")),
            "max_watched_position": int(current_prog.get("last_position_sec") or 0),
        },
        "quiz": quiz_out,
        "open_questions": oq_data,
        "assignment": assignment_data,
        "sidebar": {"sections": sections},
        "navigation": navigation,
        "time_log_name": tl.name,
    }


# ═══════════════════════════════════════════════════════════════
# VIDEO PROGRESS
# ═══════════════════════════════════════════════════════════════

@frappe.whitelist()
def save_video_progress(lesson_name, enrollment_name, watch_time_sec,
                        last_position_sec, completion_percent):
    employee = _get_employee()
    watch_time_sec = int(float(watch_time_sec or 0))
    last_position_sec = int(float(last_position_sec or 0))
    completion_percent = float(completion_percent or 0)

    min_watch = float(
        frappe.db.get_value("LMS Lesson", lesson_name, "minimum_watch_percent") or 80
    )
    is_completed = completion_percent >= min_watch

    existing = frappe.db.get_value(
        "LMS Lesson Progress",
        {"employee": employee, "lesson": lesson_name}, "name"
    )

    if existing:
        doc = frappe.get_doc("LMS Lesson Progress", existing)
        doc.watch_time_sec = max(int(doc.watch_time_sec or 0), watch_time_sec)
        doc.last_position_sec = max(int(doc.last_position_sec or 0), last_position_sec)
        doc.completion_percent = max(float(doc.completion_percent or 0), completion_percent)
        if is_completed and not doc.is_completed:
            doc.is_completed = 1
            doc.completed_on = frappe.utils.now()
        doc.save(ignore_permissions=True)
    else:
        doc = frappe.get_doc({
            "doctype": "LMS Lesson Progress",
            "employee": employee,
            "lesson": lesson_name,
            "enrollment": enrollment_name or "",
            "watch_time_sec": watch_time_sec,
            "last_position_sec": last_position_sec,
            "completion_percent": completion_percent,
            "is_completed": 1 if is_completed else 0,
            "completed_on": frappe.utils.now() if is_completed else None,
        })
        doc.insert(ignore_permissions=True)

    frappe.db.commit()
    return {"success": True, "is_completed": is_completed}


# ═══════════════════════════════════════════════════════════════
# QUIZ ENGINE
# ═══════════════════════════════════════════════════════════════

@frappe.whitelist()
def start_quiz(quiz_name, lesson_name):
    employee = _get_employee()

    quiz = frappe.db.get_value(
        "LMS Quiz", quiz_name,
        ["quiz_title", "questions_to_show", "time_limit_min",
         "passing_score", "shuffle_questions", "max_attempts"],
        as_dict=True
    )
    if not quiz:
        frappe.throw(_("Quiz topilmadi."))

    # Check video requirement
    lesson = frappe.db.get_value(
        "LMS Lesson", lesson_name, ["minimum_watch_percent"], as_dict=True
    )
    min_watch = float((lesson or {}).get("minimum_watch_percent") or 80)
    watched_pct = float(
        frappe.db.get_value(
            "LMS Lesson Progress",
            {"employee": employee, "lesson": lesson_name},
            "completion_percent"
        ) or 0
    )
    if watched_pct < min_watch:
        frappe.throw(
            _(f"Quizni boshlash uchun videoni kamida {int(min_watch)}% ko'rishingiz kerak.")
        )

    # Count completed attempts
    max_att = int(quiz.max_attempts or 0)
    completed_count = frappe.db.count(
        "LMS Quiz Attempt",
        filters={"employee": employee, "quiz": quiz_name, "submitted_at": ["is", "set"]}
    )
    if max_att > 0 and completed_count >= max_att:
        frappe.throw(_("Urinishlar tugadi."))

    # Check for existing incomplete attempt (resume)
    incomplete = frappe.db.get_value(
        "LMS Quiz Attempt",
        {"employee": employee, "quiz": quiz_name, "submitted_at": ["is", "not set"]},
        ["name", "attempt_number", "started_at", "answers"],
        as_dict=True,
    )

    # Load questions WITHOUT is_correct
    q_rows = frappe.db.sql("""
        SELECT name AS question_name, question, marks
        FROM `tabLMS Quiz Question`
        WHERE quiz = %s
        ORDER BY idx
    """, quiz_name, as_dict=True)

    q_names = [q.question_name for q in q_rows]
    options_map = {}
    if q_names:
        op_ph = ", ".join(["%s"] * len(q_names))
        opt_rows = frappe.db.sql(
            f"""
            SELECT parent AS question_name, name, option_text
            FROM `tabLMS Answer Option`
            WHERE parent IN ({op_ph})
            ORDER BY parent, idx
            """,
            q_names, as_dict=True
        )
        for o in opt_rows:
            options_map.setdefault(o.question_name, []).append(
                {"name": o.name, "option_text": o.option_text}
            )

    questions = [
        {
            "question_name": q.question_name,
            "question": q.question,
            "marks": float(q.marks or 0),
            "options": options_map.get(q.question_name, []),
        }
        for q in q_rows
    ]

    if quiz.shuffle_questions:
        random.shuffle(questions)

    limit = int(quiz.questions_to_show or 0)
    if 0 < limit < len(questions):
        questions = questions[:limit]

    time_limit_sec = int((quiz.time_limit_min or 0) * 60)

    if incomplete:
        elapsed = int(
            (frappe.utils.now_datetime() - incomplete.started_at).total_seconds()
        )
        remaining = max(0, time_limit_sec - elapsed) if time_limit_sec > 0 else 0
        saved_answers = json.loads(incomplete.answers or "{}")
        return {
            "attempt_name": incomplete.name,
            "attempt_number": incomplete.attempt_number,
            "is_resume": True,
            "remaining_sec": remaining,
            "time_limit_sec": time_limit_sec,
            "questions": questions,
            "saved_answers": saved_answers,
        }

    # New attempt
    attempt = frappe.get_doc({
        "doctype": "LMS Quiz Attempt",
        "employee": employee,
        "quiz": quiz_name,
        "lesson": lesson_name,
        "attempt_number": completed_count + 1,
        "started_at": frappe.utils.now(),
        "answers": "{}",
    })
    attempt.insert(ignore_permissions=True)
    frappe.db.commit()

    return {
        "attempt_name": attempt.name,
        "attempt_number": attempt.attempt_number,
        "is_resume": False,
        "remaining_sec": time_limit_sec,
        "time_limit_sec": time_limit_sec,
        "questions": questions,
        "saved_answers": {},
    }


@frappe.whitelist()
def save_quiz_draft(attempt_name, answers):
    """Persist in-progress answers for resume support."""
    employee = _get_employee()
    exists = frappe.db.get_value(
        "LMS Quiz Attempt",
        {"name": attempt_name, "employee": employee, "submitted_at": ["is", "not set"]},
        "name"
    )
    if not exists:
        return {"success": False}
    if isinstance(answers, str):
        answers = json.loads(answers)
    frappe.db.set_value("LMS Quiz Attempt", attempt_name, "answers", json.dumps(answers))
    frappe.db.commit()
    return {"success": True}


@frappe.whitelist()
def submit_quiz(attempt_name, answers):
    employee = _get_employee()
    attempt = frappe.db.get_value(
        "LMS Quiz Attempt",
        {"name": attempt_name, "employee": employee},
        ["name", "quiz", "lesson", "started_at", "submitted_at", "attempt_number"],
        as_dict=True
    )
    if not attempt:
        frappe.throw(_("Quiz urinishi topilmadi."))
    if attempt.submitted_at:
        frappe.throw(_("Bu urinish allaqachon topshirilgan."))

    if isinstance(answers, str):
        answers = json.loads(answers)

    # Load questions WITH is_correct for server-side grading only
    q_rows = frappe.db.sql("""
        SELECT qq.name AS question_name, qq.marks,
               ao.name AS option_name, ao.is_correct
        FROM `tabLMS Quiz Question` qq
        INNER JOIN `tabLMS Answer Option` ao ON ao.parent = qq.name
        WHERE qq.quiz = %s
    """, attempt.quiz, as_dict=True)

    q_map = {}
    for r in q_rows:
        if r.question_name not in q_map:
            q_map[r.question_name] = {"marks": float(r.marks or 0), "options": {}}
        q_map[r.question_name]["options"][r.option_name] = bool(r.is_correct)

    total_marks = 0.0
    earned_marks = 0.0
    per_question = {}

    for q_name, q_data in q_map.items():
        total_marks += q_data["marks"]
        selected = answers.get(q_name)
        correct = bool(selected and q_data["options"].get(selected))
        if correct:
            earned_marks += q_data["marks"]
        per_question[q_name] = correct

    percentage = round(earned_marks / total_marks * 100, 2) if total_marks > 0 else 0
    passing = float(frappe.db.get_value("LMS Quiz", attempt.quiz, "passing_score") or 70)
    passed = percentage >= passing
    time_taken = int(
        (frappe.utils.now_datetime() - attempt.started_at).total_seconds()
    )

    frappe.db.set_value("LMS Quiz Attempt", attempt_name, {
        "score": earned_marks,
        "total_marks": total_marks,
        "percentage": percentage,
        "passed": 1 if passed else 0,
        "answers": json.dumps(answers),
        "submitted_at": frappe.utils.now(),
        "time_taken_sec": time_taken,
    })
    frappe.db.commit()

    return {
        "score": earned_marks,
        "total_marks": total_marks,
        "percentage": percentage,
        "passed": passed,
        "time_taken_sec": time_taken,
        "per_question": per_question,
        "attempt_number": attempt.attempt_number,
    }


# ═══════════════════════════════════════════════════════════════
# OPEN QUESTIONS
# ═══════════════════════════════════════════════════════════════

@frappe.whitelist()
def save_open_answers(lesson_name, answers):
    employee = _get_employee()
    if isinstance(answers, str):
        answers = json.loads(answers)

    results = []
    for ans_data in answers:
        q_item_name = ans_data.get("question_item")
        answer_text = (ans_data.get("answer_text") or "").strip()[:5000]
        if not q_item_name:
            continue

        q_item = frappe.db.get_value(
            "LMS Open Question Item", q_item_name,
            ["question_type", "correct_answer", "marks"], as_dict=True
        )
        if not q_item:
            continue

        is_auto = q_item.question_type == "Auto"
        score = None
        status = "Pending"

        if is_auto and q_item.correct_answer and answer_text:
            correct = answer_text.strip().lower() == (q_item.correct_answer or "").strip().lower()
            score = float(q_item.marks or 0) if correct else 0.0
            status = "Graded"

        existing = frappe.db.get_value(
            "LMS Open Answer",
            {"employee": employee, "lesson": lesson_name, "question_item": q_item_name},
            "name"
        )

        if existing:
            doc = frappe.get_doc("LMS Open Answer", existing)
            doc.answer_text = answer_text
            doc.submitted_on = frappe.utils.now()
            if is_auto:
                doc.score = score
                doc.is_auto_graded = 1
                doc.status = "Graded"
            doc.save(ignore_permissions=True)
        else:
            doc = frappe.get_doc({
                "doctype": "LMS Open Answer",
                "employee": employee,
                "lesson": lesson_name,
                "question_item": q_item_name,
                "answer_text": answer_text,
                "is_auto_graded": 1 if is_auto else 0,
                "score": score,
                "status": status,
                "submitted_on": frappe.utils.now(),
            })
            doc.insert(ignore_permissions=True)

        results.append({
            "question_item": q_item_name,
            "answer_name": doc.name,
            "status": doc.status,
            "score": doc.score,
        })

    frappe.db.commit()
    return {"success": True, "results": results}


# ═══════════════════════════════════════════════════════════════
# ASSIGNMENT
# ═══════════════════════════════════════════════════════════════

@frappe.whitelist()
def submit_assignment(lesson_name, submission_type, file_url=None, google_sheets_url=None):
    employee = _get_employee()

    if submission_type == "Google Sheets" and google_sheets_url:
        if "docs.google.com" not in (google_sheets_url or ""):
            frappe.throw(_("Yaroqli Google Sheets havolasini kiriting."))

    existing = frappe.db.get_value(
        "LMS Assignment Submission",
        {"employee": employee, "lesson": lesson_name},
        ["name", "status"], as_dict=True
    )
    if existing and existing.status == "Approved":
        frappe.throw(_("Topshiriq tasdiqlangan. Qayta yuklash mumkin emas."))

    if existing:
        doc = frappe.get_doc("LMS Assignment Submission", existing.name)
        doc.submission_type = submission_type
        if file_url:
            doc.attached_file = file_url
        if google_sheets_url:
            doc.google_sheets_url = google_sheets_url
        doc.submitted_on = frappe.utils.now()
        doc.status = "Pending"
        doc.save(ignore_permissions=True)
    else:
        doc = frappe.get_doc({
            "doctype": "LMS Assignment Submission",
            "employee": employee,
            "lesson": lesson_name,
            "submission_type": submission_type,
            "attached_file": file_url or "",
            "google_sheets_url": google_sheets_url or "",
            "submitted_on": frappe.utils.now(),
            "status": "Pending",
        })
        doc.insert(ignore_permissions=True)

    frappe.db.commit()
    return {
        "submission_name": doc.name,
        "status": doc.status,
        "submitted_on": str(doc.submitted_on),
    }


# ═══════════════════════════════════════════════════════════════
# TIME LOGGING
# ═══════════════════════════════════════════════════════════════

@frappe.whitelist()
def update_time_log(time_log_name, end_reason, activity_type=None):
    employee = _get_employee()
    tl = frappe.db.get_value(
        "LMS Time Log",
        {"name": time_log_name, "employee": employee}, "name"
    )
    if not tl:
        return {"success": False}

    now = frappe.utils.now_datetime()
    doc = frappe.get_doc("LMS Time Log", time_log_name)
    doc.session_end = now
    if doc.session_start:
        doc.duration_sec = int((now - doc.session_start).total_seconds())
    doc.end_reason = end_reason
    doc.is_completed_session = 1
    if activity_type:
        doc.activity_type = activity_type
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return {"success": True}


@frappe.whitelist()
def create_time_log(lesson_name, enrollment_name, activity_type):
    employee = _get_employee()
    lesson = frappe.db.get_value("LMS Lesson", lesson_name, ["section"], as_dict=True)
    course = frappe.db.get_value("LMS Section", lesson.section, "course") if lesson else None

    doc = frappe.get_doc({
        "doctype": "LMS Time Log",
        "employee": employee,
        "course": course,
        "lesson": lesson_name,
        "activity_type": activity_type,
        "session_start": frappe.utils.now(),
    })
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"time_log_name": doc.name}


# ═══════════════════════════════════════════════════════════════
# COMPLETION CHECK
# ═══════════════════════════════════════════════════════════════

@frappe.whitelist()
def check_completion_status(lesson_name, enrollment_name):
    employee = _get_employee()
    _validate_enrollment(enrollment_name, employee)

    lesson = frappe.db.get_value(
        "LMS Lesson", lesson_name,
        ["minimum_watch_percent", "has_quiz", "quiz",
         "has_open_questions", "open_question_set", "has_assignment"],
        as_dict=True
    )
    if not lesson:
        frappe.throw(_("Dars topilmadi."))

    prog = frappe.db.get_value(
        "LMS Lesson Progress",
        {"employee": employee, "lesson": lesson_name},
        ["completion_percent", "is_completed"], as_dict=True
    ) or {}

    blocked = []
    min_watch = float(lesson.minimum_watch_percent or 80)
    if float(prog.get("completion_percent") or 0) < min_watch:
        blocked.append("video_incomplete")

    if lesson.has_quiz and lesson.quiz:
        passed = frappe.db.get_value(
            "LMS Quiz Attempt",
            {"employee": employee, "quiz": lesson.quiz, "passed": 1}, "name"
        )
        if not passed:
            blocked.append("quiz_not_passed")

    if lesson.has_open_questions and lesson.open_question_set:
        oq_set = frappe.get_doc("LMS Open Question", lesson.open_question_set)
        total_q = len(oq_set.questions)
        answered = frappe.db.count(
            "LMS Open Answer", {"employee": employee, "lesson": lesson_name}
        )
        if answered < total_q:
            blocked.append("open_questions_incomplete")

    if lesson.has_assignment:
        sub_status = frappe.db.get_value(
            "LMS Assignment Submission",
            {"employee": employee, "lesson": lesson_name}, "status"
        )
        if not sub_status or sub_status == "Rejected":
            blocked.append("assignment_missing")

    lesson_completed = len(blocked) == 0

    if lesson_completed:
        existing = frappe.db.get_value(
            "LMS Lesson Progress",
            {"employee": employee, "lesson": lesson_name}, "name"
        )
        if existing:
            doc = frappe.get_doc("LMS Lesson Progress", existing)
            if not doc.is_completed:
                doc.is_completed = 1
                doc.completed_on = frappe.utils.now()
                doc.save(ignore_permissions=True)
                frappe.db.commit()

    # Check if this was the last lesson → complete enrollment
    if lesson_completed and enrollment_name:
        _try_complete_enrollment(employee, enrollment_name)

    return {
        "can_proceed": lesson_completed,
        "blocked_reasons": blocked,
        "lesson_completed": lesson_completed,
    }


def _try_complete_enrollment(employee, enrollment_name):
    """Mark enrollment Completed if all lessons are done."""
    enr = frappe.db.get_value(
        "LMS Enrollment", enrollment_name, ["course", "status"], as_dict=True
    )
    if not enr or enr.status == "Completed":
        return

    all_lessons = frappe.db.sql("""
        SELECT l.name
        FROM `tabLMS Lesson` l
        INNER JOIN `tabLMS Section` s ON s.name = l.section
        WHERE s.course = %s
    """, enr.course, as_dict=True)

    if not all_lessons:
        return

    lesson_names = [l.name for l in all_lessons]
    lp_ph = ", ".join(["%s"] * len(lesson_names))
    completed_count = frappe.db.sql(
        f"""
        SELECT COUNT(*) AS cnt
        FROM `tabLMS Lesson Progress`
        WHERE employee = %s AND lesson IN ({lp_ph}) AND is_completed = 1
        """,
        [employee] + lesson_names, as_dict=True
    )
    done = int((completed_count[0].cnt if completed_count else 0))
    if done >= len(lesson_names):
        frappe.db.set_value("LMS Enrollment", enrollment_name, "status", "Completed")
        frappe.db.commit()


# ═══════════════════════════════════════════════════════════════
# BEACON ENDPOINT (page unload)
# ═══════════════════════════════════════════════════════════════

@frappe.whitelist()
def save_on_unload(lesson_name, time_log_name, enrollment_name="",
                   watch_time_sec=0, last_position_sec=0, completion_percent=0):
    """Called via navigator.sendBeacon. Must not throw — silent on failure."""
    try:
        employee = _get_employee()
        tl = frappe.db.get_value(
            "LMS Time Log",
            {"name": time_log_name, "employee": employee}, "name"
        )
        if tl:
            now = frappe.utils.now_datetime()
            doc = frappe.get_doc("LMS Time Log", time_log_name)
            doc.session_end = now
            if doc.session_start:
                doc.duration_sec = int((now - doc.session_start).total_seconds())
            doc.end_reason = "page_unload"
            doc.is_completed_session = 1
            doc.save(ignore_permissions=True)

        if int(float(last_position_sec or 0)) > 0:
            save_video_progress(
                lesson_name, enrollment_name,
                watch_time_sec, last_position_sec, completion_percent
            )
        frappe.db.commit()
    except Exception:
        pass
    return "ok"
