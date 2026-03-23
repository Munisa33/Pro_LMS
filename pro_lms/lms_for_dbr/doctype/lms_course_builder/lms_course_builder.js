// ═══════════════════════════════════════════════════════════════
//  lms_course_builder.js  |  Frappe v15
// ═══════════════════════════════════════════════════════════════

// ── BLOK 1: CORE ENGINE ────────────────────────────────────────

function get_lesson_opts(frm) {
    const titles = (frm.doc.lessons || [])
        .map(r => r.lesson_title)
        .filter(Boolean);
    return '\n' + titles.join('\n');
}

function sync_lesson_options(frm) {
    const opts = get_lesson_opts(frm);

    const TARGETS = {
        'quiz_questions':  'LMS Builder Quiz Row',
        'open_questions':  'LMS Builder Open Question Row'
    };

    Object.entries(TARGETS).forEach(([field_name, child_doctype]) => {
        const gf = frm.fields_dict[field_name];
        if (!gf) return;

        gf.grid.update_docfield_property('lesson_title', 'options', opts);

        const df = frappe.meta.get_docfield(child_doctype, 'lesson_title');
        if (df) df.options = opts;

        gf.grid.refresh();
    });
}

// ── BLOK 2: PARENT FORM EVENTS ─────────────────────────────────

frappe.ui.form.on('LMS Course Builder', {
    onload(frm) {
        sync_lesson_options(frm);
    },
    refresh(frm) {
        sync_lesson_options(frm);
        setup_batch_buttons(frm);
    }
});

// ── BLOK 3: LESSONS CHILD TABLE EVENTS ────────────────────────

frappe.ui.form.on('LMS Builder Row', {

    lesson_title(frm) {
        sync_lesson_options(frm);
    },

    lessons_add(frm) {
        sync_lesson_options(frm);
    },

    lessons_remove(frm) {
        sync_lesson_options(frm);
    },

    form_render(frm) {
        sync_lesson_options(frm);
    },

    // ── YANGI: has_quiz bosilganda avtomatik 1 ta row qo'shadi ──
    has_quiz(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (!row.has_quiz || !row.lesson_title) return;

        // Allaqachon shu lesson uchun satr bormi?
        const exists = (frm.doc.quiz_questions || [])
            .some(q => q.lesson_title === row.lesson_title);
        if (exists) return;

        // 1 ta bo'sh satr qo'sh, lesson_title avtomatik
        const new_row = frappe.model.add_child(
            frm.doc, 'LMS Builder Quiz Row', 'quiz_questions'
        );
        new_row.lesson_title = row.lesson_title;

        frm.fields_dict['quiz_questions'].grid.refresh();
        frm.dirty();

        frappe.show_alert({
            message: __(`"${row.lesson_title}" uchun quiz satri qo'shildi`),
            indicator: 'blue'
        }, 4);// lms_course_builder.js — FAQAT SHU KOD BO'LISHI KERAK

function get_lesson_opts(frm) {
    const titles = (frm.doc.lessons || [])
        .map(r => r.lesson_title)
        .filter(Boolean);
    return '\n' + titles.join('\n');
}

function sync_lesson_options(frm) {
    const opts = get_lesson_opts(frm);

    const TARGETS = {
        'quiz_questions': 'LMS Builder Quiz Row',
        'open_questions': 'LMS Builder Open Question Row'
    };

    Object.entries(TARGETS).forEach(([field_name, child_doctype]) => {
        const gf = frm.fields_dict[field_name];
        if (!gf) return;

        gf.grid.update_docfield_property('lesson_title', 'options', opts);

        const df = frappe.meta.get_docfield(child_doctype, 'lesson_title');
        if (df) df.options = opts;

        gf.grid.refresh();
    });
}

frappe.ui.form.on('LMS Course Builder', {
    onload(frm) {
        sync_lesson_options(frm);
    },
    refresh(frm) {
        sync_lesson_options(frm);
        setup_batch_buttons(frm);
    }
});

frappe.ui.form.on('LMS Builder Row', {
    lesson_title(frm) { sync_lesson_options(frm); },
    lessons_add(frm)  { sync_lesson_options(frm); },
    lessons_remove(frm){ sync_lesson_options(frm); },
    form_render(frm)  { sync_lesson_options(frm); }
});

frappe.ui.form.on('LMS Builder Quiz Row', {
    form_render(frm) { sync_lesson_options(frm); }
});

frappe.ui.form.on('LMS Builder Open Question Row', {
    form_render(frm) { sync_lesson_options(frm); }
});

function setup_batch_buttons(frm) {
    if (frm.doc.docstatus !== 0) return;

    frm.add_custom_button(
        __("📝 Quiz Savollar"),
        () => open_batch_dialog(frm, 'quiz'),
        __("➕ Tezkor Qo'sh")
    );

    frm.add_custom_button(
        __("❓ Ochiq Savollar"),
        () => open_batch_dialog(frm, 'open'),
        __("➕ Tezkor Qo'sh")
    );
}

function open_batch_dialog(frm, type) {
    const is_quiz   = (type === 'quiz');
    const flag_key  = is_quiz ? 'has_quiz' : 'has_open_questions';
    const child_dt  = is_quiz ? 'LMS Builder Quiz Row'
                              : 'LMS Builder Open Question Row';
    const tgt_field = is_quiz ? 'quiz_questions' : 'open_questions';

    const eligible = (frm.doc.lessons || [])
        .filter(r => r[flag_key] && r.lesson_title)
        .map(r => r.lesson_title);

    if (!eligible.length) {
        frappe.msgprint({
            title: __('Lesson topilmadi'),
            message: is_quiz
                ? __('Lessons jadvalida <b>"Has Quiz"</b> belgilangan lesson yo\'q.')
                : __('Lessons jadvalida <b>"Has Open Q"</b> belgilangan lesson yo\'q.'),
            indicator: 'orange'
        });
        return;
    }

    new frappe.ui.Dialog({
        title: is_quiz
            ? __("📝 Quiz Savollar Qo'sh")
            : __("❓ Ochiq Savollar Qo'sh"),
        fields: [
            {
                fieldname: 'lesson_title',
                fieldtype: 'Select',
                label: __('Qaysi Lesson uchun?'),
                options: '\n' + eligible.join('\n'),
                reqd: 1
            },
            {
                fieldname: 'count',
                fieldtype: 'Int',
                label: __('Nechta bo\'sh satr?'),
                default: 10,
                reqd: 1
            }
        ],
        primary_action_label: __("Qo'sh"),
        primary_action(vals) {
            if (!vals.lesson_title || !vals.count || vals.count < 1) return;
            const limit = Math.min(vals.count, 50);

            for (let i = 0; i < limit; i++) {
                const row = frappe.model.add_child(frm.doc, child_dt, tgt_field);
                row.lesson_title = vals.lesson_title;
            }

            frm.fields_dict[tgt_field].grid.refresh();
            frm.dirty();
            this.hide();

            frappe.show_alert({
                message: __(`${limit} ta satr "${vals.lesson_title}" uchun qo'shildi ✓`),
                indicator: 'green'
            }, 5);
        }
    }).show();
}

    },

    // ── YANGI: has_open_questions bosilganda avtomatik 1 ta row ─
    has_open_questions(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (!row.has_open_questions || !row.lesson_title) return;

        const exists = (frm.doc.open_questions || [])
            .some(q => q.lesson_title === row.lesson_title);
        if (exists) return;

        const new_row = frappe.model.add_child(
            frm.doc, 'LMS Builder Open Question Row', 'open_questions'
        );
        new_row.lesson_title = row.lesson_title;

        frm.fields_dict['open_questions'].grid.refresh();
        frm.dirty();

        frappe.show_alert({
            message: __(`"${row.lesson_title}" uchun ochiq savol satri qo'shildi`),
            indicator: 'blue'
        }, 4);
    }
});

// ── BLOK 4: QUIZ / OPEN QUESTION ROW EXPAND ────────────────────

frappe.ui.form.on('LMS Builder Quiz Row', {
    form_render(frm) { sync_lesson_options(frm); }
});

frappe.ui.form.on('LMS Builder Open Question Row', {
    form_render(frm) { sync_lesson_options(frm); }
});

// ── BLOK 5: BATCH ADD BUTTONS ──────────────────────────────────

function setup_batch_buttons(frm) {
    if (frm.doc.docstatus !== 0) return;

    frm.add_custom_button(
        __("📝 Quiz Savollar"),
        () => open_batch_dialog(frm, 'quiz'),
        __("➕ Tezkor Qo'sh")
    );

    frm.add_custom_button(
        __("❓ Ochiq Savollar"),
        () => open_batch_dialog(frm, 'open'),
        __("➕ Tezkor Qo'sh")
    );
}

function open_batch_dialog(frm, type) {
    const is_quiz   = (type === 'quiz');
    const flag_key  = is_quiz ? 'has_quiz' : 'has_open_questions';
    const child_dt  = is_quiz ? 'LMS Builder Quiz Row'
                              : 'LMS Builder Open Question Row';
    const tgt_field = is_quiz ? 'quiz_questions' : 'open_questions';

    const eligible = (frm.doc.lessons || [])
        .filter(r => r[flag_key] && r.lesson_title)
        .map(r => r.lesson_title);

    if (!eligible.length) {
        frappe.msgprint({
            title: __('Lesson topilmadi'),
            message: is_quiz
                ? __('Lessons jadvalida <b>"Has Quiz"</b> belgilangan lesson yo\'q.')
                : __('Lessons jadvalida <b>"Has Open Q"</b> belgilangan lesson yo\'q.'),
            indicator: 'orange'
        });
        return;
    }

    new frappe.ui.Dialog({
        title: is_quiz
            ? __("📝 Quiz Savollar Qo'sh")
            : __("❓ Ochiq Savollar Qo'sh"),
        fields: [
            {
                fieldname: 'lesson_title',
                fieldtype: 'Select',
                label: __('Qaysi Lesson uchun?'),
                options: '\n' + eligible.join('\n'),
                reqd: 1
            },
            {
                fieldname: 'count',
                fieldtype: 'Int',
                label: __('Nechta bo\'sh satr?'),
                default: 10,
                reqd: 1
            }
        ],
        primary_action_label: __("Qo'sh"),
        primary_action(vals) {
            if (!vals.lesson_title || !vals.count || vals.count < 1) return;
            const limit = Math.min(vals.count, 50);

            for (let i = 0; i < limit; i++) {
                const row = frappe.model.add_child(
                    frm.doc, child_dt, tgt_field
                );
                row.lesson_title = vals.lesson_title;
            }

            frm.fields_dict[tgt_field].grid.refresh();
            frm.dirty();
            this.hide();

            frappe.show_alert({
                message: __(`${limit} ta satr "${vals.lesson_title}" uchun qo'shildi ✓`),
                indicator: 'green'
            }, 5);
        }
    }).show();
}
