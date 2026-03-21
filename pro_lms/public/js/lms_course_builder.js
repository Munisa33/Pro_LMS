/**
 * LMS Course Builder — Client Script
 * File: lms_builder/public/js/lms_course_builder.js
 *
 * LOGIKA:
 * ────────────────────────────────────────────────────────────────────────────
 * lessons tabloda lesson_title = string ("Lesson 1")
 * quiz_questions tabloda lesson_title = xuddi shu string
 * open_questions tabloda lesson_title = xuddi shu string
 *
 * Bog'liqlik = STRING MATCH (submit vaqtida Python hal qiladi)
 *
 * has_quiz ☑ bosilganda:
 *   → lesson_title bo'shmi? → xato, checkbox qaytariladi
 *   → quiz_questions tabloga lesson_title prefilled row inject qilinadi
 *   → lesson_title cell vizual lock qilinadi (fon rangi)
 *   → Admin faqat savol, options, correct yozadi
 *   → "Add Row" bosib N ta savol qo'sha oladi
 *
 * has_quiz ☐ bosilganda:
 *   → confirm → o'sha lesson rowlari o'chiriladi
 *
 * lesson_title o'zgarganda:
 *   → quiz/oq tablodagi bog'liq rowlar avtomatik sync
 * ────────────────────────────────────────────────────────────────────────────
 */

// =============================================================================
// MAIN FORM EVENTS
// =============================================================================

frappe.ui.form.on("LMS Course Builder", {

    refresh(frm) {
        LMSBuilder.UI.setup_buttons(frm);
        LMSBuilder.UI.apply_all_locks(frm);
    },

    before_submit(frm) {
        return LMSBuilder.Validation.run(frm);
    }

});

// =============================================================================
// LESSON ROW EVENTS
// =============================================================================

frappe.ui.form.on("LMS Builder Row", {

    form_render(frm, cdt, cdn) {
        LMSBuilder.UI.toggle_row_fields(frm, cdt, cdn);
    },

    // ── has_quiz toggled ──────────────────────────────────────────────────
    has_quiz(frm, cdt, cdn) {
        const row = locals[cdt][cdn];

        if (row.has_quiz) {
            // Guard: lesson_title kiritilganmi?
            if (!row.lesson_title || !row.lesson_title.trim()) {
                frappe.show_alert({
                    message: __("Avval Lesson Title kiriting, so'ng Has Quiz belgilang."),
                    indicator: "red"
                }, 4);
                frappe.model.set_value(cdt, cdn, "has_quiz", 0);
                return;
            }
            LMSBuilder.Table.inject(frm, "quiz_questions", row.lesson_title);
        } else {
            LMSBuilder.Table.confirm_remove(
                frm, "quiz_questions", row.lesson_title,
                () => frappe.model.set_value(cdt, cdn, "has_quiz", 1)
            );
        }

        LMSBuilder.UI.toggle_row_fields(frm, cdt, cdn);
    },

    // ── has_open_questions toggled ────────────────────────────────────────
    has_open_questions(frm, cdt, cdn) {
        const row = locals[cdt][cdn];

        if (row.has_open_questions) {
            if (!row.lesson_title || !row.lesson_title.trim()) {
                frappe.show_alert({
                    message: __("Avval Lesson Title kiriting, so'ng Has Open Q belgilang."),
                    indicator: "red"
                }, 4);
                frappe.model.set_value(cdt, cdn, "has_open_questions", 0);
                return;
            }
            LMSBuilder.Table.inject(frm, "open_questions", row.lesson_title);
        } else {
            LMSBuilder.Table.confirm_remove(
                frm, "open_questions", row.lesson_title,
                () => frappe.model.set_value(cdt, cdn, "has_open_questions", 1)
            );
        }

        LMSBuilder.UI.toggle_row_fields(frm, cdt, cdn);
    },

    has_assignment(frm, cdt, cdn) {
        LMSBuilder.UI.toggle_row_fields(frm, cdt, cdn);
    },

    // ── lesson_title o'zgarganda ──────────────────────────────────────────
    lesson_title(frm, cdt, cdn) {
        LMSBuilder.Table.sync_title_change(frm, cdt, cdn);
    },

    // ── row o'chirilganda ─────────────────────────────────────────────────
    lessons_remove(frm) {
        LMSBuilder.Table.remove_orphan_rows(frm);
    }

});

// =============================================================================
// NAMESPACE
// =============================================================================

window.LMSBuilder = window.LMSBuilder || {};

// =============================================================================
// LMSBuilder.UI
// =============================================================================

LMSBuilder.UI = {

    setup_buttons(frm) {
        // Submit tugmasi faqat Draft holatda
        if (frm.doc.docstatus === 0 && !frm.is_new()) {
            frm.page.set_primary_action(__("🚀 Submit & Build"), () => {
                frm.savesubmit();
            });
        }

        // Submitted — kursga link
        if (frm.doc.docstatus === 1 && frm.doc.created_course) {
            frm.add_custom_button(__("📘 Kursni ko'rish"), () => {
                frappe.set_route("Form", "LMS Course", frm.doc.created_course);
            });
        }
    },

    // Barcha quiz/oq rowlarning lesson_title cellini lock qilish
    apply_all_locks(frm) {
        ["quiz_questions", "open_questions"].forEach(field => {
            this._lock_table_cells(frm, field);
        });
    },

    // Bitta table dagi barcha lesson_title celllarini lock qilish
    _lock_table_cells(frm, table_field) {
        const grid = frm.fields_dict[table_field]?.grid;
        if (!grid) return;

        // grid refresh keyin ishga tushadi — setTimeout kerak
        setTimeout(() => {
            grid.grid_rows?.forEach(grid_row => {
                const cell = grid_row.columns?.lesson_title;
                if (cell?.$field) {
                    cell.$field.prop("disabled", true)
                        .css({
                            "background-color": "#e8f0fe",
                            "color":            "#1a56db",
                            "font-weight":      "600",
                            "cursor":           "not-allowed",
                            "pointer-events":   "none"
                        });
                }
            });
        }, 100);
    },

    // Child row ichidagi fieldlarni show/hide
    toggle_row_fields(frm, cdt, cdn) {
        const row      = locals[cdt][cdn];
        const grid_row = frm.fields_dict["lessons"]?.grid?.get_row(cdn);
        if (!grid_row) return;

        // depends_on JSON da qo'yilgan bo'lsa bu shart emas
        // Lekin grid_row.toggle_field = instant, depends_on = form reload kerak
        const map = {
            has_quiz:            ["quiz_title", "quiz_passing_score", "max_attempts"],
            has_open_questions:  ["oq_title", "open_q_passing_score"],
            has_assignment:      ["assignment_type", "assignment_instruction"]
        };

        Object.entries(map).forEach(([flag, fields]) => {
            fields.forEach(f => grid_row.toggle_field(f, !!row[flag]));
        });
    }

};

// =============================================================================
// LMSBuilder.Table
// =============================================================================

LMSBuilder.Table = {

    /**
     * has_quiz yoki has_open_questions bosilganda —
     * quiz/oq tabloga lesson_title prefilled placeholder row inject qilish.
     *
     * MUHIM: inject faqat birinchi placeholder rowni qo'shadi.
     * Admin "Add Row" orqali N ta savol qo'sha oladi — cheklov yo'q.
     * lesson_title barcha qo'shilgan rowlarda bir xil bo'ladi.
     */
    inject(frm, table_field, lesson_title) {
        if (!lesson_title) return;

        // Allaqachon kamida 1 row bor → qayta qo'shma
        // (agar admin has_quiz olib, qayta qo'ysa — eski rowlar saqlanadi)
        const already = (frm.doc[table_field] || [])
            .some(r => r.lesson_title === lesson_title);

        if (already) {
            frappe.show_alert({
                message: __(`"${lesson_title}" uchun savollar allaqachon mavjud`),
                indicator: "blue"
            }, 3);
            return;
        }

        // Yangi row qo'sh
        const new_row = frm.add_child(table_field);

        // frappe.model.set_value orqali yozish — model layer ga yetadi
        // to'g'ridan new_row.lesson_title = "..." ishlamaydi (reaktivlik yo'q)
        frappe.model.set_value(
            new_row.doctype,
            new_row.name,
            "lesson_title",
            lesson_title
        );

        frm.fields_dict[table_field].grid.refresh();

        // Yangi cell ni lock qil
        LMSBuilder.UI._lock_table_cells(frm, table_field);

        frm.dirty();

        const label = table_field === "quiz_questions" ? "quiz savol" : "ochiq savol";
        frappe.show_alert({
            message: __(`"${lesson_title}" uchun ${label} qatori qo'shildi`),
            indicator: "green"
        }, 3);
    },

    /**
     * has_quiz/has_oq olib tashlanganda —
     * confirm so'rab, o'sha lesson rowlarini o'chirish.
     * on_cancel_callback: checkbox ni qaytarish.
     */
    confirm_remove(frm, table_field, lesson_title, on_cancel_callback) {
        if (!lesson_title) return;

        const rows = (frm.doc[table_field] || [])
            .filter(r => r.lesson_title === lesson_title);

        if (!rows.length) return;

        const label = table_field === "quiz_questions"
            ? `quiz savollari (${rows.length} ta)`
            : `ochiq savollari (${rows.length} ta)`;

        frappe.confirm(
            __(`"${lesson_title}" uchun <b>${label}</b> o'chiriladi. Davom etasizmi?`),
            () => {
                // Tasdiqlandi — o'chir
                rows.forEach(r => {
                    const grid_row = frm.fields_dict[table_field]
                        ?.grid?.grid_rows_by_docname?.[r.name];
                    if (grid_row) grid_row.remove();
                });
                frm.fields_dict[table_field].grid.refresh();
            },
            () => {
                // Bekor qilindi — checkboxni qaytarish
                if (typeof on_cancel_callback === "function") {
                    on_cancel_callback();
                }
            }
        );
    },

    /**
     * Lesson Title o'zgarganda —
     * quiz_questions va open_questions dagi bog'liq rowlarni sync qilish.
     *
     * Frappe model layer da prev value saqlanmaydi — shuning uchun
     * biz row.__prev_lesson_title ni o'zimiz saqlaymiz.
     */
    sync_title_change(frm, cdt, cdn) {
        const row       = locals[cdt][cdn];
        const new_title = row.lesson_title || "";
        const old_title = row.__prev_lesson_title || "";

        if (!old_title || old_title === new_title) {
            row.__prev_lesson_title = new_title;
            return;
        }

        // Ikki tabloda ham eski nomni yangi nom bilan almashtirish
        let synced = 0;
        ["quiz_questions", "open_questions"].forEach(field => {
            (frm.doc[field] || [])
                .filter(r => r.lesson_title === old_title)
                .forEach(r => {
                    frappe.model.set_value(
                        r.doctype, r.name, "lesson_title", new_title
                    );
                    synced++;
                });
        });

        if (synced > 0) {
            frappe.show_alert({
                message: __(`${synced} ta savolda lesson nomi yangilandi`),
                indicator: "blue"
            }, 3);
        }

        row.__prev_lesson_title = new_title;
    },

    /**
     * Lesson row o'chirilganda —
     * quiz/oq tablodagi "yetim" rowlarni tozalash.
     * (Hech qaysi active lessonga tegishli bo'lmagan rowlar)
     */
    remove_orphan_rows(frm) {
        const valid = new Set(
            (frm.doc.lessons || [])
                .map(r => r.lesson_title)
                .filter(Boolean)
        );

        ["quiz_questions", "open_questions"].forEach(field => {
            const orphans = (frm.doc[field] || [])
                .filter(r => r.lesson_title && !valid.has(r.lesson_title));

            if (!orphans.length) return;

            orphans.forEach(r => {
                const grid_row = frm.fields_dict[field]
                    ?.grid?.grid_rows_by_docname?.[r.name];
                if (grid_row) grid_row.remove();
            });

            frm.fields_dict[field].grid.refresh();

            frappe.show_alert({
                message: __(`${orphans.length} ta yetim savollar o'chirildi`),
                indicator: "orange"
            }, 3);
        });
    }

};

// =============================================================================
// LMSBuilder.Validation
// =============================================================================

LMSBuilder.Validation = {

    /**
     * before_submit hook dan chaqiriladi.
     * Promise qaytaradi — reject() submit ni bloklaydi.
     */
    run(frm) {
        return new Promise((resolve, reject) => {
            const errors = this._collect(frm);

            if (!errors.length) {
                resolve();
                return;
            }

            const items = errors.map(e => `<li>${e}</li>`).join("");
            frappe.msgprint({
                title:     __("⛔ Submit blokland"),
                message:   `<ul style="margin:0;padding-left:18px">${items}</ul>`,
                indicator: "red"
            });

            reject();
        });
    },

    _collect(frm) {
        const errors = [];
        const doc    = frm.doc;

        // ── Header ─────────────────────────────────────────────────────────
        if (!doc.program_name) errors.push("Program Name kiritilmagan.");
        if (!doc.course_name)  errors.push("Course Name kiritilmagan.");

        if (!doc.lessons?.length) {
            errors.push("Kamida bitta Lesson qo'shing.");
            return errors;
        }

        // ── Lessons ─────────────────────────────────────────────────────────
        const seen_titles  = [];
        const quiz_lessons = new Set();
        const oq_lessons   = new Set();

        doc.lessons.forEach((row, i) => {
            const n = i + 1;

            if (!row.lesson_title) {
                errors.push(`Lessons Row ${n}: Lesson Title bo'sh.`);
                return;
            }

            if (seen_titles.includes(row.lesson_title)) {
                errors.push(
                    `Lessons Row ${n}: "${row.lesson_title}" takrorlanmoqda. ` +
                    `Har bir lesson nomi UNIQUE bo'lishi shart.`
                );
            }
            seen_titles.push(row.lesson_title);

            if (row.has_quiz) {
                if (!row.quiz_title) {
                    errors.push(`Lessons Row ${n} "${row.lesson_title}": Quiz Title bo'sh.`);
                }
                quiz_lessons.add(row.lesson_title);
            }

            if (row.has_open_questions) {
                if (!row.oq_title) {
                    errors.push(`Lessons Row ${n} "${row.lesson_title}": Open Q Title bo'sh.`);
                }
                oq_lessons.add(row.lesson_title);
            }

            if (row.has_assignment) {
                if (!row.assignment_instruction) {
                    errors.push(
                        `Lessons Row ${n} "${row.lesson_title}": ` +
                        `Assignment Instruction bo'sh.`
                    );
                }
            }
        });

        // ── Quiz Questions ───────────────────────────────────────────────────
        (doc.quiz_questions || []).forEach((row, i) => {
            const n = i + 1;

            if (!row.lesson_title) {
                errors.push(`Quiz Questions Row ${n}: Lesson bo'sh.`);
                return;
            }
            if (!quiz_lessons.has(row.lesson_title)) {
                errors.push(
                    `Quiz Questions Row ${n}: "${row.lesson_title}" — ` +
                    `lessons tabloda topilmadi yoki has_quiz belgilanmagan.`
                );
            }
            if (!row.question_text) {
                errors.push(`Quiz Questions Row ${n} ("${row.lesson_title}"): Savol bo'sh.`);
            }
            if (!row.option_a || !row.option_b) {
                errors.push(
                    `Quiz Questions Row ${n} ("${row.lesson_title}"): ` +
                    `Kamida Option A va B majburiy.`
                );
            }
            if (!row.correct_option) {
                errors.push(
                    `Quiz Questions Row ${n} ("${row.lesson_title}"): ` +
                    `To'g'ri javob belgilanmagan.`
                );
            }
        });

        // ── Open Questions ───────────────────────────────────────────────────
        (doc.open_questions || []).forEach((row, i) => {
            const n = i + 1;

            if (!row.lesson_title) {
                errors.push(`Open Questions Row ${n}: Lesson bo'sh.`);
                return;
            }
            if (!oq_lessons.has(row.lesson_title)) {
                errors.push(
                    `Open Questions Row ${n}: "${row.lesson_title}" — ` +
                    `lessons tabloda topilmadi yoki has_open_questions belgilanmagan.`
                );
            }
            if (!row.question_text) {
                errors.push(`Open Questions Row ${n} ("${row.lesson_title}"): Savol bo'sh.`);
            }
        });

        return errors;
    }

};
