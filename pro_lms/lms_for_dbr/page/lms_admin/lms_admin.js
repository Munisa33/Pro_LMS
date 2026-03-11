// ═══════════════════════════════════════════════════════════════════════════
//  LMS Admin Dashboard  —  World-class Frappe Page
//  Architecture: LMSAdmin (controller) → LMSAdminUI (view) → API calls
// ═══════════════════════════════════════════════════════════════════════════

frappe.pages['lms_admin'].on_page_load = function (wrapper) {
    frappe.ui.make_app_page({
        parent: wrapper,
        title: 'LMS Admin Panel',
        single_column: true
    });
    window.lms_admin = new LMSAdmin(wrapper);
};

// BUG-05: lifecycle hooks for setInterval
frappe.pages['lms_admin'].on_page_show = function () {
    if (window.lms_admin) {
        window.lms_admin._kpiInterval = setInterval(
            () => window.lms_admin._loadKPI(), 30000
        );
    }
};
frappe.pages['lms_admin'].on_page_hide = function () {
    if (window.lms_admin) {
        clearInterval(window.lms_admin._kpiInterval);
        window.lms_admin._kpiInterval = null;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
//  CONTROLLER
// ─────────────────────────────────────────────────────────────────────────────
class LMSAdmin {
    constructor(wrapper) {
        this.wrapper = wrapper;
        this.activeTab = 'assignments';
        this.filters = { program: '', course: '', employee: '', status: 'Pending' };
        this.pages = { assignments: 1, progress: 1 };
        this.pageSize = 15;
        this.filterOptions = {};
        this.selectedIds = new Set();

        this._renderShell();
        this._loadFilterOptions();
        this._loadKPI();
        this._loadActiveTab();
    }

    // ── Asosiy qobiq ──────────────────────────────────────────────────────
    _renderShell() {
        const wrap = document.createElement('div');
        wrap.className = 'lms-admin-wrap';

        const kpiGrid = document.createElement('div');
        kpiGrid.className = 'lms-kpi-grid';
        kpiGrid.id = 'lms-kpi-grid';
        for (let i = 0; i < 4; i++) {
            const card = document.createElement('div');
            card.className = 'lms-kpi-card';
            card.innerHTML = '<div class="lms-kpi-label">yuklanmoqda...</div>'
                + '<div class="lms-kpi-value"><span class="lms-spinner"></span></div>';
            kpiGrid.appendChild(card);
        }

        const tabs = document.createElement('div');
        tabs.className = 'lms-tabs';
        tabs.innerHTML = '<button class="lms-tab-btn active" data-tab="assignments">Topshiriqlar</button>'
            + '<button class="lms-tab-btn" data-tab="progress">Hodimlar Progressi</button>'
            + '<button class="lms-tab-btn" data-tab="profile">Hodim Profili</button>';

        const filterBar = document.createElement('div');
        filterBar.className = 'lms-filter-bar';
        filterBar.id = 'lms-filter-bar';

        const bulkBar = document.createElement('div');
        bulkBar.id = 'lms-bulk-bar';
        bulkBar.style.cssText = 'display:none;margin-bottom:12px;background:#FFF3E0;'
            + 'border-radius:8px;padding:10px 16px;gap:12px;align-items:center;';
        bulkBar.innerHTML = '<span id="lms-bulk-count" style="font-size:13px;font-weight:600;">0 ta tanlandi</span>'
            + '<button class="lms-btn lms-btn-bulk lms-btn-sm" id="lms-bulk-approve-btn">Ommaviy tasdiqlash</button>'
            + '<button class="lms-btn lms-btn-sm" style="background:#eee;" id="lms-bulk-cancel-btn">Bekor qilish</button>';

        const content = document.createElement('div');
        content.id = 'lms-content';
        content.innerHTML = '<div class="lms-empty"><span class="lms-spinner"></span></div>';

        const pagination = document.createElement('div');
        pagination.className = 'lms-pagination';
        pagination.id = 'lms-pagination';

        wrap.appendChild(kpiGrid);
        wrap.appendChild(tabs);
        wrap.appendChild(filterBar);
        wrap.appendChild(bulkBar);
        wrap.appendChild(content);
        wrap.appendChild(pagination);

        $(this.wrapper).find('.layout-main-section').empty().append(wrap);

        window.lms_admin = this;
        this._bindTabButtons();

        document.getElementById('lms-bulk-approve-btn')
            .addEventListener('click', () => this.bulkApprove());
        document.getElementById('lms-bulk-cancel-btn')
            .addEventListener('click', () => this.clearSelection());
    }

    // ── KPI ───────────────────────────────────────────────────────────────
    _kpiSkeletonCard(label, sub, cls) {
        cls = cls || '';
        return '<div class="lms-kpi-card ' + cls + '">' +
               '<div class="lms-kpi-label">' + label + '</div>' +
               '<div class="lms-kpi-value"><span class="lms-spinner"></span></div>' +
               '<div class="lms-kpi-sub">' + sub + '</div>' +
               '</div>';
    }

    _loadKPI() {
        // Loading animatsiyasi — data kelgunga qadar
        document.getElementById('lms-kpi-grid').innerHTML =
            this._kpiSkeletonCard('Aktiv o&#39;quvchilar', 'Jami enrollment') +
            this._kpiSkeletonCard('Tugatilgan kurslar', 'is_completed = 1', 'green') +
            this._kpiSkeletonCard('Kutayotgan topshiriqlar', 'Tekshirilishi kerak', 'orange') +
            this._kpiSkeletonCard('O&#39;rtacha Quiz ball', 'Barcha urinishlar', 'purple');

        const f = this.filters;
        frappe.call({
            method: 'pro_lms.lms_for_dbr.page.lms_admin.lms_admin.get_dashboard_kpi',
            args: {
                program: f.program || null,
                course:  f.course  || null,
            },
            callback: (r) => {
                if (!r.message) return;
                const d = r.message;
                document.getElementById('lms-kpi-grid').innerHTML = `
                    <div class="lms-kpi-card">
                        <div class="lms-kpi-label">Aktiv o&#39;quvchilar</div>
                        <div class="lms-kpi-value">${d.total_students}</div>
                        <div class="lms-kpi-sub">Jami enrollment</div>
                    </div>
                    <div class="lms-kpi-card green">
                        <div class="lms-kpi-label">Tugatilgan kurslar</div>
                        <div class="lms-kpi-value">${d.completed_courses}</div>
                        <div class="lms-kpi-sub">Tugatilgan enrollment soni</div>
                    </div>
                    <div class="lms-kpi-card orange">
                        <div class="lms-kpi-label">Kutayotgan topshiriqlar</div>
                        <div class="lms-kpi-value">${d.pending_assignments}</div>
                        <div class="lms-kpi-sub">Tekshirilishi kerak</div>
                    </div>
                    <div class="lms-kpi-card purple">
                        <div class="lms-kpi-label">O&#39;rtacha Quiz ball</div>
                        <div class="lms-kpi-value">${d.avg_quiz_score}%</div>
                        <div class="lms-kpi-sub">Barcha urinishlar</div>
                    </div>
                `;
            }
        });
    }

    // ── Filter options ─────────────────────────────────────────────────────
    _loadFilterOptions() {
        frappe.call({
            method: 'pro_lms.lms_for_dbr.page.lms_admin.lms_admin.get_filter_options',
            callback: (r) => {
                if (!r.message) return;
                this.filterOptions = r.message;
                this._renderFilters();
            }
        });
    }

    _renderFilters() {
        const { programs = [], courses = [], employees = [] } = this.filterOptions;
        const f = this.filters;

        const progOpts = programs.map(p =>
            `<option value="${p.name}" ${f.program === p.name ? 'selected' : ''}>
                ${p.program_name}
            </option>`).join('');

        const courseOpts = courses
            .filter(c => !f.program || c.program === f.program)
            .map(c =>
                `<option value="${c.name}" ${f.course === c.name ? 'selected' : ''}>
                    ${c.course_name}
                </option>`).join('');

        const empOpts = employees.map(e =>
            `<option value="${e.name}" ${f.employee === e.name ? 'selected' : ''}>
                ${e.employee_name}
            </option>`).join('');

        const statusOpts = ['Pending','Approved','Rejected','All'].map(s =>
            `<option value="${s}" ${f.status === s ? 'selected' : ''}>${s}</option>`
        ).join('');

        let assignStatusFilter = '';
        if (this.activeTab === 'assignments') {
            assignStatusFilter = '<div>' +
                '<label style="font-size:11px;font-weight:600;color:#888;display:block;margin-bottom:3px;">Status</label>' +
                '<select onchange="window.lms_admin.setFilter(\'status\', this.value)">' +
                statusOpts +
                '</select></div>';
        }

        document.getElementById('lms-filter-bar').innerHTML = `
            <div>
                <label style="font-size:11px;font-weight:600;color:#888;
                              display:block;margin-bottom:3px;">Program</label>
                <select onchange="window.lms_admin.setFilter('program', this.value)">
                    <option value="">Barcha Programlar</option>
                    ${progOpts}
                </select>
            </div>
            <div>
                <label style="font-size:11px;font-weight:600;color:#888;
                              display:block;margin-bottom:3px;">Kurs</label>
                <select onchange="window.lms_admin.setFilter('course', this.value)">
                    <option value="">Barcha Kurslar</option>
                    ${courseOpts}
                </select>
            </div>
            <div>
                <label style="font-size:11px;font-weight:600;color:#888;
                              display:block;margin-bottom:3px;">Hodim</label>
                <select onchange="window.lms_admin.setFilter('employee', this.value)">
                    <option value="">Barcha Hodimlar</option>
                    ${empOpts}
                </select>
            </div>
            ${assignStatusFilter}
            <button class="lms-btn lms-btn-primary lms-btn-sm"
                    onclick="window.lms_admin.applyFilters()">
                \uD83D\uDD0D Filtr
            </button>
            <button class="lms-btn lms-btn-sm" style="background:#eee;"
                    onclick="window.lms_admin.resetFilters()">
                \u2715 Tozalash
            </button>
        `;
    }

    setFilter(key, value) {
        this.filters[key] = value;
        if (key === 'program') {
            this.filters.course = '';
            this._renderFilters();
        }
    }

    applyFilters() {
        this.pages[this.activeTab] = 1;
        this.clearSelection();
        this._loadKPI();          // Filtr o'zgarganda KPI ham yangilanadi
        this._loadActiveTab();
    }

    resetFilters() {
        this.filters = { program: '', course: '', employee: '', status: 'Pending' };
        this.pages[this.activeTab] = 1;
        this.clearSelection();
        this._renderFilters();
        this._loadKPI();          // Reset bo'lganda KPI ham yangilanadi
        this._loadActiveTab();
    }

    // ── Tab boshqaruvi ─────────────────────────────────────────────────────
    _bindTabButtons() {
        document.querySelectorAll('.lms-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });
    }

    switchTab(tab) {
        this.activeTab = tab;
        document.querySelectorAll('.lms-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        this.clearSelection();
        this._renderFilters();
        this._loadActiveTab();
    }

    _loadActiveTab() {
        if (this.activeTab === 'assignments') {
            this._loadAssignments();
        } else if (this.activeTab === 'progress') {
            this._loadProgress();
        } else if (this.activeTab === 'profile') {
            this._renderProfileTab();
        }
    }

    // ── ASSIGNMENTS TAB ────────────────────────────────────────────────────
    _loadAssignments() {
        this._setLoading();
        const f = this.filters;
        frappe.call({
            method: 'pro_lms.lms_for_dbr.page.lms_admin.lms_admin.get_assignments',
            args: {
                status:    f.status || 'All',
                program:   f.program,
                course:    f.course,
                employee:  f.employee,
                page:      this.pages.assignments,
                page_size: this.pageSize
            },
            callback: (r) => {
                if (!r.message) return;
                this._renderAssignments(r.message.data, r.message.total);
            }
        });
    }

    _renderAssignments(data, total) {
        const bulkBar = document.getElementById('lms-bulk-bar');
        bulkBar.style.display = 'flex';

        if (!data.length) {
            document.getElementById('lms-content').innerHTML =
                '<div class="lms-empty">\uD83D\uDCED Topshiriq topilmadi.</div>';
            document.getElementById('lms-pagination').innerHTML = '';
            return;
        }

        // LAW-07: no user data in onclick="" — use data-* + addEventListener
        const tableId = 'lms-assign-table-' + Date.now();
        const rows = data.map(s => {
            const eName  = frappe.utils.escape_html(s.employee_name || '');
            const eDept  = frappe.utils.escape_html(s.department || '\u2014');
            const lTitle = frappe.utils.escape_html(s.lesson_title || '');
            const subOn  = frappe.utils.escape_html(s.submitted_on || '');
            const eName2 = frappe.utils.escape_html(s.name || '');

            let fileLink = '<span style="color:#bbb;font-size:12px;">\u2014</span>';
            if (s.submission_type === 'Google Sheets' && s.google_sheets_url) {
                fileLink = `<a href="${frappe.utils.escape_html(s.google_sheets_url)}"
                               target="_blank" rel="noopener noreferrer"
                               style="color:#2196F3;font-size:12px;">\uD83D\uDD17 Google Sheets</a>`;
            } else if (s.attached_file) {
                fileLink = `<a href="${frappe.utils.escape_html(s.attached_file)}"
                               target="_blank" rel="noopener noreferrer"
                               style="color:#2196F3;font-size:12px;">\uD83D\uDCE5 Fayl</a>`;
            }

            const badge   = this._badge(s.status);
            const checked = this.selectedIds.has(s.name) ? 'checked' : '';

            return `
                <tr>
                    <td class="cb-col">
                        <input type="checkbox" ${checked}
                               data-sub-id="${eName2}">
                    </td>
                    <td>
                        <div style="font-weight:700;font-size:13px;">${eName}</div>
                        <div style="color:#888;font-size:11px;">${eDept}</div>
                    </td>
                    <td>
                        <div style="font-size:13px;">${lTitle}</div>
                        <div style="color:#aaa;font-size:11px;">${subOn}</div>
                    </td>
                    <td>${fileLink}</td>
                    <td>${badge}</td>
                    <td>
                        <input class="lms-score-input" id="score-${eName2}"
                               type="number" min="0" max="100"
                               value="${frappe.utils.flt(s.admin_score, 0) || ''}"
                               placeholder="0\u2013100">
                    </td>
                    <td>
                        <input class="lms-feedback-input" id="fb-${eName2}"
                               type="text"
                               value="${frappe.utils.escape_html(s.admin_feedback || '')}"
                               placeholder="Izoh (ixtiyoriy)">
                    </td>
                    <td class="lms-audit-row">
                        <div style="font-size:12px;">${frappe.utils.escape_html(s.reviewed_by || '\u2014')}</div>
                        <div style="font-size:11px;color:#aaa;">${frappe.utils.escape_html(s.reviewed_on || '\u2014')}</div>
                    </td>
                    <td>
                        <div style="display:flex;gap:6px;">
                            <button class="lms-btn lms-btn-success lms-btn-sm"
                                    data-action="approve"
                                    data-sub-id="${eName2}">\u2714</button>
                            <button class="lms-btn lms-btn-danger lms-btn-sm"
                                    data-action="reject"
                                    data-sub-id="${eName2}">\u2715</button>
                        </div>
                    </td>
                </tr>`;
        }).join('');

        document.getElementById('lms-content').innerHTML = `
            <div class="lms-table-wrap">
                <table class="lms-table" id="${tableId}">
                    <thead>
                        <tr>
                            <th class="cb-col">
                                <input type="checkbox" id="lms-select-all">
                            </th>
                            <th>Hodim</th>
                            <th>Dars / Sana</th>
                            <th>Fayl</th>
                            <th>Status</th>
                            <th>Ball</th>
                            <th>Izoh</th>
                            <th>Tasdiqlagan</th>
                            <th>Amal</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;

        // LAW-07: bind all interactions via addEventListener (never onclick attr)
        document.getElementById('lms-select-all')
            ?.addEventListener('change', (e) => this.selectAll(e.target.checked));

        document.querySelectorAll('input[data-sub-id]').forEach(cb => {
            cb.addEventListener('change', (e) => {
                this.toggleSelect(cb.dataset.subId, e.target.checked);
            });
        });

        document.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const sid    = btn.dataset.subId;
                const action = btn.dataset.action;
                this.review(sid, action === 'approve' ? 'Approved' : 'Rejected');
            });
        });

        this._renderPagination(total, 'assignments');
    }

    review(submission_id, status) {
        const score    = document.getElementById(`score-${submission_id}`)?.value || 0;
        const feedback = document.getElementById(`fb-${submission_id}`)?.value || '';

        frappe.call({
            method: 'pro_lms.lms_for_dbr.page.lms_admin.lms_admin.review_assignment_admin',
            args: { submission_id, status, score, feedback },
            callback: (r) => {
                frappe.show_alert({
                    message: status === 'Approved' ? '\u2705 Tasdiqlandi' : '\u274C Rad etildi',
                    indicator: status === 'Approved' ? 'green' : 'red'
                }, 3);
                this._loadKPI();
                this._loadAssignments();
            }
        });
    }

    // ── BULK ──────────────────────────────────────────────────────────────
    toggleSelect(id, checked) {
        checked ? this.selectedIds.add(id) : this.selectedIds.delete(id);
        this._updateBulkBar();
    }

    selectAll(checked) {
        document.querySelectorAll('input[data-sub-id]').forEach(cb => {
            cb.checked = checked;
            this.toggleSelect(cb.dataset.subId, checked);
        });
    }

    _updateBulkBar() {
        const bar   = document.getElementById('lms-bulk-bar');
        const count = document.getElementById('lms-bulk-count');
        bar.style.display = this.selectedIds.size ? 'flex' : 'none';
        count.textContent = `${this.selectedIds.size} ta tanlandi`;
    }

    clearSelection() {
        this.selectedIds.clear();
        this._updateBulkBar();
    }

    bulkApprove() {
        if (!this.selectedIds.size) return;
        frappe.confirm(
            `${this.selectedIds.size} ta topshiriqni tasdiqlaysizmi?`,
            () => {
                frappe.call({
                    method: 'pro_lms.lms_for_dbr.page.lms_admin.lms_admin.bulk_approve_assignments',
                    args: { submission_ids: JSON.stringify([...this.selectedIds]) },
                    callback: (r) => {
                        frappe.show_alert({
                            message: `\u2705 ${r.message.approved} ta tasdiqlandi`,
                            indicator: 'green'
                        }, 3);
                        this.clearSelection();
                        this._loadKPI();
                        this._loadAssignments();
                    }
                });
            }
        );
    }

    // ── PROGRESS TAB ───────────────────────────────────────────────────────
    _loadProgress() {
        this._setLoading();
        document.getElementById('lms-bulk-bar').style.display = 'none';
        const f = this.filters;
        frappe.call({
            method: 'pro_lms.lms_for_dbr.page.lms_admin.lms_admin.get_employee_progress_list',
            args: {
                program:   f.program,
                course:    f.course,
                employee:  f.employee,
                page:      this.pages.progress,
                page_size: this.pageSize
            },
            callback: (r) => {
                if (!r.message) return;
                this._renderProgress(r.message.data, r.message.total);
            }
        });
    }

    _renderProgress(data, total) {
        if (!data.length) {
            document.getElementById('lms-content').innerHTML =
                '<div class="lms-empty">\uD83D\uDCED Hodim topilmadi.</div>';
            document.getElementById('lms-pagination').innerHTML = '';
            return;
        }

        const rows = data.map(e => {
            const pct   = e.avg_progress;
            const color = pct >= 75 ? 'green' : pct >= 40 ? '' : 'orange';
            const qColor = e.avg_quiz_score >= 70 ? '#43A047' : '#e53935';

            return `
                <tr>
                    <td>
                        <div style="font-weight:700;">${e.employee_name}</div>
                        <div style="color:#888;font-size:11px;">${e.employee}</div>
                    </td>
                    <td style="color:#666;">${e.department}</td>
                    <td style="text-align:center;">${e.enrolled_courses}</td>
                    <td>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <div class="lms-prog-bar" style="flex:1;">
                                <div class="lms-prog-fill ${color}"
                                     style="width:${Math.min(pct,100)}%"></div>
                            </div>
                            <span style="font-size:12px;min-width:36px;">${pct}%</span>
                        </div>
                        <div style="font-size:11px;color:#aaa;">
                            ${e.completed_lessons}/${e.total_lessons} dars
                        </div>
                    </td>
                    <td style="text-align:center;">
                        <span style="font-weight:700;color:${qColor};">
                            ${e.avg_quiz_score}%
                        </span>
                        <div style="font-size:11px;color:#aaa;">
                            ${e.quiz_passed} o&#39;tdi
                        </div>
                    </td>
                    <td style="text-align:center;">
                        ${e.pending_assign > 0
                            ? '<span class="lms-badge lms-badge-pending">' + e.pending_assign + ' kutmoqda</span>'
                            : '<span style="color:#43A047;font-size:16px;">\u2713</span>'
                        }
                        ${e.approved_assign > 0
                            ? '<span class="lms-badge lms-badge-approved" style="margin-left:4px;">' + e.approved_assign + '\u2714</span>'
                            : ''
                        }
                    </td>
                </tr>`;
        }).join('');

        document.getElementById('lms-content').innerHTML = `
            <div class="lms-table-wrap">
                <table class="lms-table">
                    <thead>
                        <tr>
                            <th>Hodim</th>
                            <th>Bo&#39;lim</th>
                            <th style="text-align:center;">Kurslar</th>
                            <th>Progress</th>
                            <th style="text-align:center;">Quiz</th>
                            <th style="text-align:center;">Topshiriqlar</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;

        this._renderPagination(total, 'progress');
    }

    // ── Pagination ─────────────────────────────────────────────────────────
    _renderPagination(total, tab) {
        const totalPages = Math.ceil(total / this.pageSize);
        const current    = this.pages[tab];
        if (totalPages <= 1) {
            document.getElementById('lms-pagination').innerHTML =
                `<span class="lms-page-info">Jami: ${total} ta</span>`;
            return;
        }

        let btns = '';
        for (let i = 1; i <= totalPages; i++) {
            btns += `<button class="lms-page-btn ${i === current ? 'active' : ''}"
                             onclick="window.lms_admin.goPage(${i}, '${tab}')">
                         ${i}
                     </button>`;
        }

        document.getElementById('lms-pagination').innerHTML = `
            <span class="lms-page-info">Jami: ${total} ta</span>
            ${btns}
        `;
    }

    goPage(page, tab) {
        this.pages[tab] = page;
        this._loadActiveTab();
    }

    // ── Yordamchilar ───────────────────────────────────────────────────────
    _setLoading() {
        document.getElementById('lms-content').innerHTML =
            '<div class="lms-empty"><span class="lms-spinner"></span> Yuklanmoqda\u2026</div>';
        document.getElementById('lms-pagination').innerHTML = '';
    }

    _badge(status) {
        const map = {
            'Pending':  'lms-badge-pending',
            'Approved': 'lms-badge-approved',
            'Rejected': 'lms-badge-rejected',
        };
        return `<span class="lms-badge ${map[status] || ''}">${frappe.utils.escape_html(status || '')}</span>`;
    }

    // ════════════════════════════════════════════════════════════════════
    //  TAB 3 — HODIM PROFILI
    // ════════════════════════════════════════════════════════════════════

    _renderProfileTab() {
        document.getElementById('lms-bulk-bar').style.display = 'none';
        document.getElementById('lms-pagination').innerHTML = '';
        document.getElementById('lms-filter-bar').innerHTML = '';

        document.getElementById('lms-content').innerHTML = `
            <div class="lms-profile-selector" id="lms-profile-selector">
                <label class="lms-profile-selector-label">Hodimni tanlang</label>
                <div id="lms-profile-emp-ctrl"></div>
            </div>
            <div id="lms-profile-body"></div>`;

        // Frappe Link control — LAW-07 compliant
        const ctrlEl = document.getElementById('lms-profile-emp-ctrl');
        const ctrl   = frappe.ui.form.make_control({
            df: {
                fieldtype:   'Link',
                fieldname:   'profile_employee',
                options:     'Employee',
                label:       'Hodim',
                only_select: true,
            },
            parent:       ctrlEl,
            render_input: true,
        });
        ctrl.refresh();

        // When value changes — load profile
        ctrl.$input.on('change', () => {
            const val = ctrl.get_value();
            if (val) this.loadProfile(val);
        });
    }

    loadProfile(employee) {
        if (!employee) return;
        this._renderProfileSkeleton();

        frappe.call({
            method: 'pro_lms.lms_for_dbr.page.lms_admin.lms_admin.get_employee_full_profile',
            args:   { employee },
            callback: (r) => {
                if (!r.message || !r.message.employee_info) {
                    document.getElementById('lms-profile-body').innerHTML =
                        '<div class="lms-empty">Hodim topilmadi yoki ma\'lumot yo\'q.</div>';
                    return;
                }
                this._renderProfile(r.message);
            },
            error: () => {
                document.getElementById('lms-profile-body').innerHTML =
                    '<div class="lms-empty">Xatolik yuz berdi. Qayta urinib ko\'ring.</div>';
            },
        });
    }

    _renderProfileSkeleton() {
        const sk = (lines = 3) => Array.from({length: lines}, () =>
            '<div class="lms-skeleton lms-skeleton-line"></div>'
        ).join('');

        document.getElementById('lms-profile-body').innerHTML = `
            <div class="lms-profile-header lms-skeleton-block">
                <div class="lms-skeleton lms-skeleton-avatar"></div>
                <div style="flex:1">${sk(3)}</div>
            </div>
            <div class="lms-skeleton-block">${sk(4)}</div>
            <div class="lms-skeleton-block">${sk(6)}</div>`;
    }

    _summaryCard(label, val, cls) {
        cls = cls || '';
        return '<div class="lms-kpi-card ' + cls + '" style="min-width:120px;">' +
               '<div class="lms-kpi-label">' + label + '</div>' +
               '<div class="lms-kpi-value">' + val + '</div>' +
               '</div>';
    }

    _renderProfile(data) {
        const { employee_info: ei, summary: sm, courses,
                quiz_details, time_analytics: ta } = data;

        // ── Header ────────────────────────────────────────────────────────
        const imgSrc  = ei.image
            ? frappe.utils.escape_html(ei.image)
            : '/assets/frappe/images/default-avatar.png';
        const eName   = frappe.utils.escape_html(ei.employee_name || ei.name);
        const eDept   = frappe.utils.escape_html(ei.department || '');
        const eDesig  = frappe.utils.escape_html(ei.designation || '');

        const headerHtml = `
            <div class="lms-profile-header">
                <img src="${imgSrc}" alt="" class="lms-profile-avatar"
                     onerror="this.src='/assets/frappe/images/default-avatar.png'">
                <div class="lms-profile-meta">
                    <div class="lms-profile-name">${eName}</div>
                    <div class="lms-profile-sub">${eDept}${eDesig ? ' \u00B7 ' + eDesig : ''}</div>
                    <div class="lms-profile-id" style="font-size:11px;color:#aaa;">
                        ${frappe.utils.escape_html(ei.name)}
                    </div>
                </div>
            </div>`;

        // ── Summary cards ─────────────────────────────────────────────────
        const summaryCards =
            this._summaryCard('Kurslar',         sm.completed_courses + '/' + sm.total_courses, '') +
            this._summaryCard('Tomosha vaqti',   sm.total_watch_hours + 's', 'green') +
            this._summaryCard('O&#39;rtacha quiz', sm.avg_quiz_score + '%', 'purple') +
            this._summaryCard('Tasdiqlangan',    sm.approved_assignments + '/' + sm.total_assignments, 'green') +
            this._summaryCard('Kutmoqda',        sm.pending_assignments, sm.pending_assignments > 0 ? 'orange' : '') +
            this._summaryCard('Sertifikatlar',   sm.certificates_count, '');

        const summaryHtml = `<div class="lms-kpi-grid" style="margin-bottom:24px;">${summaryCards}</div>`;

        // ── Time chart ────────────────────────────────────────────────────
        const chartHtml = `
            <div class="lms-section-title">📈 Vaqt analitikasi
                <span class="lms-source-tag">${frappe.utils.escape_html(ta.data_source)}</span>
            </div>
            <div class="lms-chart-wrap" id="lms-monthly-chart"></div>`;

        // ── Courses accordion ─────────────────────────────────────────────
        const coursesHtml = this._renderCoursesAccordion(courses, quiz_details);

        // ── Assignment audit table ────────────────────────────────────────
        const allAssignments = [];
        (courses || []).forEach(c => {
            (c.lessons || []).forEach(l => {
                if (l.assignment) {
                    allAssignments.push({...l.assignment,
                        lesson_title: frappe.utils.escape_html(l.lesson_title || '')});
                }
            });
        });
        const auditHtml = this._renderAssignmentAuditTable(allAssignments);

        document.getElementById('lms-profile-body').innerHTML =
            headerHtml + summaryHtml + chartHtml + coursesHtml + auditHtml;

        // Render SVG chart after DOM is ready
        this._renderTimeChart(ta.monthly, 'lms-monthly-chart');
    }

    _renderCoursesAccordion(courses, quiz_details) {
        if (!courses || !courses.length) {
            return '<div class="lms-empty">Kurslar topilmadi.</div>';
        }

        // Build quiz_details index by lesson
        const quizDetailByLesson = {};
        (quiz_details || []).forEach(qd => {
            quizDetailByLesson[qd.lesson] = qd;
        });

        const items = courses.map((c, idx) => {
            const cName  = frappe.utils.escape_html(c.course_name || c.course);
            const pct    = frappe.utils.flt(c.progress_pct, 1);
            const status = frappe.utils.escape_html(c.enrollment_status || '');
            const pColor = pct >= 75 ? '#43A047' : pct >= 40 ? '#FB8C00' : '#E53935';

            const lessonRows = (c.lessons || []).map(l => {
                const lTitle  = frappe.utils.escape_html(l.lesson_title || '');
                const watchM  = Math.round((l.watch_time_sec || 0) / 60);
                const compPct = frappe.utils.flt(l.completion_percent, 0);
                const icon    = l.is_completed ? '\u2705' : '\u23F3';

                // Quiz summary inline
                let quizBadge = '';
                if (l.quiz_summary) {
                    const qs = l.quiz_summary;
                    const qIcon = qs.passed ? '\u2705' : '\u274C';
                    const qCls = qs.passed ? 'lms-badge-approved' : 'lms-badge-rejected';
                    quizBadge = '<span class="lms-badge ' + qCls + '" style="font-size:11px;margin-left:6px;">' +
                        'Quiz ' + qIcon + ' ' + qs.best_percentage + '% (' + qs.total_attempts + 'x)' +
                        '</span>';
                }

                // Assignment inline
                let asgBadge = '';
                if (l.assignment) {
                    const a = l.assignment;
                    let aCls = 'lms-badge-pending';
                    if (a.status === 'Approved') aCls = 'lms-badge-approved';
                    else if (a.status === 'Rejected') aCls = 'lms-badge-rejected';
                    asgBadge = '<span class="lms-badge ' + aCls + '" style="font-size:11px;margin-left:6px;">' +
                        '📎 ' + frappe.utils.escape_html(a.status) +
                        '</span>';
                }

                return `<tr>
                    <td>${icon} ${lTitle}${quizBadge}${asgBadge}</td>
                    <td style="text-align:center;">${watchM} daq</td>
                    <td style="text-align:center;">${compPct}%</td>
                    <td style="text-align:center;color:#aaa;font-size:11px;">
                        ${frappe.utils.escape_html(l.completed_on || '\u2014')}
                    </td>
                </tr>`;
            }).join('');

            // Quiz details for this course
            let quizDetailHtml = '';
            (c.lessons || []).forEach(l => {
                const qd = quizDetailByLesson[l.lesson];
                if (!qd) return;
                quizDetailHtml += this._renderQuizDetail(qd);
            });

            return `
                <details class="lms-accordion" ${idx === 0 ? 'open' : ''}>
                    <summary class="lms-accordion-summary">
                        <span class="lms-accordion-title">${cName}</span>
                        <span class="lms-badge" style="margin-left:8px;background:#e8f5e9;color:#2e7d32;">
                            ${status}
                        </span>
                        <span style="margin-left:auto;font-size:13px;color:${pColor};font-weight:700;">
                            ${pct}%
                        </span>
                        <span style="font-size:11px;color:#aaa;margin-left:8px;">
                            ${c.completed_lessons}/${c.total_lessons} dars
                        </span>
                    </summary>
                    <div class="lms-accordion-body">
                        <table class="lms-table" style="margin-bottom:12px;">
                            <thead>
                                <tr>
                                    <th>Dars</th>
                                    <th style="text-align:center;">Vaqt</th>
                                    <th style="text-align:center;">%</th>
                                    <th style="text-align:center;">Tugatildi</th>
                                </tr>
                            </thead>
                            <tbody>${lessonRows || '<tr><td colspan="4" class="lms-empty">Darslar yo\'q</td></tr>'}</tbody>
                        </table>
                        ${quizDetailHtml}
                    </div>
                </details>`;
        }).join('');

        return `<div class="lms-section-title">📚 Kurslar</div>${items}`;
    }

    _renderQuizDetail(qd) {
        if (!qd || !qd.attempts || !qd.attempts.length) return '';
        const qName    = frappe.utils.escape_html(qd.quiz_name || qd.quiz);
        const lTitle   = frappe.utils.escape_html(qd.lesson_title || '');
        const passScore = frappe.utils.flt(qd.passing_score, 0);

        // Show all attempts; questions shown on last attempt
        const lastAttempt = qd.attempts[qd.attempts.length - 1];

        const attemptsHtml = qd.attempts.map((att, i) => {
            const isLast   = (i === qd.attempts.length - 1);
            const passIcon = att.passed ? '\u2705' : '\u274C';
            const pctColor = att.passed ? '#43A047' : '#E53935';

            let questionsHtml = '';
            if (isLast && att.questions && att.questions.length) {
                questionsHtml = att.questions.map(q => {
                    const cls  = q.is_correct ? 'lms-quiz-correct' : 'lms-quiz-wrong';
                    const icon = q.is_correct ? '\u2705' : '\u274C';
                    const correctAnsHtml = q.is_correct ? '' :
                        '<div class="lms-quiz-correct-ans">' +
                        '<span style="font-weight:600;">To&#39;g&#39;ri:</span> ' +
                        frappe.utils.escape_html(q.correct_answer_text || '\u2014') +
                        '</div>';
                    return '<div class="' + cls + '">' +
                        '<div class="lms-quiz-q">' + frappe.utils.escape_html(q.question_text || '') + '</div>' +
                        '<div class="lms-quiz-ans">' +
                        '<span style="font-weight:600;">Javob:</span> ' +
                        frappe.utils.escape_html(q.employee_answer_text || '\u2014') +
                        ' ' + icon +
                        '</div>' +
                        correctAnsHtml +
                        '</div>';
                }).join('');
            }

            return `
                <div style="margin-bottom:8px;padding:8px;background:#fafafa;
                            border-radius:6px;border:1px solid #eee;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                        <span style="font-size:12px;font-weight:600;">#${att.attempt_number}</span>
                        <span style="font-size:13px;font-weight:700;color:${pctColor};">
                            ${frappe.utils.flt(att.percentage, 1)}%
                        </span>
                        <span>${passIcon}</span>
                        <span style="font-size:11px;color:#aaa;margin-left:auto;">
                            ${frappe.utils.escape_html(att.attempted_on || '')}
                        </span>
                    </div>
                    ${isLast ? questionsHtml : ''}
                </div>`;
        }).join('');

        return `
            <div style="margin-bottom:16px;">
                <div style="font-weight:700;font-size:13px;margin-bottom:6px;">
                    🧠 ${qName}
                    <span style="font-size:11px;color:#aaa;font-weight:400;">
                        (O&#39;tish bali: ${passScore}%) \u00B7 ${lTitle}
                    </span>
                </div>
                ${attemptsHtml}
            </div>`;
    }

    _renderAssignmentAuditTable(assignments) {
        if (!assignments || !assignments.length) return '';

        const rows = assignments.map(a => {
            let fileCell = '\u2014';
            if (a.submission_type === 'Google Sheets' && a.google_sheets_url) {
                fileCell = '<a href="' + frappe.utils.escape_html(a.google_sheets_url) + '"' +
                    ' target="_blank" rel="noopener noreferrer"' +
                    ' style="color:#2196F3;font-size:12px;">\uD83D\uDD17 Google Sheets</a>';
            } else if (a.attached_file) {
                fileCell = '<a href="' + frappe.utils.escape_html(a.attached_file) + '"' +
                    ' target="_blank" rel="noopener noreferrer"' +
                    ' style="color:#2196F3;font-size:12px;">\uD83D\uDCE5 Fayl</a>';
            }

            return `<tr class="lms-audit-row">
                <td>${a.lesson_title}</td>
                <td>${frappe.utils.escape_html(a.submission_type || '\u2014')}</td>
                <td>${fileCell}</td>
                <td>${this._badge(a.status)}</td>
                <td style="text-align:center;">
                    ${a.admin_score !== null && a.admin_score !== undefined
                        ? frappe.utils.flt(a.admin_score, 1)
                        : '\u2014'}
                </td>
                <td>${frappe.utils.escape_html(a.reviewed_by || '\u2014')}</td>
                <td style="color:#aaa;font-size:11px;">
                    ${frappe.utils.escape_html(a.reviewed_on || '\u2014')}
                </td>
            </tr>`;
        }).join('');

        return `
            <div class="lms-section-title">📎 Topshiriqlar audit</div>
            <div class="lms-table-wrap">
                <table class="lms-table">
                    <thead>
                        <tr>
                            <th>Dars</th>
                            <th>Topshiriq turi</th>
                            <th>Fayl</th>
                            <th>Status</th>
                            <th>Ball</th>
                            <th>Tasdiqlagan</th>
                            <th>Tasdiqlangan vaqt</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    }

    _renderTimeChart(monthlyData, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (!monthlyData || !monthlyData.length) {
            container.innerHTML = '<div class="lms-empty">Vaqt ma\'lumoti yo\'q.</div>';
            return;
        }

        const W         = 600;
        const H         = 200;
        const padL      = 40;
        const padB      = 40;
        const padT      = 10;
        const padR      = 10;
        const chartW    = W - padL - padR;
        const chartH    = H - padT - padB;
        const maxHours  = Math.max(...monthlyData.map(d => frappe.utils.flt(d.hours)), 0.1);
        const barCount  = monthlyData.length;
        const barSlot   = chartW / barCount;
        const barW      = barSlot * 0.7;
        const COLOR     = '#5C6BC0';

        let bars = '';
        let xLabels = '';

        monthlyData.forEach((d, i) => {
            const hrs    = frappe.utils.flt(d.hours);
            const bH     = (hrs / maxHours) * chartH;
            const x      = padL + i * barSlot + (barSlot - barW) / 2;
            const y      = padT + chartH - bH;
            const mo     = frappe.utils.escape_html(String(d.month || '').slice(5));  // "MM"
            const labelX = padL + i * barSlot + barSlot / 2;

            bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}"
                           width="${barW.toFixed(1)}" height="${Math.max(bH, 1).toFixed(1)}"
                           fill="${COLOR}" rx="2" ry="2">
                         <title>${frappe.utils.escape_html(d.month)}: ${hrs}s</title>
                     </rect>`;

            xLabels += `<text x="${labelX.toFixed(1)}" y="${(H - padB + 14).toFixed(1)}"
                              text-anchor="middle" font-size="10" fill="#888">${mo}</text>`;
        });

        // Y-axis gridlines
        let grid = '';
        for (let g = 0; g <= 4; g++) {
            const gY    = padT + chartH - (g / 4) * chartH;
            const gVal  = frappe.utils.flt((maxHours * g / 4), 1);
            grid += `<line x1="${padL}" y1="${gY.toFixed(1)}"
                           x2="${W - padR}" y2="${gY.toFixed(1)}"
                           stroke="#eee" stroke-width="1"/>
                     <text x="${(padL - 4).toFixed(1)}" y="${(gY + 4).toFixed(1)}"
                           text-anchor="end" font-size="9" fill="#aaa">${gVal}</text>`;
        }

        const svgHtml = `
            <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"
                 style="width:100%;height:auto;display:block;">
                ${grid}
                <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + chartH}"
                      stroke="#ccc" stroke-width="1"/>
                <line x1="${padL}" y1="${padT + chartH}" x2="${W - padR}" y2="${padT + chartH}"
                      stroke="#ccc" stroke-width="1"/>
                ${bars}
                ${xLabels}
                <text x="${W / 2}" y="${H}" text-anchor="middle"
                      font-size="11" fill="#999">Oy (soat)</text>
            </svg>`;

        container.innerHTML = svgHtml;
    }
}
