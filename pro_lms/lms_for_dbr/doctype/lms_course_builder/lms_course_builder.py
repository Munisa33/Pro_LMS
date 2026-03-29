import frappe
from frappe import _
from frappe.model.document import Document


class LMSCourseBuilder(Document):

    def validate(self):
        self._check_header()
        self._check_lessons()
        self._check_quiz_questions()
        self._check_open_questions()

    def on_submit(self):
        created = []
        try:
            program = self._create_program(created)
            course  = self._create_course(program, created)
            stats   = self._create_tree(course, created)

            frappe.db.commit()

            self.db_set("build_status",    "Yaratildi: {} ta document".format(len(created)))
            self.db_set("created_course",  course.name)
            # program mavjud doc — o'chirib yubormaslik uchun created_program ga saqlamaymiz
            self.db_set("created_program", None)

            _show_success(course.name, stats)

        except Exception:
            frappe.db.rollback()
            _rollback(created)
            frappe.log_error(frappe.get_traceback(), "LMS Course Builder on_submit failed")
            frappe.throw(_("Build xatolik bilan toxtatildi. Barcha ozgarishlar bekor qilindi."))

    def on_cancel(self):
        if not self.created_course:
            return

        deleted = []
        errors  = []

        try:
            course_name = self.created_course

            sections = frappe.get_all(
                "LMS Section",
                filters={"course": course_name},
                pluck="name"
            )

            lessons = []
            if sections:
                lessons = frappe.get_all(
                    "LMS Lesson",
                    filters={"section": ["in", sections]},
                    pluck="name"
                )

            for lesson_name in lessons:
                quizzes = frappe.get_all(
                    "LMS Quiz",
                    filters={"lesson": lesson_name},
                    pluck="name"
                )
                for quiz_name in quizzes:
                    try:
                        frappe.delete_doc("LMS Quiz", quiz_name, force=True, ignore_permissions=True)
                        deleted.append("LMS Quiz: {}".format(quiz_name))
                    except Exception as e:
                        errors.append(str(e))

                oqs = frappe.get_all(
                    "LMS Open Question",
                    filters={"lesson": lesson_name},
                    pluck="name"
                )
                for oq_name in oqs:
                    try:
                        frappe.delete_doc("LMS Open Question", oq_name, force=True, ignore_permissions=True)
                        deleted.append("LMS Open Question: {}".format(oq_name))
                    except Exception as e:
                        errors.append(str(e))

            for lesson_name in lessons:
                try:
                    frappe.delete_doc("LMS Lesson", lesson_name, force=True, ignore_permissions=True)
                    deleted.append("LMS Lesson: {}".format(lesson_name))
                except Exception as e:
                    errors.append(str(e))

            for sec_name in sections:
                try:
                    frappe.delete_doc("LMS Section", sec_name, force=True, ignore_permissions=True)
                    deleted.append("LMS Section: {}".format(sec_name))
                except Exception as e:
                    errors.append(str(e))

            try:
                frappe.delete_doc("LMS Course", course_name, force=True, ignore_permissions=True)
                deleted.append("LMS Course: {}".format(course_name))
            except Exception as e:
                errors.append(str(e))

            if getattr(self, "created_program", None):
                try:
                    frappe.delete_doc("LMS Program", self.created_program, force=True, ignore_permissions=True)
                    deleted.append("LMS Program: {}".format(self.created_program))
                except Exception as e:
                    errors.append(str(e))

            frappe.db.commit()

            self.db_set("build_status",    "Bekor qilindi: {} doc ochirildi".format(len(deleted)))
            self.db_set("created_course",  None)
            self.db_set("created_program", None)

            if errors:
                frappe.log_error("\n".join(errors), "LMS Course Builder on_cancel partial errors")
                frappe.msgprint(
                    msg="{} ta doc ochirildi. {} ta xato. Error Log ni tekshiring.".format(len(deleted), len(errors)),
                    title="Cancel natijasi",
                    indicator="orange"
                )
            else:
                frappe.msgprint(
                    msg="{} ta doc muvaffaqiyatli ochirildi.".format(len(deleted)),
                    title="Cancel muvaffaqiyatli",
                    indicator="green"
                )

        except Exception:
            frappe.log_error(frappe.get_traceback(), "LMS Course Builder on_cancel failed")
            frappe.throw(_("Cancel xatolik bilan toxtatildi. Error Log ni tekshiring."))

    def _check_header(self):
        if not self.program_name:
            frappe.throw(_("Program Name kiritilmagan."))
        if not self.course_name:
            frappe.throw(_("Course Name kiritilmagan."))
        if not self.lessons:
            frappe.throw(_("Kamida bitta Lesson qoshing."))

    def _check_lessons(self):
        seen = []
        for row in self.lessons:
            if not row.lesson_title:
                frappe.throw(_("Lessons Row {}: Lesson Title bosh.".format(row.idx)))
            if row.lesson_title in seen:
                frappe.throw(_(
                    "Lessons Row {}: \"{}\" nomi takrorlanmoqda. "
                    "Har bir lesson nomi UNIQUE bolishi shart.".format(row.idx, row.lesson_title)
                ))
            seen.append(row.lesson_title)
            if row.has_quiz and not row.quiz_title:
                frappe.throw(_("Lessons Row {} \"{}\": Quiz Title kiritilmagan.".format(row.idx, row.lesson_title)))
            if row.has_open_questions and not row.oq_title:
                frappe.throw(_("Lessons Row {} \"{}\": Open Question Title kiritilmagan.".format(row.idx, row.lesson_title)))
            if row.has_assignment and not row.assignment_instruction:
                frappe.throw(_("Lessons Row {} \"{}\": Assignment Instruction bosh.".format(row.idx, row.lesson_title)))

    def _check_quiz_questions(self):
        if not self.quiz_questions:
            return
        valid = {r.lesson_title for r in self.lessons if r.has_quiz and r.lesson_title}
        for row in self.quiz_questions:
            if not row.lesson_title:
                frappe.throw(_("Quiz Questions Row {}: Lesson tanlanmagan.".format(row.idx)))
            if row.lesson_title not in valid:
                frappe.throw(_(
                    "Quiz Questions Row {}: \"{}\" lessons tabloda topilmadi "
                    "yoki has_quiz belgilanmagan.".format(row.idx, row.lesson_title)
                ))
            if not row.question_text:
                frappe.throw(_("Quiz Questions Row {} (\"{}\"): Savol matni bosh.".format(row.idx, row.lesson_title)))
            if not row.option_a or not row.option_b:
                frappe.throw(_("Quiz Questions Row {} (\"{}\"): Kamida Option A va B majburiy.".format(row.idx, row.lesson_title)))
            if not row.correct_option:
                frappe.throw(_("Quiz Questions Row {} (\"{}\"): Togri javob belgilanmagan.".format(row.idx, row.lesson_title)))

    def _check_open_questions(self):
        if not self.open_questions:
            return
        valid = {r.lesson_title for r in self.lessons if r.has_open_questions and r.lesson_title}
        for row in self.open_questions:
            if not row.lesson_title:
                frappe.throw(_("Open Questions Row {}: Lesson tanlanmagan.".format(row.idx)))
            if row.lesson_title not in valid:
                frappe.throw(_(
                    "Open Questions Row {}: \"{}\" lessons tabloda topilmadi "
                    "yoki has_open_questions belgilanmagan.".format(row.idx, row.lesson_title)
                ))
            if not row.question_text:
                frappe.throw(_("Open Questions Row {} (\"{}\"): Savol matni bosh.".format(row.idx, row.lesson_title)))

    def _create_program(self, created):
        # program_name — Link field, mavjud programni ishlatamiz (yangi yaratmaymiz)
        return frappe.get_doc("LMS Program", self.program_name)

    def _create_course(self, program, created):
        doc = frappe.new_doc("LMS Course")
        doc.course_name   = self.course_name
        doc.passing_score = self.passing_score or 70
        doc.is_sequential = self.is_sequential or 0
        doc.program       = program.name
        doc.insert(ignore_permissions=True)
        created.append(("LMS Course", doc.name))
        program.append("courses", {"course": doc.name})
        program.save(ignore_permissions=True)
        return doc

    def _create_tree(self, course, created):
        quiz_map = {}
        for q in (self.quiz_questions or []):
            if q.lesson_title:
                quiz_map.setdefault(q.lesson_title, []).append(q)

        oq_map = {}
        for o in (self.open_questions or []):
            if o.lesson_title:
                oq_map.setdefault(o.lesson_title, []).append(o)

        sections_map = {}
        for row in self.lessons:
            key = (row.section_title or "Default Section").strip()
            sections_map.setdefault(key, []).append(row)

        stats = {
            "sections": 0, "lessons": 0, "quizzes": 0,
            "quiz_questions": 0, "open_q_sets": 0, "open_questions": 0,
        }

        for sec_idx, (sec_title, rows) in enumerate(sections_map.items()):
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
                lesson.lesson_description     = row.lesson_description or ""
                lesson.require_admin_approval = row.require_admin_approval or 0
                lesson.order_index            = les_idx + 1
                lesson.is_free_preview        = row.is_free_preview or 0
                lesson.insert(ignore_permissions=True)
                created.append(("LMS Lesson", lesson.name))
                stats["lessons"] += 1

                if row.has_quiz and row.quiz_title:
                    quiz = frappe.new_doc("LMS Quiz")
                    quiz.quiz_title    = row.quiz_title
                    quiz.lesson        = lesson.name
                    quiz.passing_score = row.quiz_passing_score or 60
                    quiz.max_attempts  = int(row.max_attempts or 3)
                    quiz.insert(ignore_permissions=True)
                    created.append(("LMS Quiz", quiz.name))
                    stats["quizzes"] += 1

                    for q_row in quiz_map.get(row.lesson_title, []):
                        qq = frappe.new_doc("LMS Quiz Question")
                        qq.quiz     = quiz.name
                        qq.question = q_row.question_text
                        qq.marks    = q_row.marks or 1
                        option_map = {"A": q_row.option_a, "B": q_row.option_b, "C": q_row.option_c, "D": q_row.option_d}
                        for label, text in option_map.items():
                            if text:
                                qq.append("options", {
                                    "option_text": text,
                                    "is_correct": 1 if label == q_row.correct_option else 0
                                })
                        qq.insert(ignore_permissions=True)
                        created.append(("LMS Quiz Question", qq.name))
                        stats["quiz_questions"] += 1

                    lesson.quiz = quiz.name
                    lesson.save(ignore_permissions=True)

                if row.has_open_questions and row.oq_title:
                    oq_set = frappe.new_doc("LMS Open Question")
                    oq_set.title         = row.oq_title
                    oq_set.lesson        = lesson.name
                    oq_set.passing_score = row.open_q_passing_score or 60

                    for oq_row in oq_map.get(row.lesson_title, []):
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

                    lesson.open_question_set = oq_set.name
                    lesson.save(ignore_permissions=True)

        course.save(ignore_permissions=True)
        return stats


def _show_success(course_name, stats):
    rows = [
        ("Sections",       stats["sections"]),
        ("Lessons",        stats["lessons"]),
        ("Quizzes",        stats["quizzes"]),
        ("Quiz Savollar",  stats["quiz_questions"]),
        ("Open Q Sets",    stats["open_q_sets"]),
        ("Ochiq Savollar", stats["open_questions"]),
    ]
    table = "".join(
        "<tr><td style='padding:4px 12px 4px 0'>{}</td><td><b>{} ta</b></td></tr>".format(l, c)
        for l, c in rows if c > 0
    )
    link = "<br><br>Kurs: <a href='/app/lms-course/{}' target='_blank'><b>{}</b></a>".format(course_name, course_name)
    frappe.msgprint(msg="<table>{}</table>{}".format(table, link), title="Kurs yaratildi", indicator="green")


def _rollback(created):
    for doctype, name in reversed(created):
        try:
            frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)
        except Exception:
            pass
