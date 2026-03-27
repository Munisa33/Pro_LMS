frappe.pages["lms-dashboard"].on_page_load = function (wrapper) {
    frappe.ui.make_app_page({
        parent: wrapper,
        title: "O'quv Dashboard",
        single_column: true,
    });
    wrapper.lms_dashboard_instance = new LMSDashboard(wrapper);
};

frappe.pages["lms-dashboard"].on_page_show = function (wrapper) {
    if (wrapper.lms_dashboard_instance) {
        wrapper.lms_dashboard_instance.refresh();
    }
};

class LMSDashboard {
    constructor(wrapper) {
        this.wrapper = wrapper;
        this.page = wrapper.page;
        this.data = null;
        this.current_view = "tree";
        this.filters = { course: "", status: "", type: "" };

        this._build_skeleton();
        this._bind_events();
    }

    refresh() {
        this._load_data();
    }

    // ── Skeleton ──────────────────────────────────────────────────────────────

    _build_skeleton() {
        this.$main = $(this.wrapper).find(".layout-main-section");
        this.$main.html(`
            <div id="lms-db-root" class="lms-db-root">
                <div id="lms-db-summary" class="lms-db-summary"></div>
                <div class="lms-db-tabs">
                    <button class="lms-tab-btn active" data-view="tree">
                        📚 Mening Kurslarim
                    </button>
                    <button class="lms-tab-btn" data-view="tasks">
                        📝 Topshiriqlar va Natijalar
                    </button>
                </div>
                <div id="lms-db-content" class="lms-db-content"></div>
            </div>
        `);
    }

    // ── Data loading ──────────────────────────────────────────────────────────

    _load_data() {
        this._show_loading();
        frappe
            .xcall("pro_lms.lms_for_dbr.api.dashboard.get_dashboard_data")
            .then((data) => {
                this.data = data;
                this._render();
            })
            .catch(() => {
                this._get_content_el().html(`
                    <div class="lms-error-state">
                        <p>⚠️ Dashboard ma'lumotlarini yuklashda xato yuz berdi.</p>
                    </div>
                `);
            });
    }

    _show_loading() {
        this._get_content_el().html(`
            <div class="lms-loading-state">
                <div class="lms-spinner"></div>
                <p>Yuklanmoqda...</p>
            </div>
        `);
    }

    _get_content_el() {
        return this.$main.find("#lms-db-content");
    }

    // ── Top-level render ──────────────────────────────────────────────────────

    _render() {
        this._render_summary();
        this._render_view();
    }

    _render_view() {
        if (this.current_view === "tree") {
            this._render_tree();
        } else {
            this._render_tasks();
        }
    }

    // ── Summary cards ─────────────────────────────────────────────────────────

    _render_summary() {
        const s = this.data.summary;
        this.$main.find("#lms-db-summary").html(`
            <div class="lms-summary-grid">
                <div class="lms-summary-card">
                    <div class="lms-card-icon">📚</div>
                    <div class="lms-card-value">${s.total_courses}</div>
                    <div class="lms-card-label">Jami kurslar</div>
                </div>
                <div class="lms-summary-card lms-card-green">
                    <div class="lms-card-icon">✅</div>
                    <div class="lms-card-value">${s.completed_courses}</div>
                    <div class="lms-card-label">Tugatilgan</div>
                </div>
                <div class="lms-summary-card">
                    <div class="lms-card-icon">📊</div>
                    <div class="lms-card-value">${s.average_score}%</div>
                    <div class="lms-card-label">O'rtacha ball</div>
                </div>
                <div class="lms-summary-card">
                    <div class="lms-card-icon">⏱️</div>
                    <div class="lms-card-value">${_fmt_time(s.total_time_spent_sec)}</div>
                    <div class="lms-card-label">Vaqt sarflandi</div>
                </div>
            </div>
        `);
    }

    // ── Tree view ─────────────────────────────────────────────────────────────

    _render_tree() {
        if (!this.data.tree || this.data.tree.length === 0) {
            this._get_content_el().html(`
                <div class="lms-empty-state">
                    <div class="lms-empty-icon">📭</div>
                    <h3>Hech qanday kurs topilmadi</h3>
                    <p>Siz hali hech qanday kursga yozilmagansiz.</p>
                </div>
            `);
            return;
        }

        let html = '<div class="lms-tree">';
        for (const node of this.data.tree) {
            if (node.program_name) {
                html += this._program_node_html(node);
            } else if (node.courses && node.courses.length) {
                html += this._course_node_html(node.courses[0], 0);
            }
        }
        html += "</div>";
        this._get_content_el().html(html);
    }

    _program_node_html(prog) {
        const uid = _uid();
        const courses_html = (prog.courses || [])
            .map((c) => this._course_node_html(c, 1))
            .join("");
        return `
            <div class="lms-tree-node lms-node-program">
                <div class="lms-node-header" data-toggle="${uid}">
                    <span class="lms-toggle">▶</span>
                    <span class="lms-node-icon">📚</span>
                    <span class="lms-node-title">${_esc(prog.program_name)}</span>
                    ${_progress_bar(prog.program_progress)}
                </div>
                <div class="lms-node-children lms-collapsed" id="${uid}">${courses_html}</div>
            </div>`;
    }

    _course_node_html(course, depth) {
        const uid = _uid();
        const status_cls =
            course.enrollment_status === "Completed"
                ? "lms-badge-green"
                : "lms-badge-blue";
        const status_label =
            course.enrollment_status === "Completed" ? "Tugatilgan" : "Faol";
        const sections_html = (course.sections || [])
            .map((s) => this._section_node_html(s, course, depth + 1))
            .join("");

        return `
            <div class="lms-tree-node lms-node-course" style="--lms-depth:${depth}">
                <div class="lms-node-header" data-toggle="${uid}">
                    <span class="lms-toggle">▶</span>
                    <span class="lms-node-icon">📖</span>
                    <span class="lms-node-title">${_esc(course.course_name)}</span>
                    ${_progress_bar(course.course_progress)}
                    <span class="lms-badge ${status_cls}">${status_label}</span>
                </div>
                <div class="lms-node-children lms-collapsed" id="${uid}">
                    ${sections_html}
                    <div class="lms-course-result">
                        📊 Kurs natijasi: <strong>${course.course_progress}%</strong>
                        ${course.passing_score ? `&nbsp;(O'tish balli: ${course.passing_score}%)` : ""}
                        ${course.course_progress >= (course.passing_score || 0) && course.course_progress > 0 ? " ✅" : ""}
                    </div>
                </div>
            </div>`;
    }

    _section_node_html(section, course, depth) {
        const uid = _uid();
        const lessons_html = (section.lessons || [])
            .map((l) => this._lesson_node_html(l, course))
            .join("");
        return `
            <div class="lms-tree-node lms-node-section" style="--lms-depth:${depth}">
                <div class="lms-node-header" data-toggle="${uid}">
                    <span class="lms-toggle">▶</span>
                    <span class="lms-node-icon">📁</span>
                    <span class="lms-node-title">${_esc(section.section_title)}</span>
                    ${_progress_bar(section.section_progress)}
                </div>
                <div class="lms-node-children lms-collapsed" id="${uid}">${lessons_html}</div>
            </div>`;
    }

    _lesson_node_html(lesson, course) {
        const p = lesson.progress;
        let icon = "⬜";
        let cls = "";

        if (lesson.is_locked) {
            icon = "🔒";
            cls = "lms-locked";
        } else if (p.is_completed) {
            icon = "✅";
            cls = "lms-completed";
        } else if (p.completion_percent > 0) {
            icon = "🔄";
            cls = "lms-inprogress";
        }

        const clickable = !lesson.is_locked;
        const duration = _fmt_duration(lesson.video_duration_sec);
        const watch_label =
            !p.is_completed && p.completion_percent > 0
                ? `<span class="lms-watch-pct">${Math.round(p.completion_percent)}% ko'rildi</span>`
                : "";

        const assessments = [
            lesson.quiz ? this._quiz_badge_html(lesson.quiz, lesson, course) : "",
            lesson.assignment ? this._assignment_badge_html(lesson.assignment, lesson, course) : "",
            lesson.open_questions ? this._oq_badge_html(lesson.open_questions, lesson, course) : "",
        ]
            .filter(Boolean)
            .join("");

        return `
            <div class="lms-tree-node lms-node-lesson ${cls}" style="--lms-depth:3">
                <div class="lms-lesson-row${clickable ? " lms-clickable" : ""}"
                     ${clickable ? `data-lesson="${lesson.lesson_name}" data-enrollment="${course.enrollment_name}"` : ""}
                     title="${lesson.is_locked ? "Avvalgi darsni tugating" : _esc(lesson.lesson_title)}">
                    <span class="lms-status-icon">${icon}</span>
                    <span class="lms-node-icon">🎬</span>
                    <span class="lms-node-title">${_esc(lesson.lesson_title)}</span>
                    <span class="lms-duration">${duration}</span>
                    ${watch_label}
                </div>
                ${assessments ? `<div class="lms-assessments">${assessments}</div>` : ""}
            </div>`;
    }

    _quiz_badge_html(quiz, lesson, course) {
        let badge_cls = "lms-badge-gray";
        let label = "Topshirilmagan";
        let retry_btn = "";

        if (quiz.best_attempt) {
            if (quiz.best_attempt.passed) {
                badge_cls = "lms-badge-green";
                label = `✅ O'tdi (${quiz.best_attempt.percentage}%)`;
            } else {
                badge_cls = "lms-badge-red";
                label = `❌ O'tmadi (${quiz.best_attempt.percentage}%)`;
                if (quiz.can_retry) {
                    retry_btn = `<button class="lms-retry-btn"
                        data-lesson="${lesson.lesson_name}"
                        data-enrollment="${course.enrollment_name}">Qayta topshirish</button>`;
                }
            }
        }

        const attempts_info =
            quiz.attempts_used > 0
                ? `<span class="lms-attempts">${quiz.attempts_used}/${quiz.max_attempts || "∞"}</span>`
                : "";

        return `
            <div class="lms-assessment-row">
                <span class="lms-assess-icon">📝</span>
                <span class="lms-assess-title">${_esc(quiz.quiz_title)}</span>
                <span class="lms-badge ${badge_cls}">${label}</span>
                ${attempts_info}
                ${retry_btn}
            </div>`;
    }

    _assignment_badge_html(assignment, lesson, course) {
        const status_map = {
            Pending: { cls: "lms-badge-yellow", label: "⏳ Tekshirilmoqda" },
            Reviewed: { cls: "lms-badge-blue", label: "👁️ Ko'rib chiqildi" },
            Approved: { cls: "lms-badge-green", label: "✅ Tasdiqlandi" },
            Rejected: { cls: "lms-badge-red", label: "❌ Rad etildi" },
        };

        const sub = assignment.submission;
        const mapped = sub
            ? status_map[sub.status] || { cls: "lms-badge-gray", label: sub.status }
            : { cls: "lms-badge-gray", label: "Topshirilmagan" };

        return `
            <div class="lms-assessment-row">
                <span class="lms-assess-icon">📋</span>
                <span class="lms-assess-title">Topshiriq</span>
                <span class="lms-badge ${mapped.cls}">${mapped.label}</span>
                ${sub && sub.score !== null && sub.score !== undefined ? `<span class="lms-score">${sub.score}%</span>` : ""}
            </div>`;
    }

    _oq_badge_html(oq, lesson, course) {
        let badge_cls = "lms-badge-gray";
        let label = `${oq.answered}/${oq.total_questions} javob`;

        if (oq.status === "Graded") {
            badge_cls = "lms-badge-green";
            label = `✅ Baholandi (${oq.score_percent}%)`;
        } else if (oq.status === "Pending" || oq.status === "Partially Graded") {
            badge_cls = "lms-badge-yellow";
            label = `⏳ ${oq.answered}/${oq.total_questions} javob`;
        }

        return `
            <div class="lms-assessment-row">
                <span class="lms-assess-icon">❓</span>
                <span class="lms-assess-title">${_esc(oq.oq_title)}</span>
                <span class="lms-badge ${badge_cls}">${label}</span>
            </div>`;
    }

    // ── Tasks table view ──────────────────────────────────────────────────────

    _render_tasks() {
        const courses = [...new Set(this.data.tasks_table.map((t) => t.course_name))];
        const course_opts = courses
            .map((c) => `<option value="${_esc(c)}">${_esc(c)}</option>`)
            .join("");

        const content = `
            <div class="lms-tasks-wrap">
                <div class="lms-filters">
                    <select id="lms-f-course" class="lms-filter-sel">
                        <option value="">Barcha kurslar</option>
                        ${course_opts}
                    </select>
                    <select id="lms-f-status" class="lms-filter-sel">
                        <option value="">Barcha holat</option>
                        <option>O'tdi</option>
                        <option>O'tmadi</option>
                        <option>Tekshirilmoqda</option>
                        <option>Tasdiqlandi</option>
                        <option>Rad etildi</option>
                        <option>Baholandi</option>
                    </select>
                    <select id="lms-f-type" class="lms-filter-sel">
                        <option value="">Barcha tur</option>
                        <option value="Quiz">Quiz</option>
                        <option value="Assignment">Topshiriq</option>
                        <option value="Open Q">Ochiq savollar</option>
                    </select>
                </div>
                <div id="lms-table-body"></div>
            </div>`;
        this._get_content_el().html(content);
        this._render_tasks_table();
    }

    _render_tasks_table() {
        const filtered = this.data.tasks_table.filter((t) => {
            if (this.filters.course && t.course_name !== this.filters.course)
                return false;
            if (this.filters.status && t.status !== this.filters.status)
                return false;
            if (this.filters.type && t.type !== this.filters.type) return false;
            return true;
        });

        if (filtered.length === 0) {
            this._get_content_el()
                .find("#lms-table-body")
                .html(`<div class="lms-empty-state"><p>Hech qanday topshiriq topilmadi.</p></div>`);
            return;
        }

        const rows = filtered
            .map((t) => {
                const failed =
                    t.status === "O'tmadi" || t.status === "Rad etildi";
                const score =
                    t.score !== null && t.score !== undefined
                        ? `${t.score}%`
                        : "—";

                let action = "—";
                if (t.can_retry) {
                    action = `<button class="lms-action-btn lms-retry-btn"
                        data-lesson="${t.lesson_name}"
                        data-enrollment="${t.enrollment_name}">Qayta topshirish</button>`;
                } else if (t.type === "Open Q") {
                    action = `<button class="lms-action-btn lms-view-btn"
                        data-type="Open Q"
                        data-lesson="${t.lesson_name}">Ko'rish</button>`;
                } else if (t.attempt_detail_name) {
                    action = `<button class="lms-action-btn lms-view-btn"
                        data-detail="${t.attempt_detail_name}"
                        data-type="${t.type}">Ko'rish</button>`;
                }

                return `
                    <tr class="${failed ? "lms-row-failed" : ""}">
                        <td>${_esc(t.lesson_title)}</td>
                        <td><span class="lms-type-tag lms-type-${t.type.replace(/\s/g, "-").toLowerCase()}">${t.type}</span></td>
                        <td>${_esc(t.title)}</td>
                        <td class="${failed ? "lms-text-red" : ""}">${t.status}</td>
                        <td>${score}</td>
                        <td>${t.date || "—"}</td>
                        <td>${action}</td>
                    </tr>`;
            })
            .join("");

        this._get_content_el()
            .find("#lms-table-body")
            .html(`
                <div class="lms-table-scroll">
                    <table class="lms-tasks-table">
                        <thead>
                            <tr>
                                <th>Dars</th><th>Tur</th>
                                <th>Topshiriq</th><th>Holat</th>
                                <th>Ball</th><th>Sana</th><th>Amal</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>`);
    }

    // ── Detail modals ─────────────────────────────────────────────────────────

    _show_detail(detail_name, type) {
        if (type === "Quiz") {
            this._show_quiz_detail(detail_name);
        } else if (type === "Assignment") {
            this._show_assignment_detail(detail_name);
        }
    }

    _show_quiz_detail(detail_name) {
        const d = new frappe.ui.Dialog({
            title: "Quiz natijasi",
            fields: [{ fieldtype: "HTML", fieldname: "body" }],
        });
        d.fields_dict.body.$wrapper.html('<div class="lms-modal-loading">Yuklanmoqda...</div>');
        d.show();

        frappe.db.get_doc("LMS Quiz Attempt", detail_name).then((doc) => {
            d.fields_dict.body.$wrapper.html(`
                <div class="lms-modal-card">
                    <div class="lms-modal-kv">
                        <span>Natija</span>
                        <strong class="${doc.passed ? "lms-text-green" : "lms-text-red"}">
                            ${doc.passed ? "✅ O'tdi" : "❌ O'tmadi"}
                        </strong>
                    </div>
                    <div class="lms-modal-kv">
                        <span>Ball</span>
                        <strong>${Math.round(doc.percentage || 0)}%</strong>
                    </div>
                    <div class="lms-modal-kv">
                        <span>Sarflangan vaqt</span>
                        <strong>${_fmt_duration(doc.time_taken_sec)}</strong>
                    </div>
                    <div class="lms-modal-kv">
                        <span>Urinish raqami</span>
                        <strong>${doc.attempt_number}</strong>
                    </div>
                </div>`);
        });
    }

    _show_assignment_detail(detail_name) {
        const d = new frappe.ui.Dialog({
            title: "Topshiriq tafsiloti",
            fields: [{ fieldtype: "HTML", fieldname: "body" }],
        });
        d.fields_dict.body.$wrapper.html('<div class="lms-modal-loading">Yuklanmoqda...</div>');
        d.show();

        frappe.db.get_doc("LMS Assignment Submission", detail_name).then((doc) => {
            const status_cls = {
                Approved: "lms-text-green",
                Rejected: "lms-text-red",
                Pending: "lms-text-orange",
                Reviewed: "lms-text-blue",
            }[doc.status] || "";

            const status_label = {
                Approved: "✅ Tasdiqlandi",
                Rejected: "❌ Rad etildi",
                Pending: "⏳ Tekshirilmoqda",
                Reviewed: "👁️ Ko'rib chiqildi",
            }[doc.status] || doc.status;

            let file_html = `<span class="lms-muted">Fayl yuklanmagan</span>`;
            if (doc.attached_file) {
                file_html = `<a class="lms-file-btn" href="${_esc(doc.attached_file)}" target="_blank" rel="noopener noreferrer">
                    <span class="lms-file-icon">📎</span> Faylni yuklab olish
                </a>`;
            } else if (doc.google_sheets_url) {
                file_html = `<a class="lms-file-btn lms-file-btn-link" href="${_esc(doc.google_sheets_url)}" target="_blank" rel="noopener noreferrer">
                    <span class="lms-file-icon">🔗</span> Google Sheets ni ochish
                </a>`;
            }

            const feedback_html = doc.admin_feedback
                ? `<div class="lms-modal-section lms-feedback-section">
                    <div class="lms-modal-section-title">💬 Admin izohi</div>
                    <div class="lms-feedback-body">${_esc_nl(doc.admin_feedback)}</div>
                   </div>`
                : "";

            d.fields_dict.body.$wrapper.html(`
                <div class="lms-modal-card">
                    <div class="lms-modal-section">
                        <div class="lms-modal-section-title">📤 Sizning topshirig'ingiz</div>
                        <div class="lms-modal-section-body">${file_html}</div>
                    </div>
                    <div class="lms-modal-section">
                        <div class="lms-modal-section-title">📊 Natija</div>
                        <div class="lms-modal-kv">
                            <span>Holat</span>
                            <strong class="${status_cls}">${status_label}</strong>
                        </div>
                        <div class="lms-modal-kv">
                            <span>Ball</span>
                            <strong>${doc.admin_score !== null && doc.admin_score !== undefined ? doc.admin_score + "%" : "—"}</strong>
                        </div>
                    </div>
                    ${feedback_html}
                </div>`);
        });
    }

    _show_oq_detail(lesson_name) {
        const d = new frappe.ui.Dialog({
            title: "Ochiq savol javoblari",
            size: "large",
            fields: [{ fieldtype: "HTML", fieldname: "body" }],
        });
        d.fields_dict.body.$wrapper.html('<div class="lms-modal-loading">Yuklanmoqda...</div>');
        d.show();

        frappe
            .xcall("pro_lms.lms_for_dbr.api.dashboard.get_oq_answers", { lesson: lesson_name })
            .then((answers) => {
                if (!answers || answers.length === 0) {
                    d.fields_dict.body.$wrapper.html(
                        '<p class="lms-muted" style="padding:16px">Javoblar topilmadi.</p>'
                    );
                    return;
                }

                const items_html = answers
                    .map((a, i) => {
                        const graded = a.status === "Graded";
                        const status_badge = graded
                            ? `<span class="lms-badge lms-badge-green">✅ Baholandi</span>`
                            : `<span class="lms-badge lms-badge-yellow">⏳ Tekshirilmoqda</span>`;
                        const score_html =
                            a.score !== null && a.score !== undefined
                                ? `<span class="lms-oq-score">${a.score} / ${a.marks} ball</span>`
                                : "";
                        const feedback_html = a.admin_feedback
                            ? `<div class="lms-oq-feedback">
                                <span class="lms-oq-feedback-label">💬 Admin izohi:</span>
                                <span>${_esc_nl(a.admin_feedback)}</span>
                               </div>`
                            : "";

                        return `
                            <div class="lms-oq-item">
                                <div class="lms-oq-question">
                                    <span class="lms-oq-num">${i + 1}</span>
                                    <span class="lms-oq-question-text">${_esc_nl(a.question_text)}</span>
                                </div>
                                <div class="lms-oq-answer">
                                    <span class="lms-oq-answer-label">Sizning javobingiz:</span>
                                    <div class="lms-oq-answer-text">${_esc_nl(a.answer_text || "—")}</div>
                                </div>
                                <div class="lms-oq-meta">
                                    ${status_badge}
                                    ${score_html}
                                </div>
                                ${feedback_html}
                            </div>`;
                    })
                    .join("");

                d.fields_dict.body.$wrapper.html(
                    `<div class="lms-oq-list">${items_html}</div>`
                );
            });
    }

    // ── Events (delegated) ────────────────────────────────────────────────────

    _bind_events() {
        const $root = this.$main;
        let filter_timer;

        // Tab switch
        $root.on("click", ".lms-tab-btn", (e) => {
            const view = $(e.currentTarget).data("view");
            $root.find(".lms-tab-btn").removeClass("active");
            $(e.currentTarget).addClass("active");
            this.current_view = view;
            this._render_view();
        });

        // Tree collapse/expand
        $root.on("click", ".lms-node-header", (e) => {
            if ($(e.target).closest("button").length) return;
            const id = $(e.currentTarget).data("toggle");
            const $ch = $root.find(`#${id}`);
            $ch.toggleClass("lms-collapsed");
            $(e.currentTarget)
                .find(".lms-toggle")
                .text($ch.hasClass("lms-collapsed") ? "▶" : "▼");
        });

        // Navigate to lesson player
        $root.on("click", ".lms-lesson-row.lms-clickable", (e) => {
            if ($(e.target).closest("button").length) return;
            const lesson = $(e.currentTarget).data("lesson");
            const enrollment = $(e.currentTarget).data("enrollment");
            window._lms_player_params = { lesson, enrollment };
            frappe.set_route("lms-player");
        });

        // Retry button
        $root.on("click", ".lms-retry-btn", (e) => {
            e.stopPropagation();
            const lesson = $(e.currentTarget).data("lesson");
            const enrollment = $(e.currentTarget).data("enrollment");
            window._lms_player_params = { lesson, enrollment };
            frappe.set_route("lms-player");
        });

        // View detail
        $root.on("click", ".lms-view-btn", (e) => {
            e.stopPropagation();
            const type = $(e.currentTarget).data("type");
            if (type === "Open Q") {
                const lesson = $(e.currentTarget).data("lesson");
                this._show_oq_detail(lesson);
            } else {
                const detail = $(e.currentTarget).data("detail");
                this._show_detail(detail, type);
            }
        });

        // Filters (debounced)
        $root.on("change", ".lms-filter-sel", () => {
            clearTimeout(filter_timer);
            filter_timer = setTimeout(() => {
                this.filters.course = $root.find("#lms-f-course").val();
                this.filters.status = $root.find("#lms-f-status").val();
                this.filters.type = $root.find("#lms-f-type").val();
                this._render_tasks_table();
            }, 200);
        });
    }
}

// ── Pure utility functions (module-level, no state) ───────────────────────────

function _uid() {
    return "lms-" + Math.random().toString(36).slice(2, 10);
}

function _esc(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function _progress_bar(pct) {
    const val = Math.min(100, Math.max(0, pct || 0));
    return `
        <div class="lms-prog-wrap">
            <div class="lms-prog-bar">
                <div class="lms-prog-fill" style="width:${val}%"></div>
            </div>
            <span class="lms-prog-label">${val}%</span>
        </div>`;
}

function _fmt_time(sec) {
    if (!sec) return "0d";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}s ${m}d` : `${m}d`;
}

function _fmt_duration(sec) {
    if (!sec) return "0:00";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

function _esc_nl(str) {
    return _esc(str).replace(/\n/g, "<br>");
}
