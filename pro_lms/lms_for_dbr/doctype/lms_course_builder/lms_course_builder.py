"""
LMS Course Builder — Python Controller
File: lms_builder/lms_builder/doctype/lms_course_builder/lms_course_builder.py

LOGIKA (Deferred Linking pattern):
====================================
Builder ichida lesson_title = oddiy string (DocType link emas).
quiz_questions.lesson_title va open_questions.lesson_title ham string.

Submit bo'lganda:
  1. quiz_map   = { "Lesson 1": [quiz_row1, quiz_row2, ...] }
  2. oq_map     = { "Lesson 1": [oq_row1, oq_row2, ...] }
  3. Har bir lesson uchun real LMS Lesson yaratiladi
  4. quiz_map.get(lesson_title) → o'sha lessonga bog'lab quiz yaratiladi
  5. oq_map.get(lesson_title)   → o'sha lessonga bog'lab open question yaratiladi

N ta quiz savol va N ta ochiq savol bitta lessonga bog'lanadi.
"""

import frappe
from frappe import _
from frappe.model.document import Document


class LMSCourseBuilder(Document):

    # =========================================================================
    # FRAPPE LIFECYCLE
    # =========================================================================

    def validate(self):
        """
        Server-side validation.
        Client validation bypass (API orqali yuborish) dan himoya.
        """
        self._check_header()
        self._check_lessons()
        self._check_quiz_questions()
        self._check_open_questions()

    def on_submit(self):
        """
        Bitta atomic transaksiya.
        Xato bo'lsa — to'liq rollback + manual cleanup.
        """
        created = []   # rollback uchun (doctype, name) juftliklari

        try:
            program = self._create_program(created)
            course  = self._create_course(program, created)
            stats   = self._create_tree(course, created)

            frappe.db.commit()

            self.db_set("build_status",   _build_status_text(len(created)))
            self.db_set("created_course", course.name)

            _show_success(course.name, stats)

        except Exception:
            frappe.db.rollback()
            _rollback(created)
            frappe.log_error(
                frappe.get_traceback(),
                "LMS Course Builder — on_submit failed"
            )
            frappe.throw(_(
                "Build xatolik bilan to'xtatildi. "
                "Barcha o'zgarishlar bekor qilindi. "
                "Error Log → LMS Course Builder — on_submit failed"
            ))

    def on_cancel(self):
        """
        Cancel — yaratilgan kursni unpublish qiladi.
        Hard delete xavfli (enrollment/progress bo'lishi mumkin).
        """
        if self.created_course:
            frappe.db.set_value("LMS Course", self.created_course, "is_published", 0)
            self.db_set("build_status", "⚠️ Bekor qilindi — kurs unpublish qilindi")

    # =========================================================================
    # VALIDATION METHODS
    # =========================================================================

    def _check_header(self):
        if not self.program_name:
            frappe.throw(_("Program Name kiritilmagan."))
        if not self.course_name:
            frappe.throw(_("Course Name kiritilmagan."))
        if not self.lessons:
            frappe.throw(_("Kamida bitta Lesson qo'shing."))

    def _check_lessons(self):
        seen = []
        for row in self.lessons:
            # Bo'sh title
            if not row.lesson_title:
                frappe.throw(_(f"Lessons Row {row.idx}: Lesson Title bo'sh."))

            # Takror nom — string matching uchun kritik
            if row.lesson_title in seen:
                frappe.throw(_(
                    f"Lessons Row {row.idx}: "
                    f"\"{row.lesson_title}\" nomi takrorlanmoqda. "
                    f"Har bir lesson nomi UNIQUE bo'lishi shart — "
                    f"quiz va open question shu nom orqali bog'lanadi."
                ))
            seen.append(row.lesson_title)

            # has_quiz → quiz_title majburiy
            if row.has_quiz and not row.quiz_title:
                frappe.throw(_(
                    f"Lessons Row {row.idx} \"{row.lesson_title}\": "
                    f"Quiz Title kiritilmagan."
                ))

            # has_open_questions → oq_title majburiy
            if row.has_open_questions and not row.oq_title:
                frappe.throw(_(
                    f"Lessons Row {row.idx} \"{row.lesson_title}\": "
                    f"Open Question Title kiritilmagan."
                ))

            # has_assignment → instruction majburiy
            if row.has_assignment and not row.assignment_instruction:
                frappe.throw(_(
                    f"Lessons Row {row.idx} \"{row.lesson_title}\": "
                    f"Assignment Instruction bo'sh. "
                    f"Employee topshiriqni qanday bajarishini bilmaydi."
                ))

    def _check_quiz_questions(self):
        if not self.quiz_questions:
            return

        # has_quiz=1 bo'lgan lesson titlelari
        valid = {
            r.lesson_title
            for r in self.lessons
            if r.has_quiz and r.lesson_title
        }

        for row in self.quiz_questions:
            # Lesson title bo'sh
            if not row.lesson_title:
                frappe.throw(_(
                    f"Quiz Questions Row {row.idx}: Lesson tanlanmagan. "
                    f"Lessons tabloda has_quiz belgisi bo'lgan lesson nomini yozing."
                ))

            # Lessons tabloda bunday lesson yo'q yoki has_quiz belgilanmagan
            if row.lesson_title not in valid:
                frappe.throw(_(
                    f"Quiz Questions Row {row.idx}: "
                    f"\"{row.lesson_title}\" — lessons tabloda topilmadi "
                    f"yoki bu lesson uchun has_quiz belgilanmagan."
                ))

            # Savol matni bo'sh
            if not row.question_text:
                frappe.throw(_(
                    f"Quiz Questions Row {row.idx} "
                    f"(\"{row.lesson_title}\"): Savol matni bo'sh."
                ))

            # Kamida A va B variant
            if not row.option_a or not row.option_b:
                frappe.throw(_(
                    f"Quiz Questions Row {row.idx} "
                    f"(\"{row.lesson_title}\"): "
                    f"Kamida Option A va B to'ldirilishi shart."
                ))

            # To'g'ri javob belgilanmagan
            if not row.correct_option:
                frappe.throw(_(
                    f"Quiz Questions Row {row.idx} "
                    f"(\"{row.lesson_title}\"): "
                    f"To'g'ri javob (correct_option) belgilanmagan."
                ))

    def _check_open_questions(self):
        if not self.open_questions:
            return

        # has_open_questions=1 bo'lgan lesson titlelari
        valid = {
            r.lesson_title
            for r in self.lessons
            if r.has_open_questions and r.lesson_title
        }

        for row in self.open_questions:
            if not row.lesson_title:
                frappe.throw(_(
                    f"Open Questions Row {row.idx}: Lesson tanlanmagan."
                ))

            if row.lesson_title not in valid:
                frappe.throw(_(
                    f"Open Questions Row {row.idx}: "
                    f"\"{row.lesson_title}\" — lessons tabloda topilmadi "
                    f"yoki bu lesson uchun has_open_questions belgilanmagan."
                ))

            if not row.question_text:
                frappe.throw(_(
                    f"Open Questions Row {row.idx} "
                    f"(\"{row.lesson_title}\"): Savol matni bo'sh."
                ))

    # =========================================================================
    # CREATOR METHODS
    # =========================================================================

    def _create_program(self, created):
        doc = frappe.new_doc("LMS Program")
        doc.program_name       = self.program_name
        doc.passing_percentage = self.passing_percentage or 80
        doc.is_published       = 0
        doc.insert(ignore_permissions=True)
        created.append(("LMS Program", doc.name))
        return doc

    def _create_course(self, program, created):
        doc = frappe.new_doc("LMS Course")
        doc.course_name   = self.course_name
        doc.passing_score = self.passing_score or 70
        doc.is_sequential = self.is_sequential or 0
        doc.program       = program.name
        doc.insert(ignore_permissions=True)
        created.append(("LMS Course", doc.name))

        # Program → Course child table
        program.append("courses", {"course": doc.name})
        program.save(ignore_permissions=True)
        return doc

    def _create_tree(self, course, created):
        """
        ASOSIY LOGIKA — Deferred Linking Pattern
        =========================================
        Step 1: quiz_map va oq_map — string key bilan lookup table yaratiladi.
                { "Lesson 1": [row1, row2, ...], "Lesson 2": [...] }

        Step 2: Lessons tablodagi har bir row uchun:
                - LMS Section yaratiladi (bir xil section_title = bitta section)
                - LMS Lesson yaratiladi
                  → lesson.name = "LMS-LESSON-0001" (Frappe auto ID)

        Step 3: quiz_map.get("Lesson 1") → LMS Quiz + LMS Quiz Question yaratiladi
                → quiz.lesson = lesson.name  (endi real DocType link)
                → N ta savol bir lession uchun: map bir list qaytaradi

        Step 4: oq_map.get("Lesson 1") → LMS Open Question yaratiladi
                → oq.lesson = lesson.name
                → N ta ochiq savol: mapdan list olindi
        """

        # ── Step 1: Lookup map ──────────────────────────────────────────────
        #
        # quiz_map misol:
        # {
        #   "Lesson 1": [
        #       <Row question="Savol 1" option_a="A" correct="A">,
        #       <Row question="Savol 2" option_a="C" correct="B">,
        #       <Row question="Savol 3" ...>,
        #       ... (N ta)
        #   ],
        #   "Lesson 2": [...]
        # }
        #
        quiz_map = {}
        for q in (self.quiz_questions or []):
            if q.lesson_title:
                quiz_map.setdefault(q.lesson_title, []).append(q)

        oq_map = {}
        for o in (self.open_questions or []):
            if o.lesson_title:
                oq_map.setdefault(o.lesson_title, []).append(o)

        # ── Section grouping ────────────────────────────────────────────────
        # Bir xil section_title → bitta LMS Section
        # Python 3.7+ dict insertion order saqlaydi
        sections_map = {}
        for row in self.lessons:
            key = (row.section_title or "Default Section").strip()
            sections_map.setdefault(key, []).append(row)

        stats = {
            "sections":       0,
            "lessons":        0,
            "quizzes":        0,
            "quiz_questions": 0,
            "open_q_sets":    0,
            "open_questions": 0,
        }

        # ── Step 2 + 3 + 4: Yaratish ────────────────────────────────────────
        for sec_idx, (sec_title, rows) in enumerate(sections_map.items()):

            # LMS Section
            section = frappe.new_doc("LMS Section")
            section.section_title = sec_title
            section.course        = course.name
            section.order_index   = sec_idx + 1
            section.is_published  = 0
            section.insert(ignore_permissions=True)
            created.append(("LMS Section", section.name))
            course.append("section_order", {"section": section.name})
            stats["sections"] += 1

            for les_idx, row in enumerate(rows):

                # LMS Lesson
                lesson = frappe.new_doc("LMS Lesson")
                lesson.lesson_title           = row.lesson_title
                lesson.section                = section.name
                lesson.video_url              = row.video_url or ""
                lesson.video_duration_sec     = int(row.video_duration_sec or 0)
                lesson.minimum_watch_percent  = row.minimum_watch_percent or 80
                lesson.has_quiz               = row.has_quiz or 0
                lesson.has_open_questions     = row.has_open_questions or 0
                lesson.has_assignment         = row.has_assignment or 0
                lesson.assignment_type        = row.assignment_type or ""
                lesson.assignment_instruction = row.assignment_instruction or ""
                lesson.order_index            = les_idx + 1
                lesson.is_free_preview        = row.is_free_preview or 0
                lesson.insert(ignore_permissions=True)
                created.append(("LMS Lesson", lesson.name))
                stats["lessons"] += 1

                # ── Step 3: Quiz ─────────────────────────────────────────────
                #
                # quiz_map.get("Lesson 1") →
                #   [row1, row2, ..., rowN]  ← N ta savol
                #
                # Har bir savol → bitta LMS Quiz Question
                # Hammasi bitta LMS Quiz ga bog'liq
                # LMS Quiz → lesson.name ga bog'liq (real DocType link)
                #
                if row.has_quiz and row.quiz_title:
                    quiz = frappe.new_doc("LMS Quiz")
                    quiz.quiz_title    = row.quiz_title
                    quiz.lesson        = lesson.name  # REAL LINK
                    quiz.passing_score = row.quiz_passing_score or 60
                    quiz.max_attempts  = int(row.max_attempts or 3)
                    quiz.insert(ignore_permissions=True)
                    created.append(("LMS Quiz", quiz.name))
                    stats["quizzes"] += 1

                    # N ta savol — loop
                    for q_row in quiz_map.get(row.lesson_title, []):
                        qq = frappe.new_doc("LMS Quiz Question")
                        qq.quiz     = quiz.name   # REAL LINK
                        qq.question = q_row.question_text
                        qq.marks    = q_row.marks or 1

                        # Option → LMS Answer Option child table
                        option_map = {
                            "A": q_row.option_a,
                            "B": q_row.option_b,
                            "C": q_row.option_c,
                            "D": q_row.option_d,
                        }
                        for label, text in option_map.items():
                            if text:
                                qq.append("options", {
                                    "option_text": text,
                                    "is_correct":  1 if label == q_row.correct_option else 0
                                })

                        qq.insert(ignore_permissions=True)
                        created.append(("LMS Quiz Question", qq.name))
                        stats["quiz_questions"] += 1

                    # Lesson → Quiz backlink
                    lesson.quiz = quiz.name
                    lesson.save(ignore_permissions=True)

                # ── Step 4: Open Questions ────────────────────────────────────
                #
                # oq_map.get("Lesson 1") →
                #   [row1, row2, ..., rowN]  ← N ta ochiq savol
                #
                # Hammasi bitta LMS Open Question (set) ga child table sifatida
                # LMS Open Question → lesson.name ga bog'liq (real DocType link)
                #
                if row.has_open_questions and row.oq_title:
                    oq_rows = oq_map.get(row.lesson_title, [])

                    oq_set = frappe.new_doc("LMS Open Question")
                    oq_set.title         = row.oq_title
                    oq_set.lesson        = lesson.name  # REAL LINK
                    oq_set.passing_score = row.open_q_passing_score or 60

                    # N ta savol — loop
                    for oq_row in oq_rows:
                        oq_set.append("questions", {
                            "question_text":  oq_row.question_text,
                            "question_type":  oq_row.question_type or "Manual",
                            "correct_answer": oq_row.correct_answer or "",
                            "marks":          oq_row.marks or 5,
                            "order_index":    oq_row.idx,
                        })
                        stats["open_questions"] += 1

                    oq_set.insert(ignore_permissions=True)
                    created.append(("LMS Open Question", oq_set.name))
                    stats["open_q_sets"] += 1

                    # Lesson → Open Question backlink
                    lesson.open_question_set = oq_set.name
                    lesson.save(ignore_permissions=True)

        # Course section_order save
        course.save(ignore_permissions=True)
        return stats


# =============================================================================
# MODULE-LEVEL HELPERS
# =============================================================================

def _build_status_text(count):
    return f"✅ Yaratildi: {count} ta document"


def _show_success(course_name, stats):
    rows = [
        ("📂 Sections",        stats["sections"]),
        ("📄 Lessons",         stats["lessons"]),
        ("📝 Quizzes",         stats["quizzes"]),
        ("✏️  Quiz Savollar",  stats["quiz_questions"]),
        ("❓ Open Q Sets",     stats["open_q_sets"]),
        ("🔓 Ochiq Savollar",  stats["open_questions"]),
    ]

    table = "".join(
        f"<tr><td style='padding:4px 12px 4px 0'>{label}</td>"
        f"<td><b>{count} ta</b></td></tr>"
        for label, count in rows
        if count > 0
    )

    course_link = (
        f'<br><br>📘 Kurs: '
        f'<a href="/app/lms-course/{course_name}" target="_blank">'
        f'<b>{course_name}</b></a>'
    )

    frappe.msgprint(
        msg=f"<table>{table}</table>{course_link}",
        title="✅ Kurs muvaffaqiyatli yaratildi",
        indicator="green",
    )


def _rollback(created):
    """
    frappe.db.rollback() Frappe child table larni o'chirmaydi.
    Shuning uchun manual cleanup zarur — teskari tartibda o'chirish.
    """
    for doctype, name in reversed(created):
        try:
            frappe.delete_doc(
                doctype, name,
                force=True,
                ignore_permissions=True,
            )
        except Exception:
            pass
