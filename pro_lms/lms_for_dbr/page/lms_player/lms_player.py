"""
LMS Player — Video Learning with Anti-Skipping & Real-time Progress
========================================================================
- Video lock: Seek-bar block until 90% watch time
- Real-time progress: Every 5s saved to backend
- Sequential lock: Next lesson locked if previous incomplete
- Dashboard link: Back button
- YouTube URL Normalizer: Extracts video ID from any YouTube URL format
"""
import re
import frappe
from frappe.utils import flt, cint, now


def _extract_youtube_id(url):
    """
    Extract YouTube video ID from any known YouTube URL format:
      - https://youtu.be/VIDEO_ID
      - https://www.youtube.com/watch?v=VIDEO_ID
      - https://www.youtube.com/embed/VIDEO_ID
      - https://www.youtube.com/v/VIDEO_ID
      - https://youtube.com/shorts/VIDEO_ID
    Returns the 11-char video ID string, or None if not matched.
    """
    if not url:
        return None
    # Already a bare 11-char ID (no slashes, no dots)
    if re.fullmatch(r'[A-Za-z0-9_\-]{11}', url.strip()):
        return url.strip()
    patterns = [
        r'(?:youtu\.be/)([A-Za-z0-9_\-]{11})',
        r'(?:youtube\.com/(?:watch\?v=|embed/|v/|shorts/))([A-Za-z0-9_\-]{11})',
    ]
    for pat in patterns:
        m = re.search(pat, url)
        if m:
            return m.group(1)
    return None


def get_context(context):
    context.no_cache = 1


@frappe.whitelist()
def get_lesson_data(lesson_name):
    """
    Darning barcha ma'lumoti:
    - Video URL, quiz, assignment
    - Progress status
    - Oldingi/Keyingi darslar
    - Sequence lock info
    """
    user = frappe.session.user
    emp = _get_employee(user)
    if not emp:
        return {"error": True, "message": "Employee topilmadi"}

    emp_id = emp["name"]

    # Lesson details
    lesson = frappe.db.get_all(
        "LMS Lesson",
        filters={"name": lesson_name},
        fields=["name", "lesson_title", "course", "section", "type",
                "youtube_id", "video_url", "video_duration_sec",
                "has_quiz", "quiz", "has_assignment", "assignment_type",
                "order_index","has_open_questions", "open_question_set",  ],
        limit=1,
        ignore_permissions=True
    )
    if not lesson:
        return {"error": True, "message": "Dars topilmadi"}
    lesson = lesson[0]

    # ── YouTube ID resolution ─────────────────────────────────────────────
    # Priority: youtube_id field → extract from video_url → None
    raw_yt_id = lesson.get("youtube_id") or ""
    if not raw_yt_id:
        raw_yt_id = _extract_youtube_id(lesson.get("video_url") or "") or ""
    lesson["resolved_youtube_id"] = raw_yt_id or None

    # Get section's course (if lesson.course is null)
    if not lesson["course"]:
        section = frappe.db.get_value("LMS Section", lesson["section"], "course")
        lesson["course"] = section

    course_id = lesson["course"]

    # Enrollment check
    enr = frappe.db.get_all(
        "LMS Enrollment",
        filters={"student": user, "course": course_id},
        fields=["name", "status"],
        limit=1,
        ignore_permissions=True
    )
    if not enr:
        return {"error": True, "message": "Kursga yozilmagan"}

    # Current progress
    prog = frappe.db.get_all(
        "LMS Lesson Progress",
        filters={"employee": emp_id, "lesson": lesson_name},
        fields=["name", "is_completed", "completion_percent", "watch_time_sec",
                "last_position_sec", "creation"],
        limit=1,
        ignore_permissions=True
    )
    progress = prog[0] if prog else None

    # Sequential lock: Check if previous lesson complete
    prev_lesson = frappe.db.get_all(
        "LMS Lesson",
        filters={"section": lesson["section"], "order_index": ["<", lesson["order_index"]]},
        fields=["name", "lesson_title", "order_index"],
        order_by="order_index desc",
        limit=1,
        ignore_permissions=True
    )
    is_locked = False
    if prev_lesson:
        prev = prev_lesson[0]
        prev_prog = frappe.db.get_all(
            "LMS Lesson Progress",
            filters={"employee": emp_id, "lesson": prev["name"]},
            fields=["is_completed"],
            limit=1,
            ignore_permissions=True
        )
        is_locked = not (prev_prog and prev_prog[0]["is_completed"])

    # All lessons in course (for sidebar)
    sections = frappe.db.get_all(
        "LMS Section",
        filters={"course": course_id},
        fields=["name", "section_title", "order_index"],
        order_by="order_index asc",
        ignore_permissions=True
    )

    all_lessons = {}
    all_progs = {}
    if sections:
        sec_ids = [s["name"] for s in sections]
        all_les = frappe.db.get_all(
            "LMS Lesson",
            filters={"section": ["in", sec_ids]},
            fields=["name", "lesson_title", "section", "order_index", "has_quiz", "has_assignment"],
            order_by="order_index asc",
            ignore_permissions=True
        )
        all_lessons = {l["name"]: l for l in all_les}

        all_pro = frappe.db.get_all(
            "LMS Lesson Progress",
            filters={"employee": emp_id, "lesson": ["in", list(all_lessons.keys())]},
            fields=["lesson", "is_completed", "completion_percent"],
            ignore_permissions=True
        )
        all_progs = {p["lesson"]: p for p in all_pro}

    # Build hierarchy
    hierarchy = []
    for sec in sections:
        sec_obj = {
            "section_id": sec["name"],
            "section_title": sec["section_title"],
            "lessons": []
        }
        for les_id, les in all_lessons.items():
            if les["section"] != sec["name"]:
                continue
            p = all_progs.get(les_id, {})

            # Lock: If previous incomplete, lock this
            is_this_locked = False
            if les["order_index"] > 0:
                prev_in_sec = [l for l in all_lessons.values()
                              if l["section"] == sec["name"] and l["order_index"] < les["order_index"]]
                if prev_in_sec:
                    prev_id = prev_in_sec[-1]["name"]
                    is_this_locked = not (all_progs.get(prev_id, {}).get("is_completed", False))

            sec_obj["lessons"].append({
                "lesson_id": les_id,
                "lesson_title": les["lesson_title"],
                "is_completed": cint(p.get("is_completed", 0)),
                "completion_percent": flt(p.get("completion_percent", 0), 1),
                "is_locked": is_this_locked,
                "has_quiz": les["has_quiz"],
                "has_assignment": les["has_assignment"],
            })
        hierarchy.append(sec_obj)

    return {
        "error": False,
        "lesson": {
            "name": lesson["name"],
            "title": lesson["lesson_title"],
            "type": lesson["type"],
            "youtube_id": lesson.get("resolved_youtube_id"),
            "video_url": lesson.get("video_url"),
            "duration_sec": cint(lesson.get("video_duration_sec", 0)),
            "has_quiz": cint(lesson["has_quiz"]),
            "quiz": lesson.get("quiz"),
            "has_assignment": cint(lesson["has_assignment"]),
            "assignment_type": lesson.get("assignment_type"),
			"has_open_questions": cint(lesson.get("has_open_questions", 0)),
			"open_question_set": lesson.get("open_question_set"),
        },
        "progress": {
            "name": progress["name"] if progress else None,
            "is_completed": cint(progress["is_completed"] if progress else 0),
            "completion_percent": flt(progress["completion_percent"] if progress else 0, 1),
            "watch_time_sec": cint(progress["watch_time_sec"] if progress else 0),
            "last_position_sec": cint(progress["last_position_sec"] if progress else 0),
        },
        "is_locked": is_locked,
        "course_id": course_id,
        "hierarchy": hierarchy,
        "enrollment": enr[0] if enr else None,
    }


@frappe.whitelist()
def save_progress(lesson_name, watch_time_sec, last_position_sec, completion_percent):
    """
    Real-time progress save har 5 sekundada.
    Agar 90%+ ko'rilgan bo'lsa, lesson ni "Completed" qil.
    """
    user = frappe.session.user
    emp = _get_employee(user)
    if not emp:
        return {"error": True}

    emp_id = emp["name"]
    # Round all time values — YouTube API returns floats (e.g. 183.741s)
    completion_percent = flt(round(flt(completion_percent), 1), 1)
    watch_time_sec     = cint(round(flt(watch_time_sec)))
    last_position_sec  = cint(round(flt(last_position_sec)))

    # Existing progress
    progs = frappe.db.get_all(
        "LMS Lesson Progress",
        filters={"employee": emp_id, "lesson": lesson_name},
        fields=["name", "is_completed"],
        limit=1,
        ignore_permissions=True
    )

    is_completed = 0
    if completion_percent >= 90:
        is_completed = 1

    if progs:
        # Update — never nullify completed_on once set
        update_fields = {
            "watch_time_sec":    watch_time_sec,
            "last_position_sec": last_position_sec,
            "completion_percent": completion_percent,
            "is_completed":      is_completed,
        }
        if is_completed and not progs[0]["is_completed"]:
            update_fields["completed_on"] = now()
        frappe.db.set_value("LMS Lesson Progress", progs[0]["name"], update_fields)
    else:
        # Create via frappe.get_doc to respect hooks and field validation
        doc = frappe.get_doc({
            "doctype":          "LMS Lesson Progress",
            "employee":         emp_id,
            "lesson":           lesson_name,
            "watch_time_sec":   watch_time_sec,
            "last_position_sec": last_position_sec,
            "completion_percent": completion_percent,
            "is_completed":     is_completed,
            "completed_on":     now() if is_completed else None,
        })
        doc.flags.ignore_permissions = True
        doc.insert(ignore_permissions=True)

    frappe.db.commit()

    # ── Auto-complete enrollment: oxirgi dars tugatilsa kursni Completed qil ──
    if is_completed:
        try:
            _auto_complete_enrollment(emp_id, lesson_name)
        except Exception as e:
            frappe.log_error(f"Auto-complete enrollment error: {e}", "LMS Player")

    return {"error": False, "is_completed": is_completed}


def _auto_complete_enrollment(emp_id, lesson_name):
    """
    O'quvchi biror darsni tugatganda, uning kursidagi barcha darslar
    tugaganmi tekshiradi. Agar ha — LMS Enrollment.status = 'Completed' qilib yangilaydi.
    Real schema: Enrollment (student, course, status) — is_completed ustuni yo'q.
    """
    # Lesson → Section → Course
    lesson = frappe.db.get_value(
        "LMS Lesson", lesson_name, ["section", "course"], as_dict=True
    )
    if not lesson:
        return

    course_id = lesson.get("course")
    if not course_id and lesson.get("section"):
        course_id = frappe.db.get_value("LMS Section", lesson["section"], "course")
    if not course_id:
        return

    # Kursga tegishli barcha darslar
    sections = frappe.db.get_all(
        "LMS Section", filters={"course": course_id}, pluck="name"
    )
    if not sections:
        return

    all_lessons = frappe.db.get_all(
        "LMS Lesson", filters={"section": ["in", sections]}, pluck="name"
    )
    if not all_lessons:
        return

    total_count = len(all_lessons)

    # Shu hodim tomonidan tugatilgan darslar soni
    completed_count = frappe.db.count(
        "LMS Lesson Progress",
        filters={"employee": emp_id, "lesson": ["in", all_lessons], "is_completed": 1}
    )

    if completed_count < total_count:
        return  # Hali tugamagan darslar bor

    # Enrollment topish — student = employee.user_id
    user_id = frappe.db.get_value("Employee", emp_id, "user_id")
    if not user_id:
        return

    enrollment = frappe.db.get_all(
        "LMS Enrollment",
        filters={"student": user_id, "course": course_id},
        fields=["name", "status"],
        limit=1,
        ignore_permissions=True
    )
    if not enrollment:
        return

    enr = enrollment[0]
    if enr.status == "Completed":
        return  # Allaqachon belgilangan

    frappe.db.set_value(
        "LMS Enrollment", enr.name, "status", "Completed"
    )
    frappe.db.commit()

    # Hodimga realtime xabar
    try:
        frappe.publish_realtime(
            "course_completed",
            {"message": "🎉 Kurs muvaffaqiyatli tugatildi!", "course": course_id},
            user=user_id
        )
    except Exception:
        pass


@frappe.whitelist()
def upload_assignment(lesson_name, file_url):
    """
    Foydalanuvchi tomonidan fayl yuklanganda LMS Assignment Submission yaratadi.
    employee, lesson, course — backend tomonidan avtomatik aniqlanadi.
    """
    user = frappe.session.user
    emp  = _get_employee(user)
    if not emp:
        return {"error": True, "message": "Employee topilmadi"}

    emp_id = emp["name"]

    # Get lesson to find course
    lesson = frappe.db.get_value(
        "LMS Lesson", lesson_name,
        ["name", "lesson_title", "course", "section"],
        as_dict=True
    )
    if not lesson:
        return {"error": True, "message": "Dars topilmadi"}

    # Resolve course if not directly on lesson
    course_id = lesson.get("course")
    if not course_id and lesson.get("section"):
        course_id = frappe.db.get_value("LMS Section", lesson["section"], "course")

    # Check enrollment
    enrolled = frappe.get_all(
        "LMS Enrollment",
        filters={"student": user, "course": course_id},
        limit=1,
        ignore_permissions=True
    )
    if not enrolled:
        return {"error": True, "message": "Kursga yozilmagan"}

    # Check for existing submission to avoid duplicates
    existing = frappe.get_all(
        "LMS Assignment Submission",
        filters={"employee": emp_id, "lesson": lesson_name, "status": "Pending"},
        limit=1,
        ignore_permissions=True
    )
    if existing:
        # Update existing pending submission
        frappe.db.set_value(
            "LMS Assignment Submission", existing[0]["name"],
            {"attached_file": file_url, "submitted_on": now(),
             "submission_type": "File"}
        )
        frappe.db.commit()
        return {"error": False, "name": existing[0]["name"], "updated": True}

    doc = frappe.get_doc({
        "doctype":         "LMS Assignment Submission",
        "employee":        emp_id,
        "lesson":          lesson_name,
        "submission_type": "File",
        "attached_file":   file_url,
        "status":          "Pending",
        "submitted_on":    now(),
    })
    doc.flags.ignore_permissions = True
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"error": False, "name": doc.name, "updated": False}


def _get_employee(user):
    rows = frappe.db.get_all(
        "Employee",
        filters={"user_id": user, "status": "Active"},
        fields=["name", "employee_name"],
        limit=1,
        ignore_permissions=True
    )
    if not rows:
        return None
    r = rows[0]
    return {"name": r.name, "employee_name": r.employee_name}


@frappe.whitelist()
def get_quiz(quiz_name, lesson_name):
    """
    Quiz savollarini va meta-ma'lumotlarini qaytaradi.
    Avvalgi urinish natijasini ham qo'shadi.
    """
    user   = frappe.session.user
    emp    = _get_employee(user)
    emp_id = emp["name"] if emp else None

    # frappe.db.get_value does NOT accept ignore_permissions — use as_dict only
    quiz = frappe.db.get_value(
        "LMS Quiz", quiz_name,
        ["name", "quiz_title", "passing_score", "time_limit_min",
         "max_attempts", "shuffle_questions", "questions_to_show"],
        as_dict=True
    )
    if not quiz:
        return {"error": True, "message": "Test topilmadi"}

    # frappe.get_all (not frappe.db.get_all) accepts ignore_permissions
    questions_raw = frappe.get_all(
        "LMS Quiz Question",
        filters={"quiz": quiz_name},
        fields=["name", "question", "marks"],
        ignore_permissions=True
    )
    questions = []
    for q in questions_raw:
        opts = frappe.get_all(
            "LMS Answer Option",
            filters={"parent": q["name"], "parentfield": "options",
                     "parenttype": "LMS Quiz Question"},
            fields=["option_text", "is_correct"],
            order_by="idx asc",
            ignore_permissions=True
        )
        questions.append({
            "name":     q["name"],
            "question": q["question"],
            "marks":    flt(q["marks"]),
            "options":  [{"option_text": o["option_text"],
                          "is_correct":  cint(o["is_correct"])} for o in opts]
        })

    # Shuffle if needed
    if quiz.get("shuffle_questions"):
        import random
        random.shuffle(questions)

    # Limit questions_to_show
    limit = cint(quiz.get("questions_to_show") or 0)
    if limit and limit < len(questions):
        questions = questions[:limit]

    # Last attempt for this employee
    last_attempt = None
    if emp_id:
        attempts = frappe.get_all(
            "LMS Quiz Attempt",
            filters={"employee": emp_id, "quiz": quiz_name, "lesson": lesson_name},
            fields=["score", "total_marks", "percentage", "passed", "attempt_number"],
            order_by="attempt_number desc",
            limit=1,
            ignore_permissions=True
        )
        if attempts:
            last_attempt = attempts[0]

    return {
        "error":        False,
        "quiz":         quiz,
        "questions":    questions,
        "last_attempt": last_attempt,
    }


@frappe.whitelist()
def submit_quiz(quiz_name, lesson_name, answers, time_taken_sec=0):
    """
    Foydalanuvchi javoblarini qabul qiladi, baholaydi va LMS Quiz Attempt'ga saqlaydi.
    answers: JSON string — [{question, selected_option_idx}]
    """
    import json as _json

    user = frappe.session.user
    emp  = _get_employee(user)
    if not emp:
        return {"error": True, "message": "Employee topilmadi"}
    emp_id = emp["name"]

    quiz = frappe.db.get_value(
        "LMS Quiz", quiz_name,
        ["name", "passing_score", "max_attempts"],
        as_dict=True
    )
    if not quiz:
        return {"error": True, "message": "Test topilmadi"}

    # Max attempts check
    attempt_count = frappe.db.count(
        "LMS Quiz Attempt",
        filters={"employee": emp_id, "quiz": quiz_name, "lesson": lesson_name}
    )
    max_att = cint(quiz.get("max_attempts") or 0)
    if max_att and attempt_count >= max_att:
        return {"error": True, "message": f"Maksimal urinishlar soni ({max_att}) tugadi"}

    # Parse answers
    try:
        answers_list = _json.loads(answers) if isinstance(answers, str) else answers
    except Exception:
        return {"error": True, "message": "Javoblar formati noto'g'ri"}

    # Build answer map: {question_name: selected_option_idx}
    ans_map = {a["question"]: cint(a.get("selected_option_idx", -1)) for a in answers_list}

    # Grade
    total_marks = 0.0
    score       = 0.0
    answer_review = []

    for q_name, sel_idx in ans_map.items():
        q = frappe.db.get_value(
            "LMS Quiz Question", q_name, ["question", "marks"], as_dict=True
        )
        if not q:
            continue
        opts = frappe.get_all(
            "LMS Answer Option",
            filters={"parent": q_name, "parentfield": "options",
                     "parenttype": "LMS Quiz Question"},
            fields=["option_text", "is_correct"],
            order_by="idx asc",
            ignore_permissions=True
        )
        marks = flt(q["marks"])
        total_marks += marks

        correct_idx  = next((i for i, o in enumerate(opts) if cint(o["is_correct"])), -1)
        is_correct   = (sel_idx == correct_idx)
        if is_correct:
            score += marks

        answer_review.append({
            "question":      q["question"],
            "correct":       is_correct,
            "correct_answer": opts[correct_idx]["option_text"] if correct_idx >= 0 else "—",
        })

    percentage    = flt((score / total_marks * 100) if total_marks else 0, 1)
    passing_score = flt(quiz.get("passing_score") or 50)
    passed        = 1 if percentage >= passing_score else 0

    # Save attempt
    doc = frappe.get_doc({
        "doctype":        "LMS Quiz Attempt",
        "employee":       emp_id,
        "quiz":           quiz_name,
        "lesson":         lesson_name,
        "attempt_number": attempt_count + 1,
        "score":          score,
        "total_marks":    total_marks,
        "percentage":     percentage,
        "passed":         passed,
        "answers":        _json.dumps(ans_map),
        "started_at":     now(),
        "submitted_at":   now(),
        "time_taken_sec": cint(time_taken_sec),
    })
    doc.flags.ignore_permissions = True
    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return {
        "error":         False,
        "score":         score,
        "total_marks":   total_marks,
        "percentage":    percentage,
        "passing_score": passing_score,
        "passed":        passed,
        "attempt_number": attempt_count + 1,
        "answer_review": answer_review,
    }
# ═══════════════════════════════════════════════════════════════════════════
#  TIME TRACKING APIs
#  Bu funksiyalarni mavjud lms_player.py fayliga qo'shing.
#  Talab: "LMS Time Log" doctype avval yaratilgan bo'lishi kerak.
# ═══════════════════════════════════════════════════════════════════════════


@frappe.whitelist()
def start_session(lesson_name, activity_type="Video"):
    """
    Yangi o'quv sessiyasini boshlaydi.
    Frontend har safar video/quiz/ochiq savol ochilganda chaqiradi.

    Returns:
        {"session_id": "LMS-TL-2026-00001"}
    """
    user = frappe.session.user
    emp  = _get_employee(user)
    if not emp:
        return {"error": True, "message": "Employee topilmadi"}

    emp_id = emp["name"]

    lesson = frappe.db.get_value(
        "LMS Lesson", lesson_name, ["course", "section"], as_dict=True
    )
    if not lesson:
        return {"error": True, "message": "Dars topilmadi"}

    course_id = lesson.get("course")
    if not course_id and lesson.get("section"):
        course_id = frappe.db.get_value("LMS Section", lesson["section"], "course")

    doc = frappe.get_doc({
        "doctype":              "LMS Time Log",
        "employee":             emp_id,
        "lesson":               lesson_name,
        "course":               course_id or "",
        "activity_type":        activity_type,
        "session_start":        now(),
        "session_end":          now(),
        "duration_sec":         0,
        "is_completed_session": 0,
    })
    doc.flags.ignore_permissions = True
    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return {"error": False, "session_id": doc.name}


@frappe.whitelist()
def ping_session(session_id, activity_type=None):
    """
    30 soniyada bir chaqiriladi (heartbeat).
    session_end = now() ga yangilaydi.
    duration_sec = session_start dan hozirgacha bo'lgan farqni yozadi.
    Agar session topilmasa — yangi session boshlanishi kerak deb bildiradi.
    """
    from frappe.utils import now_datetime, get_datetime, time_diff_in_seconds

    if not frappe.db.exists("LMS Time Log", session_id):
        return {"error": True, "restart": True, "message": "Session topilmadi"}

    start_raw = frappe.db.get_value("LMS Time Log", session_id, "session_start")
    duration  = 0
    if start_raw:
        duration = max(0, int(time_diff_in_seconds(now_datetime(), get_datetime(start_raw))))

    update = {
        "session_end":  now(),
        "duration_sec": duration,
    }
    if activity_type:
        update["activity_type"] = activity_type

    frappe.db.set_value("LMS Time Log", session_id, update)
    frappe.db.commit()

    return {"error": False, "duration_sec": duration}


@frappe.whitelist()
def end_session(session_id, reason="normal"):
    """
    Sessiyani rasman yakunlaydi.
    sendBeacon (page unload) hamda oddiy frappe.call orqali chaqirilishi mumkin.

    MUHIM: sendBeacon FormData'da X-Frappe-CSRF-Token yuboradi —
    Frappe v15 uni form_dict dan qabul qiladi, shuning uchun ishlaydi.

    Returns:
        {"duration_sec": 185}
    """
    from frappe.utils import now_datetime, get_datetime, time_diff_in_seconds

    if not frappe.db.exists("LMS Time Log", session_id):
        return {"error": True}

    start_raw = frappe.db.get_value("LMS Time Log", session_id, "session_start")
    duration  = 0
    if start_raw:
        duration = max(0, int(time_diff_in_seconds(now_datetime(), get_datetime(start_raw))))

    frappe.db.set_value("LMS Time Log", session_id, {
        "session_end":          now(),
        "duration_sec":         duration,
        "end_reason":           reason,
        "is_completed_session": 1,
    })
    frappe.db.commit()

    return {"error": False, "duration_sec": duration}


@frappe.whitelist()
def get_time_stats(employee=None, course=None, period="today"):
    """
    LMS Time Log dan sof vaqt statistikasini qaytaradi.

    Kirishlar:
        employee  — Employee name (admin uchun ixtiyoriy, boshqalar uchun e'tiborga olinmaydi)
        course    — LMS Course name (ixtiyoriy filter)
        period    — "today" | "week" | "month" | "year" | "all"

    Qaytaradi:
        {
            total_sec, total_formatted,
            session_count,
            by_course:    {course_id: sec, ...},
            by_activity:  {"Video": sec, "Quiz": sec, ...},
            by_day:       {"2026-03-11": sec, ...},
            breakdown:    [{lesson, activity_type, duration_sec, session_start}]
        }
    """
    from frappe.utils import today, add_days, get_first_day
    from datetime import date as _date

    user       = frappe.session.user
    emp        = _get_employee(user)
    user_roles = set(frappe.get_roles(user))
    is_admin   = bool({"System Manager", "LMS Admin", "HR Manager"} & user_roles)

    # Ruxsat: admin istalgan hodimni ko'ra oladi; employee faqat o'zini
    if not is_admin:
        if not emp:
            return {"error": True, "message": "Employee topilmadi"}
        employee = emp["name"]

    filters = {"is_completed_session": 1}
    if employee:
        filters["employee"] = employee
    if course:
        filters["course"] = course

    # Davr filtri
    period_map = {
        "today": today(),
        "week":  add_days(today(), -7),
        "month": str(get_first_day(today())),
        "year":  f"{_date.today().year}-01-01",
    }
    if period in period_map:
        filters["session_start"] = [">=", period_map[period]]

    logs = frappe.get_all(
        "LMS Time Log",
        filters=filters,
        fields=[
            "employee", "course", "lesson",
            "activity_type", "duration_sec",
            "session_start", "end_reason",
        ],
        ignore_permissions=is_admin,
        order_by="session_start desc",
        limit=10000,
    )

    total_sec   = sum(cint(l["duration_sec"]) for l in logs)
    by_course   = {}
    by_activity = {}
    by_day      = {}

    for l in logs:
        c = l.get("course") or "Unknown"
        by_course[c] = by_course.get(c, 0) + cint(l["duration_sec"])

        at = l.get("activity_type") or "Video"
        by_activity[at] = by_activity.get(at, 0) + cint(l["duration_sec"])

        day = str(l["session_start"].date()) if l.get("session_start") else "Unknown"
        by_day[day] = by_day.get(day, 0) + cint(l["duration_sec"])

    return {
        "error":           False,
        "total_sec":       total_sec,
        "total_formatted": _fmt_duration(total_sec),
        "session_count":   len(logs),
        "by_course":       by_course,
        "by_activity":     by_activity,
        "by_day":          dict(sorted(by_day.items())),
        "period":          period,
        "employee":        employee,
        "breakdown":       logs[:200],   # UI uchun oxirgi 200 ta yozuv
    }


def _fmt_duration(sec):
    """
    Sekundni o'zbek tilidagi o'qilishi qulay formatga o'tkazadi.
    Masalan: 3723 → "1 soat 2 daqiqa 3 soniya"
    """
    sec = int(sec or 0)
    h   = sec // 3600
    m   = (sec % 3600) // 60
    s   = sec % 60
    parts = []
    if h:
        parts.append(f"{h} soat")
    if m:
        parts.append(f"{m} daqiqa")
    parts.append(f"{s} soniya")
    return " ".join(parts)
# ═══════════════════════════════════════════════════════════════════════════
#  OCHIQ SAVOLLAR (Open Questions) API
# ═══════════════════════════════════════════════════════════════════════════

@frappe.whitelist()
def get_open_questions(lesson_name):
    """
    Darsga biriktirilgan ochiq savollarni qaytaradi.
    Employee avval javob bergan bo'lsa, ularni ham qaytaradi.
    correct_answer faqat auto-graded va topshirilgan bo'lsa ko'rinadi.
    """
    user = frappe.session.user
    emp  = _get_employee(user)
    if not emp:
        return {"error": True, "message": "Employee topilmadi"}
    emp_id = emp["name"]

    lesson = frappe.db.get_value(
        "LMS Lesson", lesson_name,
        ["has_open_questions", "open_question_set"],
        as_dict=True
    )
    if not lesson or not cint(lesson.get("has_open_questions")):
        return {"error": True, "message": "Bu darsda ochiq savol yo'q"}

    oq_name = lesson.get("open_question_set")
    if not oq_name:
        return {"error": True, "message": "Savol to'plami biriktirilmagan"}

    oq = frappe.db.get_value(
        "LMS Open Question", oq_name,
        ["name", "title", "passing_score"],
        as_dict=True
    )
    if not oq:
        return {"error": True, "message": "Savol to'plami topilmadi"}

    items = frappe.get_all(
        "LMS Open Question Item",
        filters={"parent": oq_name, "parenttype": "LMS Open Question"},
        fields=["name", "question_text", "question_type", "marks",
                "order_index", "correct_answer"],
        order_by="order_index asc",
        ignore_permissions=True
    )
    if not items:
        return {"error": True, "message": "Savollar topilmadi"}

    item_names = [i["name"] for i in items]

    existing_answers = frappe.get_all(
        "LMS Open Answer",
        filters={
            "employee":      emp_id,
            "lesson":        lesson_name,
            "question_item": ["in", item_names]
        },
        fields=["question_item", "answer_text", "score", "status",
                "is_auto_graded", "admin_feedback"],
        ignore_permissions=True
    )
    ans_map = {a["question_item"]: a for a in existing_answers}

    questions = []
    for item in items:
        ans = ans_map.get(item["name"])
        is_graded_auto = (
            ans and
            item["question_type"] == "Auto" and
            ans["status"] == "Graded"
        )
        questions.append({
            "name":           item["name"],
            "question_text":  item["question_text"],
            "question_type":  item["question_type"],   # "Auto" | "Manual"
            "marks":          flt(item["marks"]),
            "order_index":    item["order_index"],
            "answer_text":    ans["answer_text"]    if ans else "",
            "score":          flt(ans["score"])     if ans else None,
            "status":         ans["status"]         if ans else None,
            "is_auto_graded": cint(ans["is_auto_graded"]) if ans else 0,
            "admin_feedback": ans["admin_feedback"] if ans else "",
            # To'g'ri javob: faqat auto-graded bo'lsa ko'rsatiladi
            "correct_answer": item["correct_answer"] if is_graded_auto else None,
        })

    total_marks    = sum(flt(q["marks"])  for q in questions)
    earned_marks   = sum(flt(q["score"])  for q in questions if q["score"] is not None)
    answered_count = sum(1                for q in questions if q["answer_text"])
    graded_count   = sum(1                for q in questions if q["status"] == "Graded")

    return {
        "error":          False,
        "set_name":       oq_name,
        "title":          oq["title"],
        "passing_score":  flt(oq["passing_score"]),
        "questions":      questions,
        "total_marks":    total_marks,
        "earned_marks":   earned_marks,
        "answered_count": answered_count,
        "graded_count":   graded_count,
        "total_count":    len(questions),
        "is_submitted":   answered_count == len(questions),
        "all_graded":     graded_count == len(questions) and len(questions) > 0,
    }


@frappe.whitelist()
def submit_open_answers(lesson_name, answers):
    """
    Employee javoblarini qabul qiladi va saqlaydi.
    Auto-grade: correct_answer bor → darhol ball beradi (case-insensitive)
    Manual-grade: correct_answer yo'q → admin keyinchalik tekshiradi

    answers: JSON string [{question_item, answer_text}]
    """
    import json as _json

    user = frappe.session.user
    emp  = _get_employee(user)
    if not emp:
        return {"error": True, "message": "Employee topilmadi"}
    emp_id = emp["name"]

    try:
        answers_list = _json.loads(answers) if isinstance(answers, str) else answers
    except Exception:
        return {"error": True, "message": "Javoblar formati noto'g'ri"}

    if not answers_list:
        return {"error": True, "message": "Javoblar bo'sh"}

    results        = []
    auto_score     = 0.0
    manual_pending = 0

    for ans in answers_list:
        q_item_name = ans.get("question_item")
        answer_text = (ans.get("answer_text") or "").strip()

        if not q_item_name or not answer_text:
            continue

        q_item = frappe.db.get_value(
            "LMS Open Question Item", q_item_name,
            ["question_text", "question_type", "correct_answer", "marks"],
            as_dict=True
        )
        if not q_item:
            continue

        marks       = flt(q_item["marks"])
        q_type      = q_item.get("question_type", "Manual")
        correct_ans = (q_item.get("correct_answer") or "").strip()

        is_auto    = (q_type == "Auto" and bool(correct_ans))
        score      = 0.0
        status     = "Pending"
        is_correct = False

        if is_auto:
            if answer_text.lower() == correct_ans.lower():
                score      = marks
                is_correct = True
            status      = "Graded"
            auto_score += score
        else:
            manual_pending += 1

        existing = frappe.get_all(
            "LMS Open Answer",
            filters={
                "employee":      emp_id,
                "lesson":        lesson_name,
                "question_item": q_item_name
            },
            fields=["name", "status"],
            limit=1,
            ignore_permissions=True
        )

        if existing:
            if existing[0]["status"] == "Graded" and not is_auto:
                results.append({
                    "question_item": q_item_name,
                    "status":        "already_graded",
                    "score":         None,
                })
                continue

            frappe.db.set_value("LMS Open Answer", existing[0]["name"], {
                "answer_text":    answer_text,
                "score":          score if is_auto else 0,
                "status":         status,
                "is_auto_graded": 1 if is_auto else 0,
                "submitted_on":   now(),
            })
            doc_name = existing[0]["name"]
        else:
            doc = frappe.get_doc({
                "doctype":        "LMS Open Answer",
                "employee":       emp_id,
                "lesson":         lesson_name,
                "question_item":  q_item_name,
                "answer_text":    answer_text,
                "score":          score if is_auto else 0,
                "status":         status,
                "is_auto_graded": 1 if is_auto else 0,
                "submitted_on":   now(),
            })
            doc.flags.ignore_permissions = True
            doc.insert(ignore_permissions=True)
            doc_name = doc.name

        results.append({
            "question_item":  q_item_name,
            "doc_name":       doc_name,
            "status":         status,
            "score":          score       if is_auto else None,
            "is_correct":     is_correct  if is_auto else None,
            "correct_answer": correct_ans if is_auto else None,
        })

    frappe.db.commit()

    return {
        "error":          False,
        "results":        results,
        "auto_score":     auto_score,
        "manual_pending": manual_pending,
        "message": (
            f"✅ {len(results)} ta javob saqlandi."
            + (f" {manual_pending} ta savol admin tomonidan tekshiriladi."
               if manual_pending else "")
        )
    }


@frappe.whitelist()
def grade_open_answer(answer_name, score, feedback=""):
    """
    Admin tomonidan manual javobni baholash.
    Faqat System Manager / LMS Admin / HR Manager roli kerak.
    """
    allowed_roles = {"System Manager", "LMS Admin", "HR Manager"}
    user_roles    = set(frappe.get_roles(frappe.session.user))
    if not (allowed_roles & user_roles):
        frappe.throw("Ruxsat yo'q. LMS Admin roli kerak.", frappe.PermissionError)

    score = flt(score)
    ans   = frappe.db.get_value(
        "LMS Open Answer", answer_name,
        ["question_item", "employee"],
        as_dict=True
    )
    if not ans:
        frappe.throw("Javob topilmadi")

    max_marks = flt(frappe.db.get_value(
        "LMS Open Question Item", ans["question_item"], "marks"
    ) or 0)
    if score > max_marks:
        frappe.throw(f"Ball {max_marks} dan oshmasligi kerak")

    frappe.db.set_value("LMS Open Answer", answer_name, {
        "score":          score,
        "status":         "Graded",
        "admin_feedback": feedback,
        "graded_by":      frappe.session.user,
        "graded_on":      now(),
    })
    frappe.db.commit()
    return {"error": False, "message": "Baholandi"}
