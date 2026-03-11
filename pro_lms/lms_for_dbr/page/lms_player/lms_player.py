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
                "order_index"],
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
