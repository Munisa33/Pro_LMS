frappe.ui.form.on('LMS Course Builder', {
    refresh(frm) {
        if (!frm.is_new() && !frm.doc.created_course) {
            frm.add_custom_button('Kurs Yaratish (Build)', function() {
                frappe.confirm(
                    "Builder barcha ma'lumotlarni yaratadi. Davom etasizmi?",
                    function() {
                        frm.call({
                            method: 'build_course',
                            doc: frm.doc,
                            freeze: true,
                            freeze_message: 'Kurs yaratilmoqda...',
                            callback: function(r) {
                                if (!r.exc) {
                                    frm.reload_doc();
                                }
                            }
                        });
                    }
                );
            }).addClass('btn-primary');
        }

        if (frm.doc.created_course) {
            frm.add_custom_button("Kursni Ko'rish", function() {
                frappe.set_route('Form', 'LMS Course', frm.doc.created_course);
            });
        }
    }
});
