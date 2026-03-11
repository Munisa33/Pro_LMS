import frappe
import json
import random
from frappe import _
from frappe.utils import now, time_diff_in_seconds, add_days, today


# ─────────────────────────────────────────────
# 1. SEQUENTIAL LOCK — Oldingi dars tugamaguncha keyingisi blok
# ─────────────────────────────────────────────
def validate_lesson_access(doc, method):
    """
    LMS Lesson Progress yaratilishidan OLDIN ishga tushadi.
    Agar oldingi dars tugamagan bo'lsa — xato beradi.
    """
    lesson = frappe.get_doc("LMS Lesson", doc.lesson)

    # Bu darsning order_index ini olamiz
    current_order = lesson.order_index or 0
    if current_order == 0:
        return  # Birinchi dars — hech qanday chek yo'q

    # Xuddi shu section dagi oldingi darsni topamiz
    previous_lessons = frappe.get_all(
        "LMS Lesson",
        filters={
            "section": lesson.section,
            "order_index": ["<", current_order]
        },
        fields=["name", "lesson_title", "order_index"],
        order_by="order_index desc",
        limit=1
    )

    if not previous_lessons:
        return  # Oldingi dars yo'q — o'tkazib yuboramiz

    prev = previous_lessons[0]

    # Oldingi dars tugaganmi?
    completed = frappe.db.exists("LMS Lesson Progress", {
        "employee": doc.employee,
        "lesson": prev.name,
        "is_completed": 1
    })

    if not completed:
        frappe.throw(
            _(f"'{prev.lesson_title}' darsini avval tugatishingiz kerak. "
              f"Keyingi darsga o'tish taqiqlangan."),
            frappe.PermissionError
        )


def init_progress_record(doc, method):
    """Progress record yaratilganda boshlang'ich qiymatlar."""
    frappe.db.set_value("LMS Lesson Progress", doc.name, {
        "watch_time_sec": 0,
        "completion_percent": 0,
        "is_completed": 0,
        "session_logs": json.dumps([])
    })


# ─────────────────────────────────────────────
# 2. VIDEO HEARTBEAT — Har 10 sekundda frontend chaqiradi
# ─────────────────────────────────────────────
@frappe.whitelist()
def update_video_progress(lesson_id, current_position, watch_time):
    """
    Frontend har 10 sekundda bu endpointni chaqiradi.
    Skip detection va completion check shu yerda.
    """
    employee = get_employee_from_user()
    if not employee:
        # Employee topilmasa — progresni saqlamasdan, frontendni to'xtatmaslik
        return {
            "status": "no_employee",
            "message": "HR Employee yozuvi topilmadi. Administrator: HR > Employee da user_id ni bog'lang.",
            "completion_percent": 0,
            "is_completed": 0,
            "can_proceed": False
        }

    current_position = float(current_position)
    watch_time       = float(watch_time)

    lesson = frappe.get_doc("LMS Lesson", lesson_id)
    video_duration = lesson.video_duration_sec or 1

    # Progress record mavjudmi?
    progress_name = frappe.db.get_value("LMS Lesson Progress", {
        "employee": employee,
        "lesson": lesson_id
    })

    if not progress_name:
        # Enrollment ID topamiz (student = User)
        course_id = frappe.db.get_value("LMS Section", lesson.section, "course")
        enrollment = frappe.db.get_value("LMS Enrollment", {
            "student": frappe.session.user,
            "course": course_id
        }, "name")

        # Yangi progress yaratamiz
        progress = frappe.get_doc({
            "doctype": "LMS Lesson Progress",
            "employee": employee,
            "lesson": lesson_id,
            "enrollment": enrollment,
            "watch_time_sec": 0,
            "session_logs": json.dumps([])
        })
        progress.insert(ignore_permissions=True)
        progress_name = progress.name

    # Joriy ma'lumotlarni olamiz
    current_data = frappe.db.get_value(
        "LMS Lesson Progress", progress_name,
        ["watch_time_sec", "last_position_sec",
         "completion_percent", "session_logs", "skip_attempts", "enrollment"],
        as_dict=True
    )

    # ── SKIP DETECTION ──
    last_pos      = current_data.last_position_sec or 0
    position_jump = current_position - last_pos

    # 15 sekunddan ko'p sakrash = skip urinishi
    if position_jump > 15 and last_pos > 0:
        new_skip_count = (current_data.skip_attempts or 0) + 1
        frappe.db.set_value("LMS Lesson Progress", progress_name,
                            "skip_attempts", new_skip_count)
        return {
            "status": "skip_detected",
            "message": "Video oldinga o'tkazish taqiqlangan!",
            "rewind_to": last_pos  # Frontendga: bu pozitsiyaga qayt
        }

    # ── COMPLETION HISOBLASH ──
    completion_pct = min((watch_time / video_duration) * 100, 100)
    is_completed   = 1 if completion_pct >= (lesson.minimum_watch_percent or 90) else 0

    # ── SESSION LOG ──
    logs = json.loads(current_data.session_logs or "[]")
    logs.append({
        "position": current_position,
        "watch_time": watch_time,
        "timestamp": now()
    })
    # Oxirgi 100 ta logni saqlaymiz (xotira tejash)
    logs = logs[-100:]

    # ── SAQLASH ──
    update_data = {
        "watch_time_sec":    int(watch_time),
        "last_position_sec": int(current_position),
        "completion_percent": round(completion_pct, 2),
        "session_logs":      json.dumps(logs),
        "is_completed":      is_completed
    }

    if is_completed and not frappe.db.get_value(
            "LMS Lesson Progress", progress_name, "completed_on"):
        update_data["completed_on"] = now()

    frappe.db.set_value("LMS Lesson Progress", progress_name, update_data)

    return {
        "status": "ok",
        "completion_percent": round(completion_pct, 2),
        "is_completed": is_completed,
        "can_proceed": bool(is_completed)
    }


# ─────────────────────────────────────────────
# 3. QUIZ — Randomlashtirilgan savollar
# ─────────────────────────────────────────────
@frappe.whitelist()
def get_randomized_quiz(quiz_id):
    """
    Quiz savollarini random tartibda qaytaradi.
    To'g'ri javob ko'rsatilmaydi — faqat variantlar.
    """
    employee = get_employee_from_user()
    quiz     = frappe.get_doc("LMS Quiz", quiz_id)

    # Barcha savollar
    all_questions = frappe.get_all(
        "LMS Quiz Question",
        filters={"quiz": quiz_id},
        fields=["name", "question", "marks"]
    )

    if not all_questions:
        frappe.throw(_("Bu quizda savollar yo'q."))

    # Aralashtirish
    random.shuffle(all_questions)

    # Kerakli sonni olish
    limit = min(quiz.questions_to_show or len(all_questions), len(all_questions))
    selected = all_questions[:limit]

    # Har bir savol uchun variantlar (to'g'ri javobsiz)
    for q in selected:
        options = frappe.get_all(
            "LMS Answer Option",
            filters={"parent": q["name"]},
            fields=["name", "option_text"]  # is_correct BERILMAYDI
        )
        random.shuffle(options)
        q["options"] = options

    # Attempt boshlash
    attempt = frappe.get_doc({
        "doctype": "LMS Quiz Attempt",
        "employee": employee,
        "quiz": quiz_id,
        "started_at": now(),
        "attempt_number": get_attempt_number(employee, quiz_id)
    })
    attempt.insert(ignore_permissions=True)

    return {
        "attempt_id": attempt.name,
        "time_limit_min": quiz.time_limit_min or 30,
        "questions": selected
    }


@frappe.whitelist()
def submit_quiz(attempt_id, answers_json):
    """
    Quiz javoblarini qabul qilib, baholaydi.
    Vaqt limitini server tomonda tekshiradi.
    """
    employee = get_employee_from_user()
    attempt  = frappe.get_doc("LMS Quiz Attempt", attempt_id)
    quiz     = frappe.get_doc("LMS Quiz", attempt.quiz)

    # ── VAQT TEKSHIRUVI (server-side) ──
    time_taken = time_diff_in_seconds(now(), attempt.started_at)
    time_limit = (quiz.time_limit_min or 30) * 60 + 30  # 30 soniya grace period

    if time_taken > time_limit:
        frappe.db.set_value("LMS Quiz Attempt", attempt_id, {
            "score": 0,
            "passed": 0,
            "submitted_at": now(),
            "answers": answers_json
        })
        return {"status": "time_exceeded", "score": 0, "passed": False}

    answers = json.loads(answers_json)

    # ── BAHOLASH ──
    total_marks = 0
    earned_marks = 0

    for question_id, selected_option_id in answers.items():
        question = frappe.get_doc("LMS Quiz Question", question_id)
        total_marks += question.marks or 1

        # To'g'ri javobni tekshirish
        correct = frappe.db.get_value(
            "LMS Answer Option",
            {"parent": question_id, "is_correct": 1},
            "name"
        )
        if correct == selected_option_id:
            earned_marks += question.marks or 1

    percentage = round((earned_marks / total_marks) * 100, 2) if total_marks else 0
    passed     = percentage >= (quiz.passing_score or 70)

    # Natijani saqlash
    frappe.db.set_value("LMS Quiz Attempt", attempt_id, {
        "score":        earned_marks,
        "total_marks":  total_marks,
        "percentage":   percentage,
        "passed":       1 if passed else 0,
        "submitted_at": now(),
        "time_taken_sec": int(time_taken),
        "answers":      answers_json
    })

    return {
        "status":     "submitted",
        "score":      earned_marks,
        "total":      total_marks,
        "percentage": percentage,
        "passed":     passed
    }


# ─────────────────────────────────────────────
# 4. ADMIN DASHBOARD
# ─────────────────────────────────────────────
@frappe.whitelist()
def get_admin_overview():
    """Admin uchun barcha hodimlar progressi."""
    if not frappe.has_permission("LMS Enrollment", "read"):
        frappe.throw(_("Ruxsat yo'q."), frappe.PermissionError)

    employees = frappe.get_all("Employee",
                               fields=["name", "employee_name", "department"])

    result = []
    for emp in employees:
        # Umumiy progress
        enrollments = frappe.get_all(
            "LMS Enrollment",
            filters={"employee": emp.name},
            fields=["course", "progress_percent", "is_completed"]
        )

        # Quiz o'rtacha ball
        quiz_attempts = frappe.get_all(
            "LMS Quiz Attempt",
            filters={"employee": emp.name, "passed": 1},
            fields=["percentage"]
        )
        avg_score = 0
        if quiz_attempts:
            avg_score = round(
                sum(a.percentage for a in quiz_attempts) / len(quiz_attempts), 1
            )

        # Kutilayotgan topshiriqlar
        pending_assignments = frappe.db.count(
            "LMS Assignment Submission",
            filters={"employee": emp.name, "status": "Pending"}
        )

        result.append({
            "employee":            emp.name,
            "employee_name":       emp.employee_name,
            "department":          emp.department,
            "enrolled_courses":    len(enrollments),
            "completed_courses":   sum(1 for e in enrollments if e.is_completed),
            "avg_quiz_score":      avg_score,
            "pending_assignments": pending_assignments,
        })

    return result


# ─────────────────────────────────────────────
# 5. INACTIVITY REMINDER (Kunlik scheduler)
# ─────────────────────────────────────────────
def send_inactivity_reminders():
    """7 kun faol bo'lmagan hodimlarni email orqali eslatadi."""
    cutoff_date = add_days(today(), -7)

    inactive = frappe.db.sql("""
        SELECT DISTINCT e.employee, e.employee_name, u.email
        FROM `tabLMS Enrollment` e
        JOIN `tabEmployee` emp ON emp.name = e.employee
        JOIN `tabUser` u ON u.name = emp.user_id
        WHERE e.is_completed = 0
        AND (
            SELECT MAX(lp.modified)
            FROM `tabLMS Lesson Progress` lp
            WHERE lp.employee = e.employee
        ) < %s
        OR NOT EXISTS (
            SELECT 1 FROM `tabLMS Lesson Progress` lp2
            WHERE lp2.employee = e.employee
        )
    """, cutoff_date, as_dict=True)

    for hodim in inactive:
        if hodim.email:
            frappe.sendmail(
                recipients=[hodim.email],
                subject="O'quv dasturingizni davom ettiring!",
                message=f"""
                    Hurmatli {hodim.employee_name},<br><br>
                    Siz 7 kundan beri o'quv dasturida faol bo'lmagansiz.<br>
                    Iltimos, o'qishni davom ettiring.
                """
            )


# ─────────────────────────────────────────────
# YORDAMCHI FUNKSIYALAR
# ─────────────────────────────────────────────
def get_employee_from_user():
    """
    Joriy login bo'lgan user'ga tegishli Employee'ni qaytaradi.
    Employee topilmasa None qaytaradi (API chaqiruvlari o'zi tekshiradi).
    """
    return frappe.db.get_value(
        "Employee",
        {"user_id": frappe.session.user},
        "name"
    )

def get_attempt_number(employee, quiz_id):
    """Necha marta uringanini hisoblaydi."""
    count = frappe.db.count("LMS Quiz Attempt", {
        "employee": employee,
        "quiz": quiz_id
    })
    return (count or 0) + 1
@frappe.whitelist()
def get_lesson_detail(lesson_id):
    """Dars ma'lumotlari + hodimning oxirgi progressi."""
    employee = get_employee_from_user()
    if not employee:
        frappe.response["exc_type"] = "EmployeeNotFound"
        return {
            "error": True,
            "message": "HR Employee yozuvi topilmadi.",
            "hint": f"HR > Employee DocType'da '{frappe.session.user}' uchun User ID maydonini to'ldiring."
        }
    lesson   = frappe.get_doc("LMS Lesson", lesson_id)

    progress = frappe.db.get_value(
        "LMS Lesson Progress",
        {"employee": employee, "lesson": lesson_id},
        ["watch_time_sec", "last_position_sec", "completion_percent"],
        as_dict=True
    ) or {}

    return {
        "name":                   lesson.name,
        "lesson_title":           lesson.lesson_title,
        "video_url":              lesson.video_url,
        "video_duration_sec":     lesson.video_duration_sec,
        "minimum_watch_percent":  lesson.minimum_watch_percent or 90,
        "has_quiz":               lesson.has_quiz,
        "quiz":                   lesson.quiz,
        "has_assignment":         lesson.has_assignment,
        "assignment_type":        lesson.assignment_type,
        "assignment_instruction": lesson.assignment_instruction,
        "last_position":          progress.get("last_position_sec", 0),
        "watch_time":             progress.get("watch_time_sec", 0),
        "completion_percent":     progress.get("completion_percent", 0)
    }


@frappe.whitelist()
def get_employee_lessons():
    """
    Program → Course → Section → Lesson
    Barcha darslar ketma-ket, global sequential lock bilan.
    Enrollment shart emas — Program ga biriktirilgan kurslar avtomatik ko'rinadi.
    """
    employee = get_employee_from_user()
    if not employee:
        return []

    # 1. Barcha published programlarni ol
    programs = frappe.get_all(
        "LMS Program",
        filters={"is_published": 1},
        fields=["name", "program_name"],
        order_by="creation asc",
        ignore_permissions=True
    )

    if not programs:
        return []

    all_lessons_flat = []  # Barcha darslar ketma-ket (global tartib)
    structure = []         # Frontend uchun ierarxik struktura

    for program in programs:
        prog_data = {
            "type":         "program",
            "name":         program.name,
            "title":        program.program_name,
            "lessons":      []
        }

        # Programga biriktirilgan kurslar
        courses = frappe.get_all(
            "LMS Course",
            filters={"program": program.name},
            fields=["name", "course_name"],
            order_by="creation asc",
            ignore_permissions=True
        )

        for course in courses:
            course_data = {
                "type":    "course",
                "name":    course.name,
                "title":   course.course_name,
                "lessons": []
            }

            # Kurs sectionlari
            sections = frappe.get_all(
                "LMS Section",
                filters={"course": course.name},
                fields=["name", "section_title"],
                order_by="order_index asc",
                ignore_permissions=True
            )

            for sec in sections:
                sec_data = {
                    "type":    "section",
                    "name":    sec.name,
                    "title":   sec.section_title,
                    "lessons": []
                }

                lessons = frappe.get_all(
                    "LMS Lesson",
                    filters={"section": sec.name},
                    fields=["name", "lesson_title", "order_index"],
                    order_by="order_index asc",
                    ignore_permissions=True
                )

                for les in lessons:
                    les["program"]  = program.name
                    les["course"]   = course.name
                    les["section"]  = sec.name
                    all_lessons_flat.append(les)
                    sec_data["lessons"].append(les)

                course_data["lessons"].append(sec_data)
            prog_data["lessons"].append(course_data)
        structure.append(prog_data)

    # 2. Global sequential lock — barcha darslar uchun
    lesson_status = {}
    for i, les in enumerate(all_lessons_flat):
        progress = frappe.db.get_value(
            "LMS Lesson Progress",
            {"employee": employee, "lesson": les.name},
            ["is_completed", "completion_percent"],
            as_dict=True
        ) or {"is_completed": 0, "completion_percent": 0}

        is_completed = bool(progress.get("is_completed"))
        completion   = progress.get("completion_percent") or 0

        # Global lock: faqat birinchi dars ochiq,
        # qolganlar oldingi dars tugagandagina ochiladi
        if i == 0:
            is_locked = False
        else:
            prev_les  = all_lessons_flat[i - 1]
            prev_done = frappe.db.get_value(
                "LMS Lesson Progress",
                {"employee": employee, "lesson": prev_les.name, "is_completed": 1},
                "name"
            )
            is_locked = not bool(prev_done)

        lesson_status[les.name] = {
            "name":               les.name,
            "lesson_title":       les.lesson_title,
            "is_completed":       is_completed,
            "completion_percent": round(completion, 1),
            "is_locked":          is_locked,
            "global_index":       i
        }

    # 3. Strukturaga status qo'shish
    def enrich(node):
        if node.get("type") in ("program", "course", "section"):
            for child in node.get("lessons", []):
                enrich(child)
        else:
            # Bu dars node
            status = lesson_status.get(node["name"], {})
            node.update(status)

    for prog in structure:
        enrich(prog)

    return {
        "structure":      structure,
        "lessons_flat":   list(lesson_status.values())
    }


@frappe.whitelist()
def submit_assignment(lesson_id, submission_type,
                      google_sheets_url=None, attached_file=None):
    employee = get_employee_from_user()
    if not employee:
        frappe.throw("Employee topilmadi.")

    # Avval topshiriq bor-yo'qligini tekshirish
    existing = frappe.db.exists("LMS Assignment Submission", {
        "employee": employee,
        "lesson": lesson_id,
        "status": ["in", ["Pending", "Approved"]]
    })
    if existing:
        frappe.throw("Siz bu topshiriqni allaqachon yuborgansiz.")

    # URL validatsiya
    if submission_type == "Google Sheets":
        if not google_sheets_url or not google_sheets_url.startswith("http"):
            frappe.throw("To'g'ri Google Sheets URL kiriting.")

    doc = frappe.get_doc({
        "doctype":           "LMS Assignment Submission",
        "employee":          employee,
        "lesson":            lesson_id,
        "submission_type":   submission_type,
        "google_sheets_url": google_sheets_url,
        "attached_file":     attached_file,
        "status":            "Pending",
        "submitted_on":      now()
    })
    doc.insert(ignore_permissions=True)

    # Admin ga notification
    admins = frappe.get_all("User",
        filters={"role_profile_name": "System Manager"},
        fields=["name"],
        limit=5
    )
    for admin in admins:
        frappe.publish_realtime(
            "new_assignment",
            {
                "message": f"{employee} yangi topshiriq yubordi",
                "lesson": lesson_id
            },
            user=admin.name
        )

    return {"status": "ok", "name": doc.name}


@frappe.whitelist()
def review_assignment(submission_id, status, score=0, feedback=""):
    """Admin topshiriqni ko'rib chiqadi."""
    if not frappe.has_permission("LMS Assignment Submission", "write"):
        frappe.throw("Ruxsat yo'q.", frappe.PermissionError)

    frappe.db.set_value("LMS Assignment Submission", submission_id, {
        "status":       status,
        "admin_score":  float(score),
        "admin_feedback": feedback,
        "reviewed_by":  frappe.session.user,
        "reviewed_on":  now()
    })

    # Hodimga xabar
    submission = frappe.get_doc("LMS Assignment Submission", submission_id)
    employee_user = frappe.db.get_value(
        "Employee", submission.employee, "user_id"
    )
    if employee_user:
        status_text = "✅ Tasdiqlandi" if status == "Approved" else "❌ Rad etildi"
        frappe.publish_realtime(
            "assignment_reviewed",
            {
                "message": f"Topshiriqingiz {status_text}. Ball: {score}",
                "feedback": feedback
            },
            user=employee_user
        )

    return {"status": "ok"}


@frappe.whitelist()
def get_program_hierarchy():
    """
    Optimallashtirilgan Program > Course > Section > Lesson daraxti.

    Muammolar (eski get_employee_lessons):
      - Enrollment tekshirilmaydi → har kim barcha kursni ko'radi
      - N+1 query: har bir dars uchun alohida DB call
      - Har dars uchun alohida lock query

    Bu funksiya:
      1. Faqat enrollment orqali ruxsat berilgan kurslarni ko'rsatadi
      2. Barcha lesson progresslarni BIR SQL da oladi
      3. Lock holatini Python ichida hisoblaydi (0 DB call extra)
    """
    employee = get_employee_from_user()
    if not employee:
        return {
            "error": True,
            "message": "HR Employee yozuvi topilmadi.",
            "hint": (f"HR > Employee da '{frappe.session.user}' "
                     f"uchun User ID maydonini to'ldiring.")
        }

    # ── 1. Ruxsat berilgan kurslar (Enrollment orqali) ──────────────────────
    enrolled_courses = frappe.db.get_all(
        "LMS Enrollment",
        filters={"student": frappe.session.user, "status": "Active"},
        pluck="course"
    )
    if not enrolled_courses:
        return {"error": False, "structure": [], "lessons_flat": [],
                "message": "Hech qanday kursga yozilmagansiz."}

    # ── 2. Program → Course → Section → Lesson — 4 ta batch query ───────────
    # 2a. Kurslarni olish (faqat enrolled)
    courses = frappe.db.get_all(
        "LMS Course",
        filters={"name": ["in", enrolled_courses]},
        fields=["name", "course_name", "program"],
        order_by="creation asc"
    )
    course_names = [c.name for c in courses]

    # 2b. Programlarni olish
    program_ids = list({c.program for c in courses if c.program})
    programs_map = {}
    if program_ids:
        progs = frappe.db.get_all(
            "LMS Program",
            filters={"name": ["in", program_ids]},
            fields=["name", "program_name"],
            order_by="creation asc"
        )
        programs_map = {p.name: p for p in progs}

    # 2c. Barcha sectionlarni batch da olish
    sections = frappe.db.get_all(
        "LMS Section",
        filters={"course": ["in", course_names]},
        fields=["name", "section_title", "course", "order_index"],
        order_by="course asc, order_index asc"
    )
    section_names = [s.name for s in sections]

    # 2d. Barcha darslarni batch da olish
    lessons = []
    if section_names:
        lessons = frappe.db.get_all(
            "LMS Lesson",
            filters={"section": ["in", section_names]},
            fields=["name", "lesson_title", "section", "order_index"],
            order_by="section asc, order_index asc"
        )

    # ── 3. Barcha lesson progress — BIR query ───────────────────────────────
    lesson_names = [l.name for l in lessons]
    progress_map = {}
    if lesson_names:
        raw_progress = frappe.db.get_all(
            "LMS Lesson Progress",
            filters={"employee": employee, "lesson": ["in", lesson_names]},
            fields=["lesson", "is_completed", "completion_percent"]
        )
        progress_map = {p.lesson: p for p in raw_progress}

    # ── 4. Global sequential lock — Python ichida, 0 extra DB call ──────────
    all_lessons_flat = sorted(lessons, key=lambda x: (
        x.section, x.order_index or 0
    ))

    lesson_status = {}
    for i, les in enumerate(all_lessons_flat):
        prog = progress_map.get(les.name, {})
        is_completed = bool(prog.get("is_completed", 0))
        completion   = float(prog.get("completion_percent") or 0)

        if i == 0:
            is_locked = False
        else:
            prev = all_lessons_flat[i - 1]
            prev_prog = progress_map.get(prev.name, {})
            is_locked = not bool(prev_prog.get("is_completed", 0))

        lesson_status[les.name] = {
            "name":               les.name,
            "lesson_title":       les.lesson_title,
            "is_completed":       is_completed,
            "completion_percent": round(completion, 1),
            "is_locked":          is_locked,
            "global_index":       i
        }

    # ── 5. Ierarxik struktura qurish (Python dict, 0 DB call) ───────────────
    # Index map
    sections_by_course = {}
    for sec in sections:
        sections_by_course.setdefault(sec.course, []).append(sec)

    lessons_by_section = {}
    for les in lessons:
        lessons_by_section.setdefault(les.section, []).append(les)

    courses_by_program = {}
    for c in courses:
        prog_key = c.program or "__no_program__"
        courses_by_program.setdefault(prog_key, []).append(c)

    structure = []
    for prog_id, prog_courses in courses_by_program.items():
        prog_info = programs_map.get(prog_id, {})
        prog_node = {
            "type":    "program",
            "name":    prog_id,
            "title":   prog_info.get("program_name", prog_id),
            "courses": []
        }
        for course in prog_courses:
            course_node = {
                "type":     "course",
                "name":     course.name,
                "title":    course.course_name,
                "sections": []
            }
            for sec in sections_by_course.get(course.name, []):
                sec_lessons = lessons_by_section.get(sec.name, [])
                sec_node = {
                    "type":    "section",
                    "name":    sec.name,
                    "title":   sec.section_title,
                    "lessons": []
                }
                for les in sec_lessons:
                    sec_node["lessons"].append(lesson_status.get(les.name, {
                        "name":               les.name,
                        "lesson_title":       les.lesson_title,
                        "is_completed":       False,
                        "completion_percent": 0,
                        "is_locked":          True,
                        "global_index":       -1
                    }))
                course_node["sections"].append(sec_node)
            prog_node["courses"].append(course_node)
        structure.append(prog_node)

    return {
        "error":        False,
        "structure":    structure,
        "lessons_flat": list(lesson_status.values())
    }


@frappe.whitelist()
def get_pending_assignments():
    """Admin uchun kutilayotgan topshiriqlar."""
    if not frappe.has_permission("LMS Assignment Submission", "read"):
        frappe.throw("Ruxsat yo'q.")

    submissions = frappe.get_all(
        "LMS Assignment Submission",
        filters={"status": "Pending"},
        fields=[
            "name", "employee", "lesson",
            "submission_type", "attached_file",
            "google_sheets_url", "submitted_on"
        ],
        order_by="submitted_on asc",
        ignore_permissions=True
    )

    for s in submissions:
        s["employee_name"] = frappe.db.get_value(
            "Employee", s.employee, "employee_name"
        )
        s["lesson_title"] = frappe.db.get_value(
            "LMS Lesson", s.lesson, "lesson_title"
        )

    return submissions
@frappe.whitelist()
def get_employee_dashboard():
    """Hodimning to'liq dashboard ma'lumotlari."""
    employee = get_employee_from_user()
    if not employee:
        frappe.throw("Employee topilmadi.")

    emp_data = frappe.db.get_value(
        "Employee", employee,
        ["employee_name", "department", "designation"],
        as_dict=True
    ) or {}

    # Barcha enrollmentlar
    enrollments = frappe.get_all(
        "LMS Enrollment",
        filters={"employee": employee},
        fields=["course", "is_completed"],
        ignore_permissions=True
    )

    courses_data = []
    total_lessons = 0
    completed_lessons = 0

    for enr in enrollments:
        course = frappe.get_doc("LMS Course", enr.course)

        # Kurs darslarini olish
        sections = frappe.get_all(
            "LMS Section",
            filters={"course": enr.course},
            fields=["name"],
            order_by="order_index asc",
            ignore_permissions=True
        )

        lessons = []
        for sec in sections:
            sec_lessons = frappe.get_all(
                "LMS Lesson",
                filters={"section": sec.name},
                fields=["name", "lesson_title", "order_index"],
                order_by="order_index asc",
                ignore_permissions=True
            )
            lessons.extend(sec_lessons)

        total_lessons += len(lessons)

        # Har bir dars uchun progress
        course_completed = 0
        lesson_details = []
        for i, les in enumerate(lessons):
            progress = frappe.db.get_value(
                "LMS Lesson Progress",
                {"employee": employee, "lesson": les.name},
                ["is_completed", "completion_percent"],
                as_dict=True
            ) or {"is_completed": 0, "completion_percent": 0}

            if progress.get("is_completed"):
                course_completed += 1
                completed_lessons += 1

            # Quiz natijasi
            quiz_result = frappe.db.get_value(
                "LMS Quiz Attempt",
                {"employee": employee, "lesson": les.name, "passed": 1},
                "percentage"
            )

            # Topshiriq statusi
            assignment = frappe.db.get_value(
                "LMS Assignment Submission",
                {"employee": employee, "lesson": les.name},
                ["status", "admin_score"],
                as_dict=True
            )

            # Lock holati
            if i == 0:
                is_locked = False
            else:
                prev_done = frappe.db.exists("LMS Lesson Progress", {
                    "employee": employee,
                    "lesson": lessons[i-1].name,
                    "is_completed": 1
                })
                is_locked = not bool(prev_done)

            lesson_details.append({
                "name":               les.name,
                "lesson_title":       les.lesson_title,
                "is_completed":       bool(progress.get("is_completed")),
                "completion_percent": round(progress.get("completion_percent") or 0, 1),
                "is_locked":          is_locked,
                "quiz_score":         quiz_result,
                "assignment_status":  assignment.get("status") if assignment else None,
                "assignment_score":   assignment.get("admin_score") if assignment else None,
            })

        course_pct = round((course_completed / len(lessons)) * 100, 1) if lessons else 0

        courses_data.append({
            "course_name":       course.course_name,
            "total_lessons":     len(lessons),
            "completed_lessons": course_completed,
            "progress_percent":  course_pct,
            "lessons":           lesson_details
        })

    # Quiz statistikasi
    all_attempts = frappe.get_all(
        "LMS Quiz Attempt",
        filters={"employee": employee},
        fields=["percentage", "passed", "quiz"],
        ignore_permissions=True
    )
    passed_count = sum(1 for a in all_attempts if a.passed)
    avg_score = round(
        sum(a.percentage or 0 for a in all_attempts) / len(all_attempts), 1
    ) if all_attempts else 0

    # Topshiriqlar
    assignments = frappe.get_all(
        "LMS Assignment Submission",
        filters={"employee": employee},
        fields=["status", "admin_score", "admin_feedback", "lesson"],
        ignore_permissions=True
    )
    pending_count  = sum(1 for a in assignments if a.status == "Pending")
    approved_count = sum(1 for a in assignments if a.status == "Approved")
    rejected_count = sum(1 for a in assignments if a.status == "Rejected")

    overall_pct = round((completed_lessons / total_lessons) * 100, 1) if total_lessons else 0

    return {
        "employee_name":    emp_data.get("employee_name", ""),
        "department":       emp_data.get("department", ""),
        "designation":      emp_data.get("designation", ""),
        "overall_percent":  overall_pct,
        "total_lessons":    total_lessons,
        "completed_lessons": completed_lessons,
        "avg_quiz_score":   avg_score,
        "quiz_passed":      passed_count,
        "quiz_total":       len(all_attempts),
        "assignments": {
            "pending":  pending_count,
            "approved": approved_count,
            "rejected": rejected_count
        },
        "courses": courses_data
    }