// ═══════════════════════════════════════════════════════════════════════════
//  LMS Admin Dashboard  —  World-class Frappe Page
//  Fixes applied:
//    1. Full-width: aggressive Frappe layout override on page load
//    2. Dark mode: toggle button synced with Frappe's html[data-theme]
//    3. Bulk bar: only shown when items are SELECTED (not when data exists)
// ═══════════════════════════════════════════════════════════════════════════

frappe.pages['lms_admin'].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: 'LMS Admin Panel',
		single_column: true
	});

	// ── FIX 1: Force full-width immediately on page load ──────────────────
	_forceFullWidth();

	window.lms_admin = new LMSAdmin(wrapper);
};

frappe.pages['lms_admin'].on_page_show = function () {
	// Re-apply full-width in case Frappe re-renders layout on show
	_forceFullWidth();

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

// ── Full-width helper ─────────────────────────────────────────────────────
function _forceFullWidth() {
	const selectors = [
		'.page-content',
		'.page-content .container',
		'.page-content .page-container',
		'.page-content .layout-main',
		'.page-content .layout-main-section-wrapper',
		'.page-content .layout-main-section',
		'.layout-main',
	];
	selectors.forEach(sel => {
		document.querySelectorAll(sel).forEach(el => {
			el.style.maxWidth  = '100%';
			el.style.width     = '100%';
			el.style.paddingLeft  = '0';
			el.style.paddingRight = '0';
			el.style.marginLeft   = '0';
			el.style.marginRight  = '0';
		});
	});
}

// ── Dark mode helpers ─────────────────────────────────────────────────────
function _getCurrentTheme() {
	return document.documentElement.getAttribute('data-theme')
		|| document.documentElement.getAttribute('data-bs-theme')
		|| 'light';
}

function _setTheme(theme) {
	// Set on html element — Frappe standard
	document.documentElement.setAttribute('data-theme', theme);
	document.documentElement.setAttribute('data-bs-theme', theme);
	// Persist user preference
	localStorage.setItem('lms_admin_theme', theme);
}

function _initTheme() {
	// Priority: 1) Frappe's current setting, 2) localStorage, 3) system preference
	const frappeCurrent = _getCurrentTheme();
	if (frappeCurrent && frappeCurrent !== 'light') return; // Frappe already set dark

	const saved = localStorage.getItem('lms_admin_theme');
	if (saved) {
		_setTheme(saved);
		return;
	}
	// System preference
	if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
		_setTheme('dark');
	}
}

// ─────────────────────────────────────────────────────────────────────────────
//  CONTROLLER
// ─────────────────────────────────────────────────────────────────────────────
class LMSAdmin {
	constructor(wrapper) {
		this.wrapper    = wrapper;
		this.activeTab  = 'assignments';
		this.filters    = { program: '', course: '', employee: '', status: 'Pending' };
		this.pages      = { assignments: 1, progress: 1, open_answers: 1 };
		this.pageSize   = 15;
		this.filterOptions = {};
		this.selectedIds   = new Set();
		this._oaStatus  = 'Pending';
		this._currentProfileEmployee = null;

		_initTheme();
		this._renderShell();
		this._loadFilterOptions();
		this._loadKPI();
		this._loadActiveTab();
	}

	// ── Asosiy qobiq ─────────────────────────────────────────────────────
	_renderShell() {
		const wrap = document.createElement('div');
		wrap.className = 'lms-admin-wrap';

		// ── Dark mode toggle button ────────────────────────────────────────
		const topBar = document.createElement('div');
		topBar.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:12px;gap:8px;align-items:center;';

		const themeBtn = document.createElement('button');
		themeBtn.id = 'lms-theme-toggle';
		themeBtn.className = 'lms-btn lms-btn-sm lms-btn-secondary';
		themeBtn.style.cssText = 'min-width:42px;font-size:16px;padding:5px 10px;';
		themeBtn.title = 'Dark / Light mode';
		const isDark = _getCurrentTheme() === 'dark';
		themeBtn.textContent = isDark ? '☀️' : '🌙';

		themeBtn.addEventListener('click', () => {
			const current = _getCurrentTheme();
			const next    = current === 'dark' ? 'light' : 'dark';
			_setTheme(next);
			themeBtn.textContent = next === 'dark' ? '☀️' : '🌙';
			// Redraw SVG chart if profile is active (colors change)
			if (this.activeTab === 'profile' && this._currentProfileEmployee) {
				// Chart is inside profile body — re-render chart only
				const chartEl = document.getElementById('lms-monthly-chart');
				if (chartEl && this._lastTimeAnalytics) {
					this._renderTimeChart(this._lastTimeAnalytics, 'lms-monthly-chart');
				}
			}
		});

		topBar.appendChild(themeBtn);
		wrap.appendChild(topBar);

		// ── KPI skeleton ───────────────────────────────────────────────────
		const kpiGrid = document.createElement('div');
		kpiGrid.className = 'lms-kpi-grid';
		kpiGrid.id = 'lms-kpi-grid';
		for (let i = 0; i < 5; i++) {
			const card = document.createElement('div');
			card.className = 'lms-kpi-card';
			card.innerHTML = '<div class="lms-kpi-label">yuklanmoqda...</div>'
				+ '<div class="lms-kpi-value"><span class="lms-spinner"></span></div>';
			kpiGrid.appendChild(card);
		}

		// ── Tabs ───────────────────────────────────────────────────────────
		const tabs = document.createElement('div');
		tabs.className = 'lms-tabs';
		tabs.innerHTML =
			'<button class="lms-tab-btn active" data-tab="assignments">📋 Topshiriqlar</button>'
			+ '<button class="lms-tab-btn" data-tab="progress">📊 Hodimlar Progressi</button>'
			+ '<button class="lms-tab-btn" data-tab="profile">👤 Hodim Profili</button>'
			+ '<button class="lms-tab-btn" data-tab="open_answers">✍️ Ochiq Savollar</button>';

		// ── Filter bar ────────────────────────────────────────────────────
		const filterBar = document.createElement('div');
		filterBar.className = 'lms-filter-bar';
		filterBar.id = 'lms-filter-bar';

		// ── FIX 3: Bulk bar — hidden by default, only shown when selectedIds > 0
		const bulkBar = document.createElement('div');
		bulkBar.id = 'lms-bulk-bar';
		// Do NOT use style.display here — CSS handles initial display:none
		bulkBar.innerHTML =
			'<span id="lms-bulk-count" style="font-size:13px;font-weight:600;color:var(--lms-text-primary);">0 ta tanlandi</span>'
			+ '<button class="lms-btn lms-btn-bulk lms-btn-sm" id="lms-bulk-approve-btn">✔ Ommaviy tasdiqlash</button>'
			+ '<button class="lms-btn lms-btn-sm lms-btn-secondary" id="lms-bulk-cancel-btn">✕ Bekor qilish</button>';

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

		// Re-apply full-width after DOM insertion
		_forceFullWidth();

		window.lms_admin = this;
		this._bindTabButtons();

		document.getElementById('lms-bulk-approve-btn')
			.addEventListener('click', () => this.bulkApprove());
		document.getElementById('lms-bulk-cancel-btn')
			.addEventListener('click', () => this.clearSelection());
	}

	// ── KPI ─────────────────────────────────────────────────────────────
	_kpiSkeletonCard(label, sub, cls) {
		cls = cls || '';
		return '<div class="lms-kpi-card ' + cls + '">'
			+ '<div class="lms-kpi-label">' + label + '</div>'
			+ '<div class="lms-kpi-value"><span class="lms-spinner"></span></div>'
			+ '<div class="lms-kpi-sub">' + sub + '</div>'
			+ '</div>';
	}

	_loadKPI() {
		document.getElementById('lms-kpi-grid').innerHTML =
			this._kpiSkeletonCard('Aktiv o&#39;quvchilar',       'Jami enrollment') +
			this._kpiSkeletonCard('Tugatilgan kurslar',          'is_completed = 1',      'green') +
			this._kpiSkeletonCard('Kutayotgan topshiriqlar',     'Tekshirilishi kerak',    'orange') +
			this._kpiSkeletonCard('O&#39;rtacha Quiz ball',      'Barcha urinishlar',      'purple') +
			this._kpiSkeletonCard('Baholanmagan ochiq savollar', 'Javob kutmoqda',         'red');

		const f = this.filters;
		frappe.call({
			method: 'pro_lms.lms_for_dbr.page.lms_admin.lms_admin.get_dashboard_kpi',
			args: { program: f.program || null, course: f.course || null },
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
					<div class="lms-kpi-card red">
						<div class="lms-kpi-label">Baholanmagan ochiq savollar</div>
						<div class="lms-kpi-value">${d.pending_open_answers || 0}</div>
						<div class="lms-kpi-sub">✍️ Javob kutmoqda</div>
					</div>`;
			}
		});
	}

	// ── Filter options ───────────────────────────────────────────────────
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
			`<option value="${p.name}" ${f.program === p.name ? 'selected' : ''}>${frappe.utils.escape_html(p.program_name)}</option>`
		).join('');

		const courseOpts = courses
			.filter(c => !f.program || c.program === f.program)
			.map(c =>
				`<option value="${c.name}" ${f.course === c.name ? 'selected' : ''}>${frappe.utils.escape_html(c.course_name)}</option>`
			).join('');

		const empOpts = employees.map(e =>
			`<option value="${e.name}" ${f.employee === e.name ? 'selected' : ''}>${frappe.utils.escape_html(e.employee_name)}</option>`
		).join('');

		const statusOpts = ['Pending','Approved','Rejected','All'].map(s =>
			`<option value="${s}" ${f.status === s ? 'selected' : ''}>${s}</option>`
		).join('');

		let assignStatusFilter = '';
		if (this.activeTab === 'assignments') {
			assignStatusFilter = '<div>'
				+ '<label>Status</label>'
				+ '<select onchange="window.lms_admin.setFilter(\'status\', this.value)">'
				+ statusOpts
				+ '</select></div>';
		}

		document.getElementById('lms-filter-bar').innerHTML = `
			<div>
				<label>Program</label>
				<select onchange="window.lms_admin.setFilter('program', this.value)">
					<option value="">Barcha Programlar</option>
					${progOpts}
				</select>
			</div>
			<div>
				<label>Kurs</label>
				<select onchange="window.lms_admin.setFilter('course', this.value)">
					<option value="">Barcha Kurslar</option>
					${courseOpts}
				</select>
			</div>
			<div>
				<label>Hodim</label>
				<select onchange="window.lms_admin.setFilter('employee', this.value)">
					<option value="">Barcha Hodimlar</option>
					${empOpts}
				</select>
			</div>
			${assignStatusFilter}
			<button class="lms-btn lms-btn-primary lms-btn-sm" onclick="window.lms_admin.applyFilters()">
				🔍 Filtr
			</button>
			<button class="lms-btn lms-btn-sm lms-btn-secondary" onclick="window.lms_admin.resetFilters()">
				✕ Tozalash
			</button>`;
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
		this._loadKPI();
		this._loadActiveTab();
	}

	resetFilters() {
		this.filters = { program: '', course: '', employee: '', status: 'Pending' };
		this.pages[this.activeTab] = 1;
		this.clearSelection();
		this._renderFilters();
		this._loadKPI();
		this._loadActiveTab();
	}

	// ── Tab boshqaruvi ───────────────────────────────────────────────────
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
		} else if (this.activeTab === 'open_answers') {
			this._loadOpenAnswers();
		}
	}

	// ═════════════════════════════════════════════════════════════════════
	//  TAB 1 — TOPSHIRIQLAR
	// ═════════════════════════════════════════════════════════════════════
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
		// ── FIX 3: bulk bar is NEVER shown here — only _updateBulkBar controls it
		// Hide it on fresh render since selection is cleared
		document.getElementById('lms-bulk-bar').style.display = 'none';

		if (!data.length) {
			document.getElementById('lms-content').innerHTML =
				'<div class="lms-empty">📭 Topshiriq topilmadi.</div>';
			document.getElementById('lms-pagination').innerHTML = '';
			return;
		}

		const rows = data.map(s => {
			const eName  = frappe.utils.escape_html(s.employee_name || '');
			const eDept  = frappe.utils.escape_html(s.department || '—');
			const lTitle = frappe.utils.escape_html(s.lesson_title || '');
			const subOn  = frappe.utils.escape_html(s.submitted_on || '');
			const sId    = frappe.utils.escape_html(s.name || '');

			let fileLink = '<span style="color:var(--lms-text-muted);font-size:12px;">—</span>';
			if (s.submission_type === 'Google Sheets' && s.google_sheets_url) {
				fileLink = `<a href="${frappe.utils.escape_html(s.google_sheets_url)}"
					target="_blank" rel="noopener noreferrer">🔗 Google Sheets</a>`;
			} else if (s.attached_file) {
				fileLink = `<a href="${frappe.utils.escape_html(s.attached_file)}"
					target="_blank" rel="noopener noreferrer">📥 Fayl</a>`;
			}

			const badge   = this._badge(s.status);
			const checked = this.selectedIds.has(s.name) ? 'checked' : '';

			return `
				<tr>
					<td class="cb-col">
						<input type="checkbox" ${checked} data-sub-id="${sId}">
					</td>
					<td>
						<div style="font-weight:700;font-size:13px;">${eName}</div>
						<div style="color:var(--lms-text-muted);font-size:11px;">${eDept}</div>
					</td>
					<td>
						<div style="font-size:13px;">${lTitle}</div>
						<div style="color:var(--lms-text-muted);font-size:11px;">${subOn}</div>
					</td>
					<td>${fileLink}</td>
					<td>${badge}</td>
					<td>
						<input class="lms-score-input" id="score-${sId}"
							type="number" min="0" max="100"
							value="${parseFloat(s.admin_score) || ''}"
							placeholder="0–100">
					</td>
					<td>
						<input class="lms-feedback-input" id="fb-${sId}"
							type="text"
							value="${frappe.utils.escape_html(s.admin_feedback || '')}"
							placeholder="Izoh (ixtiyoriy)">
					</td>
					<td class="lms-audit-row">
						<div style="font-size:12px;">${frappe.utils.escape_html(s.reviewed_by || '—')}</div>
						<div style="font-size:11px;color:var(--lms-text-muted);">${frappe.utils.escape_html(s.reviewed_on || '—')}</div>
					</td>
					<td>
						<div style="display:flex;gap:6px;">
							<button class="lms-btn lms-btn-success lms-btn-sm"
								data-action="approve" data-sub-id="${sId}">✔</button>
							<button class="lms-btn lms-btn-danger lms-btn-sm"
								data-action="reject" data-sub-id="${sId}">✕</button>
						</div>
					</td>
				</tr>`;
		}).join('');

		document.getElementById('lms-content').innerHTML = `
			<div class="lms-table-wrap">
				<table class="lms-table">
					<thead>
						<tr>
							<th class="cb-col"><input type="checkbox" id="lms-select-all"></th>
							<th>Hodim</th><th>Dars / Sana</th><th>Fayl</th>
							<th>Status</th><th>Ball</th><th>Izoh</th>
							<th>Tasdiqlagan</th><th>Amal</th>
						</tr>
					</thead>
					<tbody>${rows}</tbody>
				</table>
			</div>`;

		document.getElementById('lms-select-all')
			?.addEventListener('change', (e) => this.selectAll(e.target.checked));

		document.querySelectorAll('input[data-sub-id]').forEach(cb => {
			cb.addEventListener('change', (e) => this.toggleSelect(cb.dataset.subId, e.target.checked));
		});

		document.querySelectorAll('button[data-action]').forEach(btn => {
			btn.addEventListener('click', () => {
				this.review(btn.dataset.subId, btn.dataset.action === 'approve' ? 'Approved' : 'Rejected');
			});
		});

		this._renderPagination(total, 'assignments');
	}

	review(submission_id, status) {
		const score    = document.getElementById(`score-${submission_id}`)?.value || 0;
		const feedback = document.getElementById(`fb-${submission_id}`)?.value || '';

		frappe.call({
			method: 'pro_lms.lms_for_dbr.page.lms_admin.lms_admin.review_assignment_admin',
			args:   { submission_id, status, score, feedback },
			callback: () => {
				frappe.show_alert({
					message:   status === 'Approved' ? '✅ Tasdiqlandi' : '❌ Rad etildi',
					indicator: status === 'Approved' ? 'green' : 'red'
				}, 3);
				this._loadKPI();
				this._loadAssignments();
			}
		});
	}

	// ── Bulk ────────────────────────────────────────────────────────────
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
		// ── FIX 3: ONLY show bulk bar when items are actually selected
		bar.style.display  = this.selectedIds.size > 0 ? 'flex' : 'none';
		count.textContent  = `${this.selectedIds.size} ta tanlandi`;
	}

	clearSelection() {
		this.selectedIds.clear();
		this._updateBulkBar();
	}

	bulkApprove() {
		if (!this.selectedIds.size) return;
		frappe.confirm(`${this.selectedIds.size} ta topshiriqni tasdiqlaysizmi?`, () => {
			frappe.call({
				method: 'pro_lms.lms_for_dbr.page.lms_admin.lms_admin.bulk_approve_assignments',
				args:   { submission_ids: JSON.stringify([...this.selectedIds]) },
				callback: (r) => {
					frappe.show_alert({ message: `✅ ${r.message.approved} ta tasdiqlandi`, indicator: 'green' }, 3);
					this.clearSelection();
					this._loadKPI();
					this._loadAssignments();
				}
			});
		});
	}

	// ═════════════════════════════════════════════════════════════════════
	//  TAB 2 — HODIMLAR PROGRESSI
	// ═════════════════════════════════════════════════════════════════════
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
				'<div class="lms-empty">📭 Hodim topilmadi.</div>';
			document.getElementById('lms-pagination').innerHTML = '';
			return;
		}

		const rows = data.map(e => {
			const pct    = e.avg_progress;
			const color  = pct >= 75 ? 'green' : pct >= 40 ? '' : 'orange';
			const qColor = e.avg_quiz_score >= 70 ? 'var(--lms-green)' : 'var(--lms-red)';

			let oaBadge = '';
			if (e.oa_total > 0) {
				oaBadge = e.oa_pending > 0
					? `<span class="lms-badge lms-badge-pending" style="margin-top:4px;display:inline-block;">${e.oa_pending} ochiq savol kutmoqda</span>`
					: `<span style="color:var(--lms-green);font-size:12px;"> ✓ ${e.oa_graded} baholangan</span>`;
			}

			return `
				<tr>
					<td>
						<div style="font-weight:700;">${frappe.utils.escape_html(e.employee_name)}</div>
						<div style="color:var(--lms-text-muted);font-size:11px;">${frappe.utils.escape_html(e.employee)}</div>
					</td>
					<td style="color:var(--lms-text-secondary);">${frappe.utils.escape_html(e.department)}</td>
					<td style="text-align:center;">${e.enrolled_courses}</td>
					<td>
						<div style="display:flex;align-items:center;gap:8px;">
							<div class="lms-prog-bar" style="flex:1;">
								<div class="lms-prog-fill ${color}" style="width:${Math.min(pct,100)}%"></div>
							</div>
							<span style="font-size:12px;min-width:36px;">${pct}%</span>
						</div>
						<div style="font-size:11px;color:var(--lms-text-muted);">${e.completed_lessons}/${e.total_lessons} dars</div>
					</td>
					<td style="text-align:center;">
						<span style="font-weight:700;color:${qColor};">${e.avg_quiz_score}%</span>
						<div style="font-size:11px;color:var(--lms-text-muted);">${e.quiz_passed} o&#39;tdi</div>
					</td>
					<td style="text-align:center;">
						${e.pending_assign > 0
							? `<span class="lms-badge lms-badge-pending">${e.pending_assign} kutmoqda</span>`
							: '<span style="color:var(--lms-green);font-size:16px;">✓</span>'}
						${e.approved_assign > 0
							? `<span class="lms-badge lms-badge-approved" style="margin-left:4px;">${e.approved_assign}✔</span>`
							: ''}
					</td>
					<td style="text-align:center;">${oaBadge || '—'}</td>
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
							<th style="text-align:center;">Ochiq savollar</th>
						</tr>
					</thead>
					<tbody>${rows}</tbody>
				</table>
			</div>`;

		this._renderPagination(total, 'progress');
	}

	// ═════════════════════════════════════════════════════════════════════
	//  TAB 3 — HODIM PROFILI
	// ═════════════════════════════════════════════════════════════════════
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

		const ctrlEl = document.getElementById('lms-profile-emp-ctrl');
		const ctrl   = frappe.ui.form.make_control({
			df: { fieldtype: 'Link', fieldname: 'profile_employee', options: 'Employee', label: 'Hodim', only_select: true },
			parent:       ctrlEl,
			render_input: true,
		});
		ctrl.refresh();

		// Frappe Link control — 'change' ishlamaydi, to'g'ri eventlar:
		// 1) awesomplete-selectcomplete  — dropdown dan tanlanganda
		// 2) blur                        — manual yozib Enter/tab bosganda
		const _tryLoad = () => {
			setTimeout(() => {
				const val = ctrl.get_value();
				if (val) this.loadProfile(val);
			}, 50);
		};
		ctrl.$input.on('awesomplete-selectcomplete', _tryLoad);
		ctrl.$input.on('blur', _tryLoad);
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
				this._renderProfile(r.message, employee);
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
		return '<div class="lms-kpi-card ' + cls + '" style="min-width:120px;">'
			+ '<div class="lms-kpi-label">' + label + '</div>'
			+ '<div class="lms-kpi-value">' + val + '</div>'
			+ '</div>';
	}

	_renderProfile(data, employee) {
		const { employee_info: ei, summary: sm, courses, quiz_details, time_analytics: ta } = data;
		this._currentProfileEmployee = employee;
		// Cache for theme toggle re-render
		this._lastTimeAnalytics = ta.monthly;

		const imgSrc  = ei.image ? frappe.utils.escape_html(ei.image) : '/assets/frappe/images/default-avatar.png';
		const eName   = frappe.utils.escape_html(ei.employee_name || ei.name);
		const eDept   = frappe.utils.escape_html(ei.department || '');
		const eDesig  = frappe.utils.escape_html(ei.designation || '');

		const headerHtml = `
			<div class="lms-profile-header">
				<img src="${imgSrc}" alt="" class="lms-profile-avatar"
					onerror="this.src='/assets/frappe/images/default-avatar.png'">
				<div class="lms-profile-meta">
					<div class="lms-profile-name">${eName}</div>
					<div class="lms-profile-sub">${eDept}${eDesig ? ' · ' + eDesig : ''}</div>
					<div style="font-size:11px;color:var(--lms-text-muted);">${frappe.utils.escape_html(ei.name)}</div>
				</div>
			</div>`;

		const summaryCards =
			this._summaryCard('Kurslar',            sm.completed_courses + '/' + sm.total_courses) +
			this._summaryCard('Tomosha vaqti',      sm.total_watch_hours + 's',   'green') +
			this._summaryCard('O&#39;rtacha quiz',  sm.avg_quiz_score + '%',      'purple') +
			this._summaryCard('Tasdiqlangan',       sm.approved_assignments + '/' + sm.total_assignments, 'green') +
			this._summaryCard('Kutmoqda (topshiriq)', sm.pending_assignments,      sm.pending_assignments > 0 ? 'orange' : '') +
			this._summaryCard('Sertifikatlar',      sm.certificates_count);

		const summaryHtml = `<div class="lms-kpi-grid" style="margin-bottom:24px;">${summaryCards}</div>`;

		const chartHtml = `
			<div class="lms-section-title">📈 Vaqt analitikasi
				<span class="lms-source-tag">${frappe.utils.escape_html(ta.data_source)}</span>
			</div>
			<div class="lms-chart-wrap" id="lms-monthly-chart"></div>`;

		const coursesHtml = this._renderCoursesAccordion(courses, quiz_details);

		const allAssignments = [];
		(courses || []).forEach(c => {
			(c.lessons || []).forEach(l => {
				if (l.assignment) {
					allAssignments.push({...l.assignment, lesson_title: frappe.utils.escape_html(l.lesson_title || '')});
				}
			});
		});
		const auditHtml = this._renderAssignmentAuditTable(allAssignments);

		document.getElementById('lms-profile-body').innerHTML =
			headerHtml + summaryHtml + chartHtml + coursesHtml + auditHtml
			+ '<div id="lms-profile-oa"></div>';

		this._renderTimeChart(ta.monthly, 'lms-monthly-chart');
		this._loadProfileOA(employee);
	}

	_renderCoursesAccordion(courses, quiz_details) {
		if (!courses || !courses.length) return '<div class="lms-empty">Kurslar topilmadi.</div>';

		const quizDetailByLesson = {};
		(quiz_details || []).forEach(qd => { quizDetailByLesson[qd.lesson] = qd; });

		const items = courses.map((c, idx) => {
			const cName  = frappe.utils.escape_html(c.course_name || c.course);
			const pct    = parseFloat(c.progress_pct).toFixed(1);
			const status = frappe.utils.escape_html(c.enrollment_status || '');
			const pColor = pct >= 75 ? 'var(--lms-green)' : pct >= 40 ? 'var(--lms-orange)' : 'var(--lms-red)';

			const lessonRows = (c.lessons || []).map(l => {
				const lTitle  = frappe.utils.escape_html(l.lesson_title || '');
				const watchM  = Math.round((l.watch_time_sec || 0) / 60);
				const compPct = parseFloat(l.completion_percent || 0).toFixed(0);
				const icon    = l.is_completed ? '✅' : '⏳';

				let quizBadge = '';
				if (l.quiz_summary) {
					const qs   = l.quiz_summary;
					const qCls = qs.passed ? 'lms-badge-approved' : 'lms-badge-rejected';
					quizBadge  = `<span class="lms-badge ${qCls}" style="font-size:11px;margin-left:6px;">Quiz ${qs.passed ? '✅' : '❌'} ${qs.best_percentage}% (${qs.total_attempts}x)</span>`;
				}

				let asgBadge = '';
				if (l.assignment) {
					const a    = l.assignment;
					const aCls = a.status === 'Approved' ? 'lms-badge-approved'
						: a.status === 'Rejected' ? 'lms-badge-rejected' : 'lms-badge-pending';
					asgBadge = `<span class="lms-badge ${aCls}" style="font-size:11px;margin-left:6px;">📎 ${frappe.utils.escape_html(a.status)}</span>`;
				}

				return `<tr>
					<td>${icon} ${lTitle}${quizBadge}${asgBadge}</td>
					<td style="text-align:center;">${watchM} daq</td>
					<td style="text-align:center;">${compPct}%</td>
					<td style="text-align:center;color:var(--lms-text-muted);font-size:11px;">${frappe.utils.escape_html(l.completed_on || '—')}</td>
				</tr>`;
			}).join('');

			let quizDetailHtml = '';
			(c.lessons || []).forEach(l => {
				const qd = quizDetailByLesson[l.lesson];
				if (qd) quizDetailHtml += this._renderQuizDetail(qd);
			});

			return `
				<details class="lms-accordion" ${idx === 0 ? 'open' : ''}>
					<summary class="lms-accordion-summary">
						<span class="lms-accordion-title">${cName}</span>
						<span class="lms-badge" style="margin-left:8px;">${status}</span>
						<span style="margin-left:auto;font-size:13px;color:${pColor};font-weight:700;">${pct}%</span>
						<span style="font-size:11px;color:var(--lms-text-muted);margin-left:8px;">${c.completed_lessons}/${c.total_lessons} dars</span>
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
		const qName     = frappe.utils.escape_html(qd.quiz_name || qd.quiz);
		const lTitle    = frappe.utils.escape_html(qd.lesson_title || '');
		const passScore = parseFloat(qd.passing_score || 0).toFixed(0);

		const attemptsHtml = qd.attempts.map((att, i) => {
			const isLast   = (i === qd.attempts.length - 1);
			const pctColor = att.passed ? 'var(--lms-green)' : 'var(--lms-red)';

			let questionsHtml = '';
			if (isLast && att.questions && att.questions.length) {
				questionsHtml = att.questions.map(q => {
					const cls  = q.is_correct ? 'lms-quiz-correct' : 'lms-quiz-wrong';
					const icon = q.is_correct ? '✅' : '❌';
					const correctAnsHtml = q.is_correct ? '' :
						`<div class="lms-quiz-correct-ans"><span style="font-weight:600;">To'g'ri:</span> ${frappe.utils.escape_html(q.correct_answer_text || '—')}</div>`;
					return `<div class="${cls}">
						<div class="lms-quiz-q">${frappe.utils.escape_html(q.question_text || '')}</div>
						<div class="lms-quiz-ans"><span style="font-weight:600;">Javob:</span> ${frappe.utils.escape_html(q.employee_answer_text || '—')} ${icon}</div>
						${correctAnsHtml}
					</div>`;
				}).join('');
			}

			return `
				<div style="margin-bottom:8px;padding:8px;background:var(--lms-surface-2);border-radius:6px;border:1px solid var(--lms-border);">
					<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
						<span style="font-size:12px;font-weight:600;">#${att.attempt_number}</span>
						<span style="font-size:13px;font-weight:700;color:${pctColor};">${parseFloat(att.percentage || 0).toFixed(1)}%</span>
						<span>${att.passed ? '✅' : '❌'}</span>
						<span style="font-size:11px;color:var(--lms-text-muted);margin-left:auto;">${frappe.utils.escape_html(att.attempted_on || '')}</span>
					</div>
					${isLast ? questionsHtml : ''}
				</div>`;
		}).join('');

		return `
			<div style="margin-bottom:16px;">
				<div style="font-weight:700;font-size:13px;margin-bottom:6px;color:var(--lms-text-primary);">
					🧠 ${qName}
					<span style="font-size:11px;color:var(--lms-text-muted);font-weight:400;">(O'tish bali: ${passScore}%) · ${lTitle}</span>
				</div>
				${attemptsHtml}
			</div>`;
	}

	_renderAssignmentAuditTable(assignments) {
		if (!assignments || !assignments.length) return '';

		const rows = assignments.map(a => {
			let fileCell = '—';
			if (a.submission_type === 'Google Sheets' && a.google_sheets_url) {
				fileCell = `<a href="${frappe.utils.escape_html(a.google_sheets_url)}" target="_blank" rel="noopener noreferrer">🔗 Google Sheets</a>`;
			} else if (a.attached_file) {
				fileCell = `<a href="${frappe.utils.escape_html(a.attached_file)}" target="_blank" rel="noopener noreferrer">📥 Fayl</a>`;
			}
			return `<tr>
				<td>${a.lesson_title}</td>
				<td>${frappe.utils.escape_html(a.submission_type || '—')}</td>
				<td>${fileCell}</td>
				<td>${this._badge(a.status)}</td>
				<td style="text-align:center;">${a.admin_score !== null && a.admin_score !== undefined ? parseFloat(a.admin_score).toFixed(1) : '—'}</td>
				<td>${frappe.utils.escape_html(a.reviewed_by || '—')}</td>
				<td style="color:var(--lms-text-muted);font-size:11px;">${frappe.utils.escape_html(a.reviewed_on || '—')}</td>
			</tr>`;
		}).join('');

		return `
			<div class="lms-section-title">📎 Topshiriqlar audit</div>
			<div class="lms-table-wrap">
				<table class="lms-table">
					<thead>
						<tr>
							<th>Dars</th><th>Topshiriq turi</th><th>Fayl</th>
							<th>Status</th><th>Ball</th><th>Tasdiqlagan</th><th>Tasdiqlangan vaqt</th>
						</tr>
					</thead>
					<tbody>${rows}</tbody>
				</table>
			</div>`;
	}

	// ── Profile: Ochiq savollar (lazy) ───────────────────────────────────
	_loadProfileOA(employee) {
		const container = document.getElementById('lms-profile-oa');
		if (!container) return;

		container.innerHTML = `
			<div class="lms-section-title">✍️ Ochiq Savollar</div>
			<div style="padding:16px 0;display:flex;align-items:center;gap:10px;">
				<span class="lms-spinner"></span> Yuklanmoqda...
			</div>`;

		frappe.call({
			method: 'pro_lms.lms_for_dbr.page.lms_admin.lms_admin.get_employee_open_answers',
			args:   { employee },
			callback: (r) => {
				if (!r.message || !r.message.length) {
					container.innerHTML = `
						<div class="lms-section-title">✍️ Ochiq Savollar</div>
						<div class="lms-empty" style="padding:20px;">Hali ochiq savol javoblari yo'q.</div>`;
					return;
				}
				const data         = r.message;
				const pendingCount = data.filter(d => d.status === 'Pending').length;
				const graded       = data.filter(d => d.status === 'Graded').length;
				const totalMarks   = data.reduce((s, d) => s + (d.marks || 0), 0);
				const earnedMarks  = data.filter(d => d.status === 'Graded').reduce((s, d) => s + (d.score || 0), 0);

				let html = `
					<div class="lms-section-title">✍️ Ochiq Savollar
						<span class="lms-source-tag">${data.length} ta</span>
						${pendingCount > 0 ? `<span class="lms-source-tag" style="background:var(--lms-orange-soft);color:var(--lms-orange-text);border-color:var(--lms-orange);">${pendingCount} baholanmagan</span>` : ''}
					</div>
					<div class="lms-kpi-grid" style="margin-bottom:16px;">
						${this._summaryCard('Jami savollar', data.length)}
						${this._summaryCard('Baholangan', graded + '/' + data.length, graded === data.length ? 'green' : 'orange')}
						${this._summaryCard('Jami ball', earnedMarks.toFixed(1) + '/' + totalMarks.toFixed(1), 'purple')}
					</div>
					<div class="lms-table-wrap">
						<table class="lms-table">
							<thead>
								<tr>
									<th>Dars / Kurs</th><th>Savol</th><th>Javob</th>
									<th>Ball</th><th>Status</th><th>Admin izohi</th>
									<th>Baholagan</th><th>Amal</th>
								</tr>
							</thead>
							<tbody>
								${data.map(row => this._profileOARow(row)).join('')}
							</tbody>
						</table>
					</div>`;

				container.innerHTML = html;
				this._bindProfileOAGradeButtons();
			},
			error: () => {
				container.innerHTML = `
					<div class="lms-section-title">✍️ Ochiq Savollar</div>
					<div class="lms-empty">Xatolik yuz berdi.</div>`;
			}
		});
	}

	_profileOARow(row) {
		const isPending = row.status === 'Pending';
		const eid       = frappe.utils.escape_html(row.name);
		const qShort    = (row.question_text || '').substring(0, 60) + (row.question_text?.length > 60 ? '…' : '');
		const aShort    = (row.answer_text || '').substring(0, 80) + (row.answer_text?.length > 80 ? '…' : '');

		const scoreCell = isPending
			? `<input type="number" class="lms-score-input" id="poa-score-${eid}"
				min="0" max="${row.marks}" step="0.5" placeholder="0–${row.marks}" style="width:80px;">`
			: `<span style="font-weight:700;color:${row.score >= row.marks * 0.6 ? 'var(--lms-green)' : 'var(--lms-red)'};">${row.score}/${row.marks}</span>`;

		const feedbackCell = isPending
			? `<input type="text" class="lms-feedback-input" id="poa-fb-${eid}" placeholder="Izoh..." style="min-width:120px;">`
			: `<span style="font-size:12px;color:var(--lms-text-secondary);">${frappe.utils.escape_html(row.admin_feedback || '—')}</span>`;

		const actionCell = isPending
			? `<button class="lms-btn lms-btn-success lms-btn-sm"
				data-poa-action="grade" data-poa-id="${eid}" data-poa-marks="${row.marks}">✅ Baholash</button>`
			: `<span style="font-size:11px;color:var(--lms-text-muted);">${frappe.utils.escape_html(row.graded_by || '—')}</span>`;

		return `
			<tr class="${isPending ? 'lms-oa-row-pending' : ''}" data-poa-id="${eid}">
				<td>
					<div style="font-weight:600;font-size:12px;">${frappe.utils.escape_html(row.lesson_title)}</div>
					<div style="color:var(--lms-text-muted);font-size:11px;">${frappe.utils.escape_html(row.course_name)}</div>
				</td>
				<td style="max-width:200px;" title="${frappe.utils.escape_html(row.question_text)}">
					<span style="font-size:12px;">${frappe.utils.escape_html(qShort)}</span>
					<span class="lms-oa-qtype" style="margin-left:4px;">${frappe.utils.escape_html(row.question_type)}</span>
				</td>
				<td style="max-width:200px;" title="${frappe.utils.escape_html(row.answer_text)}">
					<span style="font-size:12px;color:var(--lms-text-secondary);">${frappe.utils.escape_html(aShort)}</span>
				</td>
				<td>${scoreCell}</td>
				<td>${this._badge(row.status === 'Graded' ? 'Approved' : 'Pending')}</td>
				<td>${feedbackCell}</td>
				<td style="font-size:11px;color:var(--lms-text-muted);">${frappe.utils.escape_html(row.graded_by || '—')}</td>
				<td>${actionCell}</td>
			</tr>`;
	}

	_bindProfileOAGradeButtons() {
		document.querySelectorAll('button[data-poa-action="grade"]').forEach(btn => {
			btn.addEventListener('click', () => {
				const id    = btn.dataset.poaId;
				const marks = parseFloat(btn.dataset.poaMarks) || 0;
				const score = parseFloat(document.getElementById(`poa-score-${id}`)?.value);
				const fb    = document.getElementById(`poa-fb-${id}`)?.value || '';

				if (isNaN(score) || score < 0 || score > marks) {
					frappe.show_alert({ message: `Ball 0–${marks} oralig'ida bo'lishi kerak`, indicator: 'red' }, 3);
					return;
				}
				btn.disabled    = true;
				btn.textContent = '⏳';

				frappe.call({
					method: 'pro_lms.lms_for_dbr.page.lms_admin.lms_admin.grade_open_answer',
					args:   { answer_id: id, score, feedback: fb },
					callback: (r) => {
						if (r.message?.status === 'ok') {
							frappe.show_alert({ message: `✅ Ball: ${score}`, indicator: 'green' }, 3);
							if (this._currentProfileEmployee) this._loadProfileOA(this._currentProfileEmployee);
							this._loadKPI();
						}
					},
					error: () => {
						frappe.show_alert({ message: '❌ Xatolik', indicator: 'red' }, 3);
						btn.disabled    = false;
						btn.textContent = '✅ Baholash';
					}
				});
			});
		});
	}

	// ═════════════════════════════════════════════════════════════════════
	//  TAB 4 — OCHIQ SAVOLLAR (global view)
	// ═════════════════════════════════════════════════════════════════════
	_loadOpenAnswers() {
		this._setLoading();
		document.getElementById('lms-bulk-bar').style.display = 'none';
		const f = this.filters;

		frappe.call({
			method: 'pro_lms.lms_for_dbr.page.lms_admin.lms_admin.get_open_answers_admin',
			args: {
				status:    this._oaStatus || 'Pending',
				program:   f.program  || null,
				course:    f.course   || null,
				employee:  f.employee || null,
				page:      this.pages.open_answers || 1,
				page_size: this.pageSize,
			},
			callback: (r) => {
				if (!r?.message) return;
				this._renderOpenAnswers(r.message.data, r.message.total);
			},
			error: () => {
				document.getElementById('lms-content').innerHTML =
					'<div class="lms-empty">⚠️ Xatolik yuz berdi.</div>';
			}
		});
	}

	_renderOpenAnswers(data, total) {
		const oaStatus  = this._oaStatus || 'Pending';
		const statusMap = { Pending: '⏳ Baholanmagan', Graded: '✅ Baholangan', All: '📋 Barchasi' };

		const statusTabsHtml = ['Pending', 'Graded', 'All'].map(s =>
			`<button class="lms-oa-status-btn ${oaStatus === s ? 'active' : ''}" data-oa-status="${s}">${statusMap[s]}</button>`
		).join('');

		const headerHtml = `
			<div class="lms-oa-header">
				<div class="lms-oa-status-tabs" id="lms-oa-status-tabs">${statusTabsHtml}</div>
				<span class="lms-oa-total">Jami: <b>${total}</b></span>
			</div>`;

		if (!data.length) {
			document.getElementById('lms-content').innerHTML =
				headerHtml + '<div class="lms-empty">✍️ Baholanmagan javob topilmadi.</div>';
			document.getElementById('lms-pagination').innerHTML = '';
			this._bindOAStatusTabs();
			return;
		}

		const byEmp = {};
		data.forEach(row => {
			const key = row.employee;
			if (!byEmp[key]) byEmp[key] = { name: row.employee_name, dept: row.department, rows: [] };
			byEmp[key].rows.push(row);
		});

		let cardsHtml = '';
		Object.values(byEmp).forEach(emp => {
			const pendingCount = emp.rows.filter(r => r.status === 'Pending').length;
			const avatarChar   = (emp.name || '?')[0].toUpperCase();
			cardsHtml += `
				<div class="lms-oa-emp-group">
					<div class="lms-oa-emp-hdr">
						<div class="lms-oa-emp-avatar">${frappe.utils.escape_html(avatarChar)}</div>
						<div class="lms-oa-emp-info">
							<div class="lms-oa-emp-name">${frappe.utils.escape_html(emp.name)}</div>
							<div class="lms-oa-emp-dept">${frappe.utils.escape_html(emp.dept)}</div>
						</div>
						${pendingCount > 0
							? `<span class="lms-badge lms-badge-pending">${pendingCount} ta baholanmagan</span>`
							: '<span style="color:var(--lms-green);font-size:18px;">✓</span>'}
					</div>
					<div class="lms-oa-cards">
						${emp.rows.map(row => this._oaCard(row)).join('')}
					</div>
				</div>`;
		});

		document.getElementById('lms-content').innerHTML = headerHtml + cardsHtml;

		this._bindOAStatusTabs();
		this._bindOAGradeButtons();
		this._renderPagination(total, 'open_answers');
	}

	_oaCard(row) {
		const isPending = row.status === 'Pending';
		const isGraded  = row.status === 'Graded';
		const eid       = frappe.utils.escape_html(row.name);

		const statusBadge = isPending
			? '<span class="lms-badge lms-badge-pending">⏳ Baholanmagan</span>'
			: `<span class="lms-badge lms-badge-approved">✅ Baholandi — ${row.score}/${row.marks} ball</span>`;

		// ── FIX: correct_answer check — treat empty string as falsy
		const correctHtml = (row.question_type === 'Auto' && row.correct_answer && row.correct_answer.trim())
			? `<div class="lms-oa-correct">
				<span class="lms-oa-label">✅ To'g'ri javob:</span>
				<span class="lms-oa-correct-text">${frappe.utils.escape_html(row.correct_answer)}</span>
			   </div>`
			: '';

		const gradedHtml = isGraded ? `
			<div class="lms-oa-review-block">
				<div class="lms-oa-review-meta">
					<span>👤 ${frappe.utils.escape_html(row.graded_by)}</span>
					<span>${frappe.utils.escape_html(row.graded_on)}</span>
					<span class="lms-oa-auto-badge">${row.is_auto_graded ? '🤖 Avto' : "👁 Qo'lda"}</span>
				</div>
				${row.admin_feedback && row.admin_feedback.trim()
					? `<div class="lms-oa-feedback-display">
						<span class="lms-oa-label">💬 Admin izohi:</span>
						<span>${frappe.utils.escape_html(row.admin_feedback)}</span>
					   </div>`
					: '<div style="font-size:12px;color:var(--lms-text-muted);">Izoh yo\'q</div>'}
			</div>` : '';

		const gradingForm = isPending ? `
			<div class="lms-oa-grade-form" id="oa-form-${eid}">
				<div class="lms-oa-grade-inputs">
					<div class="lms-oa-score-wrap">
						<label>Ball <small>(maks: ${row.marks})</small></label>
						<input type="number" class="lms-oa-score-input"
							id="oa-score-${eid}" min="0" max="${row.marks}" step="0.5"
							placeholder="0–${row.marks}">
					</div>
					<div class="lms-oa-feedback-wrap">
						<label>Izoh <small>(ixtiyoriy)</small></label>
						<textarea class="lms-oa-feedback-input"
							id="oa-fb-${eid}" placeholder="Xatoliklar, tavsiyalar..." rows="2"></textarea>
					</div>
				</div>
				<div class="lms-oa-grade-actions">
					<button class="lms-btn lms-btn-success lms-btn-sm"
						data-oa-action="grade" data-oa-id="${eid}" data-oa-marks="${row.marks}">✅ Baholash</button>
					<button class="lms-btn lms-btn-sm lms-btn-secondary"
						data-oa-action="skip" data-oa-id="${eid}">↩ Keyinroq</button>
				</div>
			</div>` : '';

		return `
			<div class="lms-oa-card ${isPending ? 'lms-oa-card-pending' : 'lms-oa-card-graded'}"
				data-oa-id="${eid}">
				<div class="lms-oa-card-top">
					<div class="lms-oa-meta">
						<span class="lms-oa-course">${frappe.utils.escape_html(row.course_name)}</span>
						<span class="lms-oa-sep">›</span>
						<span class="lms-oa-lesson">${frappe.utils.escape_html(row.lesson_title)}</span>
					</div>
					<div class="lms-oa-card-right">
						${statusBadge}
						<span class="lms-oa-date">${frappe.utils.escape_html(row.submitted_on)}</span>
					</div>
				</div>
				<div class="lms-oa-question-block">
					<div class="lms-oa-label">❓ Savol <span class="lms-oa-qtype">${frappe.utils.escape_html(row.question_type)}</span></div>
					<div class="lms-oa-question-text">${frappe.utils.escape_html(row.question_text || '—')}</div>
				</div>
				<div class="lms-oa-answer-block">
					<div class="lms-oa-label">✏️ Hodim javobi:</div>
					<div class="lms-oa-answer-text">${frappe.utils.escape_html(row.answer_text || '—')}</div>
				</div>
				${correctHtml}
				${gradedHtml}
				${gradingForm}
			</div>`;
	}

	_bindOAStatusTabs() {
		document.querySelectorAll('.lms-oa-status-btn').forEach(btn => {
			btn.addEventListener('click', () => {
				this._oaStatus = btn.dataset.oaStatus;
				this.pages.open_answers = 1;
				this._loadOpenAnswers();
			});
		});
	}

	_bindOAGradeButtons() {
		document.querySelectorAll('button[data-oa-action="grade"]').forEach(btn => {
			btn.addEventListener('click', () => {
				const id    = btn.dataset.oaId;
				const marks = parseFloat(btn.dataset.oaMarks) || 0;
				const score = parseFloat(document.getElementById(`oa-score-${id}`)?.value);
				const fb    = document.getElementById(`oa-fb-${id}`)?.value || '';

				if (isNaN(score) || score < 0) {
					frappe.show_alert({ message: 'Ball kiriting (0 dan katta)', indicator: 'red' }, 3);
					return;
				}
				if (score > marks) {
					frappe.show_alert({ message: `Ball ${marks} dan oshmasligi kerak`, indicator: 'red' }, 3);
					return;
				}
				btn.disabled    = true;
				btn.textContent = '⏳ Saqlanmoqda...';

				frappe.call({
					method: 'pro_lms.lms_for_dbr.page.lms_admin.lms_admin.grade_open_answer',
					args:   { answer_id: id, score, feedback: fb },
					callback: (r) => {
						if (r.message?.status === 'ok') {
							const card = document.querySelector(`.lms-oa-card[data-oa-id="${id}"]`);
							if (card) {
								card.style.transition = 'all 0.3s ease';
								card.style.opacity    = '0';
								card.style.transform  = 'translateY(-8px)';
								setTimeout(() => this._loadOpenAnswers(), 320);
							} else {
								this._loadOpenAnswers();
							}
							frappe.show_alert({ message: `✅ Ball: ${score} — Baholandi`, indicator: 'green' }, 3);
							this._loadKPI();
						}
					},
					error: (err) => {
						frappe.show_alert({ message: '❌ Xatolik: ' + (err?.message || ''), indicator: 'red' }, 4);
						btn.disabled    = false;
						btn.textContent = '✅ Baholash';
					}
				});
			});
		});

		document.querySelectorAll('button[data-oa-action="skip"]').forEach(btn => {
			btn.addEventListener('click', () => {
				const card = btn.closest('.lms-oa-card');
				if (card) { card.style.opacity = '0.4'; card.style.pointerEvents = 'none'; }
			});
		});
	}

	// ── SVG Time Chart ───────────────────────────────────────────────────
	// FIX: reads CSS variables AFTER theme change for correct colors
	_renderTimeChart(monthlyData, containerId) {
		const container = document.getElementById(containerId);
		if (!container) return;
		if (!monthlyData || !monthlyData.length) {
			container.innerHTML = '<div class="lms-empty">Vaqt ma\'lumoti yo\'q.</div>';
			return;
		}

		// Read resolved CSS variable values (dark mode aware)
		const cs          = getComputedStyle(document.documentElement);
		const accentColor = cs.getPropertyValue('--lms-accent').trim()      || '#4361EE';
		const mutedColor  = cs.getPropertyValue('--lms-text-muted').trim()  || '#8F97B0';
		const borderColor = cs.getPropertyValue('--lms-border').trim()      || '#E2E6F0';
		const surfaceColor= cs.getPropertyValue('--lms-surface-2').trim()   || '#F8F9FC';

		const W = 600, H = 200, padL = 42, padB = 40, padT = 12, padR = 12;
		const chartW   = W - padL - padR;
		const chartH   = H - padT - padB;
		const maxHours = Math.max(...monthlyData.map(d => parseFloat(d.hours) || 0), 0.1);
		const barCount = monthlyData.length;
		const barSlot  = chartW / barCount;
		const barW     = barSlot * 0.65;

		let bars = '', xLabels = '', grid = '';

		monthlyData.forEach((d, i) => {
			const hrs    = parseFloat(d.hours) || 0;
			const bH     = (hrs / maxHours) * chartH;
			const x      = padL + i * barSlot + (barSlot - barW) / 2;
			const y      = padT + chartH - bH;
			const mo     = frappe.utils.escape_html(String(d.month || '').slice(5));
			const labelX = padL + i * barSlot + barSlot / 2;

			bars    += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(bH,2).toFixed(1)}"
				fill="${accentColor}" rx="3" opacity="0.85">
				<title>${frappe.utils.escape_html(d.month)}: ${hrs}s</title></rect>`;
			xLabels += `<text x="${labelX.toFixed(1)}" y="${(H-padB+14).toFixed(1)}" text-anchor="middle" font-size="10" fill="${mutedColor}">${mo}</text>`;
		});

		for (let g = 0; g <= 4; g++) {
			const gY   = padT + chartH - (g / 4) * chartH;
			const gVal = (maxHours * g / 4).toFixed(1);
			grid += `<line x1="${padL}" y1="${gY.toFixed(1)}" x2="${W-padR}" y2="${gY.toFixed(1)}"
				stroke="${borderColor}" stroke-width="1" stroke-dasharray="${g > 0 ? '4,4' : ''}"/>
				<text x="${(padL-5).toFixed(1)}" y="${(gY+4).toFixed(1)}" text-anchor="end" font-size="9" fill="${mutedColor}">${gVal}</text>`;
		}

		container.innerHTML = `
			<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block;">
				<rect x="0" y="0" width="${W}" height="${H}" fill="${surfaceColor}" rx="8"/>
				${grid}
				<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT+chartH}" stroke="${borderColor}" stroke-width="1.5"/>
				<line x1="${padL}" y1="${padT+chartH}" x2="${W-padR}" y2="${padT+chartH}" stroke="${borderColor}" stroke-width="1.5"/>
				${bars}${xLabels}
				<text x="${W/2}" y="${H-2}" text-anchor="middle" font-size="11" fill="${mutedColor}">Oy (soat)</text>
			</svg>`;
	}

	// ── Pagination ───────────────────────────────────────────────────────
	_renderPagination(total, tab) {
		const totalPages = Math.ceil(total / this.pageSize);
		const current    = this.pages[tab];
		const el         = document.getElementById('lms-pagination');
		if (!el) return;

		if (totalPages <= 1) {
			el.innerHTML = `<span class="lms-page-info">Jami: ${total} ta</span>`;
			return;
		}

		const maxBtns = 10;
		const half    = Math.floor(maxBtns / 2);
		let startPage = Math.max(1, current - half);
		let endPage   = Math.min(totalPages, startPage + maxBtns - 1);
		if (endPage - startPage < maxBtns - 1) startPage = Math.max(1, endPage - maxBtns + 1);

		let btns = '';
		if (startPage > 1) btns += `<button class="lms-page-btn" onclick="window.lms_admin.goPage(1,'${tab}')">«</button>`;
		for (let i = startPage; i <= endPage; i++) {
			btns += `<button class="lms-page-btn ${i === current ? 'active' : ''}"
				onclick="window.lms_admin.goPage(${i}, '${tab}')">${i}</button>`;
		}
		if (endPage < totalPages) btns += `<button class="lms-page-btn" onclick="window.lms_admin.goPage(${totalPages},'${tab}')">»</button>`;

		el.innerHTML = `<span class="lms-page-info">Jami: ${total} ta</span>${btns}`;
	}

	goPage(page, tab) {
		this.pages[tab] = page;
		this._loadActiveTab();
	}

	// ── Yordamchilar ─────────────────────────────────────────────────────
	_setLoading() {
		document.getElementById('lms-content').innerHTML =
			'<div class="lms-empty"><span class="lms-spinner"></span> Yuklanmoqda…</div>';
		document.getElementById('lms-pagination').innerHTML = '';
	}

	_badge(status) {
		const map = {
			Pending:  'lms-badge-pending',
			Approved: 'lms-badge-approved',
			Rejected: 'lms-badge-rejected',
			Graded:   'lms-badge-approved',
		};
		return `<span class="lms-badge ${map[status] || ''}">${frappe.utils.escape_html(status || '')}</span>`;
	}
}
