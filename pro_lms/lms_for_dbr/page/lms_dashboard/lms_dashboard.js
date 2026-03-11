// ═══════════════════════════════════════════════════════════════════════════
//  LMS Student Dashboard  —  Frappe Custom Page
//  Version : 4.0.0  (Full detail panels: Quiz / Assignment / Open Answer)
// ═══════════════════════════════════════════════════════════════════════════

frappe.pages['lms_dashboard'].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: "O'quv Dashboard",
		single_column: true
	});

	if (!document.getElementById('lms-dash-style')) {
		const style = document.createElement('style');
		style.id = 'lms-dash-style';
		style.textContent = LMS_CSS;
		document.head.appendChild(style);
	}

	frappe.after_ajax(() => {
		window.lms_dash = new LMSDashboard(wrapper);
	});
};

// ─────────────────────────────────────────────────────────────────────────────
class LMSDashboard {
	constructor(wrapper) {
		this.$wrapper   = $(wrapper);
		this.$root      = this.$wrapper.find('.layout-main-section');
		this.data       = null;
		this._cache_key = 'lms_dash_cache_v4';
		this._cache_ttl = 5 * 60 * 1000;

		this._injectLayoutFix();
		this._showSkeleton();
		this._load();
	}

	// ── Layout fix ────────────────────────────────────────────────────────
	_injectLayoutFix() {
		let el = this.$root[0];
		for (let i = 0; i < 12 && el && el !== document.body; i++) {
			if (el.style !== undefined) {
				const cls = el.className || '';
				if (cls.includes('container') || cls.includes('layout-main-section') ||
					cls.includes('layout-side-section') || cls.includes('page-content') ||
					cls.includes('row')) {
					el.style.setProperty('max-width', '100%', 'important');
					el.style.setProperty('width',     '100%', 'important');
					el.style.setProperty('padding',   '0',    'important');
					el.style.setProperty('margin',    '0',    'important');
					el.style.setProperty('overflow-x','hidden','important');
				}
			}
			el = el.parentElement;
		}
		if (!document.getElementById('lms-layout-fix')) {
			const s = document.createElement('style');
			s.id = 'lms-layout-fix';
			s.textContent = `
				.layout-main-section,.layout-main-section-wrapper,
				.page-body>.container,.page-body .layout-side-section{
					max-width:100%!important;width:100%!important;
					padding-left:0!important;padding-right:0!important;
					margin-left:0!important;margin-right:0!important;
				}
				.layout-main-section{padding:0!important;}
				.page-body{padding-bottom:0!important;}
			`;
			document.head.appendChild(s);
		}
		setTimeout(() => {
			let e2 = this.$root[0];
			for (let i = 0; i < 8 && e2 && e2 !== document.body; i++) {
				if (e2.style && (e2.className || '').includes('container')) {
					e2.style.setProperty('max-width', '100%', 'important');
					e2.style.setProperty('padding',   '0',    'important');
				}
				e2 = e2.parentElement;
			}
		}, 100);
	}

	// ── Skeleton ──────────────────────────────────────────────────────────
	_showSkeleton() {
		this.$root.html(`
			<div class="lms-wrap">
				<div class="lms-skel-hero">
					<div class="lms-skel" style="height:42px;width:55%;margin-bottom:14px"></div>
					<div class="lms-skel" style="height:22px;width:35%;margin-bottom:20px"></div>
					<div class="lms-skel" style="height:44px;width:200px;border-radius:12px"></div>
				</div>
				<div class="lms-skel-stats">
					${[1,2,3,4,5].map(()=>`<div class="lms-skel" style="height:96px;border-radius:18px"></div>`).join('')}
				</div>
				<div class="lms-skel-cards">
					${[1,2,3].map(()=>`<div class="lms-skel" style="height:220px;border-radius:18px"></div>`).join('')}
				</div>
			</div>`);
	}

	// ── Load ──────────────────────────────────────────────────────────────
	_load() {
		const cached = this._getCache();
		if (cached) { this.data = cached; this._render(); }

		frappe.call({
			method: 'pro_lms.lms_for_dbr.page.lms_dashboard.lms_dashboard.get_dashboard_data',
			callback: (r) => {
				if (!r || !r.message) {
					if (!cached) this._showError("Server bilan aloqa yo'q.");
					return;
				}
				if (r.message.error) {
					if (!cached) this._showError(r.message.message || "HR modulida Employee → User bog'lash kerak.");
					return;
				}
				this.data = r.message;
				this._setCache(r.message);
				this._render();
			},
			error: (err) => {
				if (!cached) this._showError("Xatolik: " + (err.message || "Noma'lum xato"));
			}
		});
	}

	_getCache() {
		try {
			const raw = localStorage.getItem(this._cache_key);
			if (!raw) return null;
			const { data, ts } = JSON.parse(raw);
			if (Date.now() - ts > this._cache_ttl) { localStorage.removeItem(this._cache_key); return null; }
			return data;
		} catch (e) { return null; }
	}
	_setCache(data) {
		try { localStorage.setItem(this._cache_key, JSON.stringify({ data, ts: Date.now() })); } catch (e) {}
	}

	_showError(msg) {
		this.$root.html(`
			<div class="lms-wrap">
				<div class="lms-err-state">
					<div style="font-size:52px">⚠️</div>
					<div class="lms-err-title">Xatolik</div>
					<div class="lms-err-msg">${this._esc(msg)}</div>
					<button class="lms-retry-btn" onclick="window.lms_dash&&window.lms_dash._load()">🔄 Qayta urinish</button>
				</div>
			</div>`);
	}

	// ── Utilities ─────────────────────────────────────────────────────────
	_esc(s) {
		if (s == null) return '';
		return String(s)
			.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
			.replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\//g,'&#x2F;');
	}
	_fmtTime(sec) {
		sec = parseInt(sec) || 0;
		if (sec < 60) return `${sec}s`;
		if (sec < 3600) return `${Math.floor(sec/60)}m`;
		const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60);
		return m ? `${h}s ${m}m` : `${h}s`;
	}

	// ── Main render ───────────────────────────────────────────────────────
	_render() {
		const d    = this.data;
		const emp  = d.employee || {};
		const myC  = Array.isArray(d.my_courses)        ? d.my_courses        : [];
		const tl   = Array.isArray(d.activity_timeline) ? d.activity_timeline : [];
		const qp   = d.quiz_performance    || { best_score:0, last_score:0, total_attempts:0, passed:0 };
		const asgn = d.assignment_summary  || { pending:0, approved:0, rejected:0, reviewed:0 };
		const oas  = d.open_answer_summary || { pending:0, graded:0 };
		const pct  = typeof d.overall_progress === 'number' ? d.overall_progress : 0;
		const done = typeof d.done_lessons     === 'number' ? d.done_lessons     : 0;
		const total= typeof d.total_lessons    === 'number' ? d.total_lessons    : 0;
		const timeS= typeof d.total_time_sec   === 'number' ? d.total_time_sec   : 0;

		const h = new Date().getHours();
		const greeting = h < 5 ? 'Xayrli tun' : h < 12 ? 'Xayrli tong' : h < 17 ? 'Xayrli kun' : 'Xayrli kech';

		const R = 44, C = parseFloat((2 * Math.PI * R).toFixed(2));
		const dashOffset = parseFloat((C - (pct / 100) * C).toFixed(2));
		const nextLesson = myC.find(c => !c.is_completed && c.next_lesson);

		this.$root.html(`
		<div class="lms-wrap">

			<svg width="0" height="0" style="position:absolute;overflow:hidden;pointer-events:none" aria-hidden="true">
				<defs>
					<linearGradient id="lmsDonutGrad" x1="0%" y1="0%" x2="100%" y2="0%">
						<stop offset="0%"   stop-color="#6366f1"/>
						<stop offset="100%" stop-color="#8b5cf6"/>
					</linearGradient>
				</defs>
			</svg>

			<!-- ═══ HERO ═══ -->
			<div class="lms-hero">
				<div class="lms-hero-glow" aria-hidden="true"></div>
				<div class="lms-hero-inner">
					<div class="lms-hero-left">
						<div class="lms-hero-greeting">${greeting} 👋</div>
						<h1 class="lms-hero-name">${this._esc(emp.employee_name || 'Foydalanuvchi')}</h1>
						<div class="lms-hero-meta">
							${emp.department  ? `<span class="lms-hero-tag">🏢 ${this._esc(emp.department)}</span>`  : ''}
							${emp.designation ? `<span class="lms-hero-tag">💼 ${this._esc(emp.designation)}</span>` : ''}
						</div>
						${nextLesson
							? `<a class="lms-hero-cta lms-cta-go" href="/app/lms-player?lesson=${encodeURIComponent(nextLesson.next_lesson)}">▶ Davom etish — ${this._esc(nextLesson.course_name)}</a>`
							: myC.length === 0
								? `<div class="lms-hero-cta lms-cta-none">📭 Hali kurs biriktirilmagan</div>`
								: `<div class="lms-hero-cta lms-cta-done">🏆 Barcha kurslar yakunlangan</div>`
						}
					</div>
					<div class="lms-hero-right" aria-label="Umumiy progress ${pct}%">
						<svg class="lms-donut" viewBox="0 0 110 110">
							<circle class="lms-donut-bg"  cx="55" cy="55" r="${R}"/>
							<circle class="lms-donut-arc" cx="55" cy="55" r="${R}"
								stroke-dasharray="${C}" stroke-dashoffset="${C}"
								data-offset="${dashOffset}"/>
						</svg>
						<div class="lms-donut-label">
							<span class="lms-donut-pct" id="lms-pct-num">${pct}</span>
							<span class="lms-donut-sym">%</span>
							<span class="lms-donut-sub">Progress</span>
						</div>
					</div>
				</div>
			</div>

			<!-- ═══ STATS (5 cards) ═══ -->
			<div class="lms-stats">
				${this._stat('📚', myC.length,                              'Kurslar',     'Biriktirilgan')}
				${this._stat('✅', `${done}<small>/${total}</small>`,        'Darslar',     'Bajarilgan')}
				${this._stat('🏆', `${qp.best_score}<small>%</small>`,      'Eng yuqori',  'Quiz bali')}
				${this._stat('📝', asgn.pending,                             'Topshiriq',   'Kutilmoqda')}
				${this._stat('⏱️', this._fmtTime(timeS),                    "O'quv vaqti", 'Jami sarflangan')}
			</div>

			<!-- ═══ COURSES ═══ -->
			<section class="lms-section">
				<div class="lms-sec-hdr">
					<h2 class="lms-sec-title">🎓 Mening Kurslarim</h2>
					<span class="lms-sec-badge">${myC.length} ta</span>
				</div>
				${myC.length > 0
					? `<div class="lms-grid-courses">${myC.map(c => this._courseCard(c)).join('')}</div>`
					: `<div class="lms-empty">
						<div class="lms-empty-ico">📭</div>
						<div class="lms-empty-title">Hali kurs yo'q</div>
						<div class="lms-empty-sub">Administrator siz uchun kurs biriktirgach bu yerda ko'rinadi</div>
					   </div>`
				}
			</section>

			<!-- ═══ BOTTOM ═══ -->
			<div class="lms-bottom">

				<!-- Timeline -->
				<section class="lms-section lms-timeline-sec">
					<div class="lms-sec-hdr">
						<h2 class="lms-sec-title">⚡ Faoliyat Tarixi</h2>
						${tl.length > 0 ? `<span class="lms-sec-badge">${tl.length} ta</span>` : ''}
					</div>
					<div class="lms-tl-wrap">
						${tl.length > 0
							? tl.map((item, i) => this._tlItem(item, i, tl.length)).join('')
							: `<div class="lms-empty lms-empty-sm">
								<div class="lms-empty-ico">💤</div>
								<div class="lms-empty-sub">Dars ko'rgach yoki quiz yechgach ko'rinadi</div>
							   </div>`
						}
					</div>
				</section>

				<!-- Right panel -->
				<div class="lms-panel">

					<!-- Quiz -->
					<section class="lms-card">
						<h2 class="lms-sec-title" style="margin-bottom:16px">🧠 Quiz Natijalari</h2>
						${qp.total_attempts > 0 ? `
							<div class="lms-score-row">
								<div class="lms-score-box">
									<div class="lms-score-num" style="color:#8b5cf6">${qp.best_score}%</div>
									<div class="lms-score-lbl">Eng yuqori</div>
								</div>
								<div class="lms-score-box">
									<div class="lms-score-num" style="color:#3b82f6">${qp.last_score}%</div>
									<div class="lms-score-lbl">Oxirgi</div>
								</div>
							</div>
							<div class="lms-chips">
								<span class="lms-chip">🎯 Jami: <b>${qp.total_attempts}</b></span>
								<span class="lms-chip lms-chip-g">✓ O'tdi: <b>${qp.passed}</b></span>
								<span class="lms-chip lms-chip-r">✗ O'tmadi: <b>${qp.total_attempts - qp.passed}</b></span>
							</div>
							<div class="lms-bar-wrap">
								<div class="lms-bar-row">
									<span>O'tish darajasi</span>
									<span>${Math.round((qp.passed / qp.total_attempts) * 100)}%</span>
								</div>
								<div class="lms-bar-track">
									<div class="lms-bar-fill lms-bar-green" style="width:0"
										data-width="${Math.round((qp.passed / qp.total_attempts) * 100)}%">
									</div>
								</div>
							</div>` : `
							<div class="lms-empty lms-empty-sm">
								<div class="lms-empty-ico">🎯</div>
								<div class="lms-empty-sub">Hali quiz yechilmagan</div>
							</div>`
						}
					</section>

					<!-- Assignments -->
					<section class="lms-card">
						<h2 class="lms-sec-title" style="margin-bottom:16px">📋 Topshiriqlar</h2>
						${this._asgRow('#f59e0b','⏳','Kutilmoqda',   asgn.pending,  'lms-chip-y')}
						${this._asgRow('#10b981','✓', 'Tasdiqlangan', asgn.approved, 'lms-chip-g')}
						${this._asgRow('#ef4444','✗', 'Rad etilgan',  asgn.rejected, 'lms-chip-r')}
						${this._asgRow('#3b82f6','👁',"Ko'rib chiqildi",asgn.reviewed,'lms-chip-b')}
						${(asgn.pending + asgn.approved + asgn.rejected + asgn.reviewed) === 0
							? `<div style="text-align:center;font-size:13px;color:var(--lms-muted);padding:16px 0">Hali topshiriq yo'q</div>`
							: ''
						}
					</section>

					<!-- Open Answers -->
					<section class="lms-card">
						<h2 class="lms-sec-title" style="margin-bottom:16px">✍️ Ochiq Savollar</h2>
						${this._asgRow('#f59e0b','⏳','Baholanmoqda', oas.pending, 'lms-chip-y')}
						${this._asgRow('#10b981','✓', 'Baholangan',   oas.graded,  'lms-chip-g')}
						${(oas.pending + oas.graded) === 0
							? `<div style="text-align:center;font-size:13px;color:var(--lms-muted);padding:16px 0">Hali javob yuborilmagan</div>`
							: ''
						}
					</section>

				</div>
			</div>

			${this._reviewTableSection()}

			<div style="height:60px"></div>
		</div>`);

		this._animate();
		this._loadReviewTable();
	}

	// ── Animations ────────────────────────────────────────────────────────
	_animate() {
		requestAnimationFrame(() => requestAnimationFrame(() => {
			const root = this.$root[0];
			if (!root) return;
			const arc = root.querySelector('.lms-donut-arc');
			if (arc) {
				arc.style.transition = 'stroke-dashoffset 1.3s cubic-bezier(0.4,0,0.2,1)';
				arc.style.strokeDashoffset = arc.dataset.offset;
			}
			const pctEl = root.querySelector('#lms-pct-num');
			if (pctEl) {
				const target = parseInt(pctEl.textContent) || 0;
				let cur = 0;
				const step = Math.max(1, Math.ceil(target / 60));
				const t = setInterval(() => {
					cur = Math.min(cur + step, target);
					pctEl.textContent = cur;
					if (cur >= target) clearInterval(t);
				}, 16);
			}
			root.querySelectorAll('[data-width]').forEach((el, i) => {
				setTimeout(() => { el.style.width = el.dataset.width; }, 200 + i * 60);
			});
			root.querySelectorAll('.lms-stat-card').forEach((el, i) => {
				el.style.animationDelay = `${i * 70}ms`;
				el.classList.add('lms-in');
			});
			root.querySelectorAll('.lms-course-card').forEach((el, i) => {
				el.style.animationDelay = `${80 + i * 55}ms`;
				el.classList.add('lms-in');
			});
			root.querySelectorAll('.lms-tl-item').forEach((el, i) => {
				el.style.animationDelay = `${i * 45}ms`;
				el.classList.add('lms-in');
			});
		}));
	}

	// ── Course card ───────────────────────────────────────────────────────
	_courseCard(c) {
		if (!c) return '';
		const pct   = typeof c.progress_pct  === 'number' ? c.progress_pct  : 0;
		const done  = typeof c.done_lessons  === 'number' ? c.done_lessons  : 0;
		const total = typeof c.total_lessons === 'number' ? c.total_lessons : 0;
		const timeS = typeof c.time_spent_sec === 'number' ? c.time_spent_sec : 0;

		const barCls = c.is_completed ? 'lms-bar-done'
			: pct >= 70 ? 'lms-bar-blue'
			: pct >= 35 ? 'lms-bar-yellow'
			: 'lms-bar-red';

		const badge = c.is_completed
			? `<span class="lms-badge lms-badge-done">✓ Yakunlangan</span>`
			: `<span class="lms-badge lms-badge-live">● Davom etmoqda</span>`;

		const cta = c.is_completed
			? `<span class="lms-cta lms-cta-fin">✓ Tugatildi</span>`
			: c.next_lesson
				? `<a class="lms-cta lms-cta-act"
					href="/app/lms-player?lesson=${encodeURIComponent(c.next_lesson)}"
					onclick="event.stopPropagation()">▶ Davom etish</a>`
				: `<span class="lms-cta lms-cta-fin">✓ Tugatildi</span>`;

		const sid   = this._esc(c.course || '');
		const sname = (c.course_name || '').replace(/['"\\<>]/g, '');

		return `
		<article class="lms-course-card" tabindex="0"
			onclick="window.lms_dash&&window.lms_dash._openModal('${sid}','${sname}')"
			onkeydown="if(event.key==='Enter'){window.lms_dash&&window.lms_dash._openModal('${sid}','${sname}')}">
			<div class="lms-thumb">
				<div class="lms-thumb-fb">🎓</div>
				${badge}
			</div>
			<div class="lms-card-body">
				<div class="lms-card-name">${this._esc(c.course_name || '')}</div>
				${c.program ? `<div class="lms-card-desc">📋 ${this._esc(c.program)}</div>` : ''}
				<div class="lms-prog">
					<div class="lms-prog-hdr">
						<span>${done}/${total} dars</span>
						<span class="lms-prog-time">⏱ ${this._fmtTime(timeS)}</span>
						<span>${pct}%</span>
					</div>
					<div class="lms-prog-track">
						<div class="${barCls}" style="width:0" data-width="${pct}%"></div>
					</div>
				</div>
			</div>
			<div class="lms-card-foot">${cta}</div>
		</article>`;
	}

	// ── Timeline item ─────────────────────────────────────────────────────
	_tlItem(t, i, total) {
		if (!t) return '';
		const isLast = i === total - 1;
		const typeMap = {
			lesson:      { dot: 'lms-dot-les', ico: '▶', badgeCls: 'lms-tl-ok',   badgeTxt: '✓' },
			quiz:        { dot: 'lms-dot-qz',  ico: '🧠', badgeCls: '', badgeTxt: '' },
			assignment:  { dot: 'lms-dot-as',  ico: '📝', badgeCls: '', badgeTxt: '' },
			open_answer: { dot: 'lms-dot-oa',  ico: '✍️', badgeCls: '', badgeTxt: '' },
		};
		const tm = typeMap[t.type] || typeMap.lesson;

		let badge = '';
		if (t.type === 'lesson') {
			badge = `<span class="lms-tl-badge lms-tl-ok">✓</span>`;
		} else if (t.type === 'quiz') {
			const passed = t.extra === 'passed';
			badge = `<span class="lms-tl-badge ${passed ? 'lms-tl-pass' : 'lms-tl-fail'}">${t.value}%</span>`;
		} else if (t.type === 'assignment') {
			const cls = t.extra === 'Approved' ? 'lms-tl-pass'
				: t.extra === 'Rejected' ? 'lms-tl-fail'
				: t.extra === 'Reviewed' ? 'lms-tl-rev'
				: 'lms-tl-pend';
			const lbl = t.extra === 'Approved' ? '✓' : t.extra === 'Rejected' ? '✗' : t.extra === 'Reviewed' ? '👁' : '⏳';
			badge = `<span class="lms-tl-badge ${cls}">${lbl}</span>`;
		} else if (t.type === 'open_answer') {
			const cls = t.extra === 'Graded' ? 'lms-tl-pass' : 'lms-tl-pend';
			badge = `<span class="lms-tl-badge ${cls}">${t.extra === 'Graded' ? t.value+'%' : '⏳'}</span>`;
		}

		return `
		<div class="lms-tl-item">
			<div class="lms-tl-l">
				<div class="lms-tl-dot ${tm.dot}">${tm.ico}</div>
				${!isLast ? `<div class="lms-tl-line"></div>` : ''}
			</div>
			<div class="lms-tl-body">
				<div class="lms-tl-title">${this._esc(t.title || '')}</div>
				<div class="lms-tl-sub">${this._esc(t.subtitle || '')}</div>
				<div class="lms-tl-time">🕐 ${this._esc(t.time || '')}</div>
			</div>
			${badge}
		</div>`;
	}

	// ── Helpers ───────────────────────────────────────────────────────────
	_stat(icon, val, label, sub) {
		return `
		<div class="lms-stat-card">
			<div class="lms-stat-ico">${icon}</div>
			<div class="lms-stat-val">${val}</div>
			<div class="lms-stat-lbl">${label}</div>
			<div class="lms-stat-sub">${sub}</div>
		</div>`;
	}

	_asgRow(color, icon, label, count, cls) {
		return `
		<div class="lms-asg-row">
			<div class="lms-asg-left">
				<span class="lms-asg-dot" style="background:${color}"></span>
				${icon} ${label}
			</div>
			<span class="lms-chip ${cls}">${count}</span>
		</div>`;
	}

	// ═════════════════════════════════════════════════════════════════════
	//  COURSE DETAIL MODAL
	// ═════════════════════════════════════════════════════════════════════
	_openModal(course, courseName) {
		if (!course) return;
		document.querySelectorAll('.lms-overlay').forEach(e => e.remove());

		const ov = document.createElement('div');
		ov.className = 'lms-overlay';
		ov.setAttribute('role', 'dialog');
		ov.setAttribute('aria-modal', 'true');

		ov.innerHTML = `
		<div class="lms-modal">
			<div class="lms-modal-hdr">
				<div style="display:flex;align-items:center;gap:10px;min-width:0">
					<span style="font-size:22px">🎓</span>
					<h3 class="lms-modal-title">${this._esc(courseName)}</h3>
				</div>
				<button class="lms-modal-close" aria-label="Yopish">✕</button>
			</div>
			<div class="lms-modal-body">
				<div class="lms-modal-load">
					<div class="lms-spinner"></div>
					<div style="margin-top:12px;color:var(--lms-muted);font-size:13px">Yuklanmoqda...</div>
				</div>
			</div>
		</div>`;

		document.body.appendChild(ov);
		document.body.style.overflow = 'hidden';

		const close = () => {
			ov.classList.add('lms-ov-out');
			document.body.style.overflow = '';
			setTimeout(() => ov.remove(), 220);
			document.removeEventListener('keydown', escFn);
		};
		const escFn = e => { if (e.key === 'Escape') close(); };
		ov.querySelector('.lms-modal-close').addEventListener('click', close);
		ov.addEventListener('click', e => { if (e.target === ov) close(); });
		document.addEventListener('keydown', escFn);
		requestAnimationFrame(() => ov.classList.add('lms-ov-in'));

		frappe.call({
			method: 'pro_lms.lms_for_dbr.page.lms_dashboard.lms_dashboard.get_course_detail',
			args: { course },
			callback: (r) => {
				const body = ov.querySelector('.lms-modal-body');
				if (!body) return;
				if (!r?.message?.sections?.length) {
					body.innerHTML = `<div class="lms-empty"><div class="lms-empty-ico">📭</div><div class="lms-empty-title">Darslar topilmadi</div></div>`;
					return;
				}
				let html = '';
				r.message.sections.forEach(sec => {
					const lessons = Array.isArray(sec.lessons) ? sec.lessons : [];
					const secDone = lessons.filter(l => l.is_completed).length;
					html += `
					<div class="lms-msec">
						<div class="lms-msec-hdr">
							<span>📂</span>
							<span class="lms-msec-name">${this._esc(sec.section_title || '')}</span>
							<span class="lms-msec-cnt">${secDone}/${lessons.length}</span>
						</div>
						${lessons.map(l => this._mLesson(l)).join('')}
					</div>`;
				});
				body.innerHTML = html;
			},
			error: () => {
				const body = ov.querySelector('.lms-modal-body');
				if (body) body.innerHTML = `<div class="lms-empty"><div class="lms-empty-ico">⚠️</div><div class="lms-empty-title">Xatolik yuz berdi</div></div>`;
			}
		});
	}

	_mLesson(l) {
		if (!l) return '';
		const status = l.is_completed ? '✅' : l.completion_percent > 0 ? '🔄' : '⭕';
		const cls    = l.is_completed ? 'ml-done' : l.completion_percent > 0 ? 'ml-part' : 'ml-todo';

		// Badge chips for quiz/assignment/open_answers
		let chips = '';
		if (l.has_quiz && l.quiz_attempts > 0) {
			const qcls = l.quiz_passed ? 'lms-chip-g' : 'lms-chip-r';
			chips += `<span class="lms-chip lms-chip-xs ${qcls}" 
				title="Quiz: ${l.quiz_attempts} ta urinish, eng yuqori ${l.quiz_best_pct}%"
				onclick="event.stopPropagation();window.lms_dash&&window.lms_dash._openQuizDetail('${this._esc(l.name)}','${this._esc(l.lesson_title)}')">
				🧠 ${l.quiz_best_pct}%</span>`;
		} else if (l.has_quiz) {
			chips += `<span class="lms-chip lms-chip-xs" title="Quiz hali yechilmagan">🧠 —</span>`;
		}

		if (l.has_assignment && l.asgn_status) {
			const acls = l.asgn_status === 'Approved' ? 'lms-chip-g'
				: l.asgn_status === 'Rejected' ? 'lms-chip-r'
				: l.asgn_status === 'Reviewed' ? 'lms-chip-b'
				: 'lms-chip-y';
			chips += `<span class="lms-chip lms-chip-xs ${acls}"
				title="Topshiriq: ${l.asgn_status}${l.asgn_score ? ', ball: ' + l.asgn_score : ''}"
				onclick="event.stopPropagation();window.lms_dash&&window.lms_dash._openAssignmentDetail('${this._esc(l.name)}','${this._esc(l.lesson_title)}')">
				📝 ${l.asgn_status}</span>`;
		} else if (l.has_assignment) {
			chips += `<span class="lms-chip lms-chip-xs" title="Topshiriq topshirilmagan">📝 —</span>`;
		}

		if (l.has_open_questions && l.oa_total > 0) {
			const ocls = l.oa_graded === l.oa_total ? 'lms-chip-g' : 'lms-chip-y';
			chips += `<span class="lms-chip lms-chip-xs ${ocls}"
				title="Ochiq savollar: ${l.oa_graded}/${l.oa_total} baholangan"
				onclick="event.stopPropagation();window.lms_dash&&window.lms_dash._openOADetail('${this._esc(l.name)}','${this._esc(l.lesson_title)}')">
				✍️ ${l.oa_graded}/${l.oa_total}</span>`;
		} else if (l.has_open_questions) {
			chips += `<span class="lms-chip lms-chip-xs" title="Ochiq savollar hali javobsiz">✍️ —</span>`;
		}

		const pctTag = (!l.is_completed && l.completion_percent > 0)
			? `<span style="font-size:11px;color:var(--lms-yellow);font-weight:600;flex-shrink:0">${l.completion_percent}%</span>` : '';

		return `
		<div class="lms-ml-row ${cls}" tabindex="0"
			onclick="window.location.href='/app/lms-player?lesson=${encodeURIComponent(l.name)}'"
			onkeydown="if(event.key==='Enter')window.location.href='/app/lms-player?lesson=${encodeURIComponent(l.name)}'">
			<span style="font-size:15px;flex-shrink:0">🎬</span>
			<div class="lms-ml-info">
				<div class="lms-ml-name">${this._esc(l.lesson_title || '')}</div>
				${chips ? `<div class="lms-ml-chips">${chips}</div>` : ''}
			</div>
			${pctTag}
			<span style="font-size:15px;flex-shrink:0">${status}</span>
		</div>`;
	}

	// ═════════════════════════════════════════════════════════════════════
	//  QUIZ DETAIL PANEL
	// ═════════════════════════════════════════════════════════════════════
	_openQuizDetail(lessonId, lessonTitle) {
		this._openDetailModal(`🧠 Quiz — ${lessonTitle}`, (body) => {
			body.innerHTML = `<div class="lms-modal-load"><div class="lms-spinner"></div></div>`;
			frappe.call({
				method: 'pro_lms.lms_for_dbr.page.lms_dashboard.lms_dashboard.get_quiz_detail',
				args: { lesson: lessonId },
				callback: (r) => {
					if (!r?.message) { body.innerHTML = this._errHtml(); return; }
					const d = r.message;
					if (!d.best && !d.questions?.length) {
						body.innerHTML = `<div class="lms-empty"><div class="lms-empty-ico">🎯</div><div class="lms-empty-title">Quiz hali yechilmagan</div></div>`;
						return;
					}
					const b = d.best || {};
					const passedCls = b.passed ? 'lms-chip-g' : 'lms-chip-r';
					let html = `
					<div class="lms-detail-summary">
						<div class="lms-ds-row">
							<div class="lms-ds-box">
								<div class="lms-ds-num" style="color:#8b5cf6">${b.percentage || 0}%</div>
								<div class="lms-ds-lbl">Eng yuqori natija</div>
							</div>
							<div class="lms-ds-box">
								<div class="lms-ds-num">${b.score || 0} / ${b.total_marks || 0}</div>
								<div class="lms-ds-lbl">Ball</div>
							</div>
							<div class="lms-ds-box">
								<span class="lms-chip ${passedCls}">${b.passed ? "✓ O'tdi" : "✗ O'tmadi"}</span>
								<div class="lms-ds-lbl">${b.submitted_at || ''}</div>
							</div>
						</div>`;

					// Attempt history
					if (d.all_attempts?.length > 1) {
						html += `<div class="lms-atmp-hdr">📊 Barcha urinishlar (${d.all_attempts.length} ta)</div>
						<div class="lms-atmp-list">`;
						d.all_attempts.forEach(at => {
							const cls = at.passed ? 'lms-chip-g' : 'lms-chip-r';
							html += `<div class="lms-atmp-row">
								<span class="lms-atmp-num">#${at.attempt_number}</span>
								<div class="lms-atmp-bar-wrap">
									<div class="lms-atmp-bar ${at.passed ? 'lms-bar-green' : 'lms-bar-red'}"
										style="width:${at.percentage}%"></div>
								</div>
								<span class="lms-chip lms-chip-xs ${cls}">${at.percentage}%</span>
								<span class="lms-atmp-time">${at.submitted_at || ''}</span>
							</div>`;
						});
						html += `</div>`;
					}
					html += `</div>`;

					// Per-question breakdown
					if (d.questions?.length) {
						html += `<div class="lms-q-hdr">📝 Savol bo'yicha tahlil</div>`;
						d.questions.forEach((q, idx) => {
							const qcls = q.is_correct ? 'lms-q-correct' : 'lms-q-wrong';
							const ico  = q.is_correct ? '✅' : '❌';
							html += `
							<div class="lms-q-card ${qcls}">
								<div class="lms-q-top">
									<span class="lms-q-idx">${idx+1}</span>
									<span class="lms-q-text">${this._esc(q.question)}</span>
									<span class="lms-q-marks">${q.marks} ball</span>
									<span>${ico}</span>
								</div>
								<div class="lms-q-answers">`;
							q.options.forEach(opt => {
								const isStudent  = opt.text === q.student_answer;
								const isCorrect  = opt.is_correct;
								let optCls = 'lms-opt';
								if (isCorrect)         optCls += ' lms-opt-correct';
								if (isStudent && !isCorrect) optCls += ' lms-opt-wrong';
								if (isStudent)         optCls += ' lms-opt-chosen';
								const optIco = isCorrect ? '✓' : isStudent && !isCorrect ? '✗' : '○';
								html += `<div class="${optCls}"><span class="lms-opt-ico">${optIco}</span>${this._esc(opt.text)}</div>`;
							});
							if (!q.student_answer) {
								html += `<div class="lms-opt lms-opt-skipped">⚠️ Javob berilmagan</div>`;
							}
							html += `</div></div>`;
						});
					}
					body.innerHTML = html;
				},
				error: () => { body.innerHTML = this._errHtml(); }
			});
		});
	}

	// ═════════════════════════════════════════════════════════════════════
	//  ASSIGNMENT DETAIL PANEL
	// ═════════════════════════════════════════════════════════════════════
	_openAssignmentDetail(lessonId, lessonTitle) {
		this._openDetailModal(`📝 Topshiriq — ${lessonTitle}`, (body) => {
			body.innerHTML = `<div class="lms-modal-load"><div class="lms-spinner"></div></div>`;
			frappe.call({
				method: 'pro_lms.lms_for_dbr.page.lms_dashboard.lms_dashboard.get_assignment_detail',
				args: { lesson: lessonId },
				callback: (r) => {
					if (!r?.message) { body.innerHTML = this._errHtml(); return; }
					const d = r.message;
					if (!d.submissions?.length) {
						body.innerHTML = `<div class="lms-empty"><div class="lms-empty-ico">📭</div><div class="lms-empty-title">Topshiriq hali topshirilmagan</div></div>`;
						return;
					}

					let html = '';
					// Instruction block
					if (d.assignment_instruction) {
						html += `<div class="lms-instr">
							<div class="lms-instr-hdr">📋 Topshiriq shartlari</div>
							<div class="lms-instr-body">${d.assignment_instruction}</div>
						</div>`;
					}

					d.submissions.forEach((sub, idx) => {
						const scls = sub.status === 'Approved' ? 'lms-status-ok'
							: sub.status === 'Rejected' ? 'lms-status-err'
							: sub.status === 'Reviewed' ? 'lms-status-blue'
							: 'lms-status-warn';
						const sico = sub.status === 'Approved' ? '✅'
							: sub.status === 'Rejected' ? '❌'
							: sub.status === 'Reviewed' ? '👁'
							: '⏳';

						html += `
						<div class="lms-sub-card">
							<div class="lms-sub-hdr">
								<span class="lms-sub-idx">#${idx+1} topshirish</span>
								<span class="lms-status-badge ${scls}">${sico} ${sub.status}</span>
								<span class="lms-sub-date">${sub.submitted_on}</span>
							</div>`;

						// File link
						if (sub.attached_file) {
							html += `<div class="lms-sub-row">
								<span class="lms-sub-lbl">📎 Fayl:</span>
								<a href="${this._esc(sub.attached_file)}" target="_blank" class="lms-sub-link">Faylni ko'rish</a>
							</div>`;
						}
						if (sub.google_sheets_url) {
							html += `<div class="lms-sub-row">
								<span class="lms-sub-lbl">🔗 Google Sheets:</span>
								<a href="${this._esc(sub.google_sheets_url)}" target="_blank" class="lms-sub-link">Havolani ochish</a>
							</div>`;
						}

						// Admin review
						if (sub.status !== 'Pending') {
							html += `<div class="lms-review-block">
								<div class="lms-review-hdr">👤 Admin baholashi</div>`;
							if (sub.admin_score) {
								html += `<div class="lms-sub-row"><span class="lms-sub-lbl">⭐ Ball:</span> <b>${sub.admin_score}</b></div>`;
							}
							if (sub.reviewed_by) {
								html += `<div class="lms-sub-row"><span class="lms-sub-lbl">Kim:</span> ${this._esc(sub.reviewed_by)} — ${sub.reviewed_on}</div>`;
							}
							if (sub.admin_feedback) {
								html += `<div class="lms-feedback-box">
									<div class="lms-feedback-lbl">💬 Izoh:</div>
									<div class="lms-feedback-text">${this._esc(sub.admin_feedback)}</div>
								</div>`;
							} else {
								html += `<div style="font-size:12px;color:var(--lms-muted);padding:8px 0">Izoh qoldirilmagan</div>`;
							}
							html += `</div>`;
						}
						html += `</div>`;
					});
					body.innerHTML = html;
				},
				error: () => { body.innerHTML = this._errHtml(); }
			});
		});
	}

	// ═════════════════════════════════════════════════════════════════════
	//  OPEN ANSWER DETAIL PANEL
	// ═════════════════════════════════════════════════════════════════════
	_openOADetail(lessonId, lessonTitle) {
		this._openDetailModal(`✍️ Ochiq savollar — ${lessonTitle}`, (body) => {
			body.innerHTML = `<div class="lms-modal-load"><div class="lms-spinner"></div></div>`;
			frappe.call({
				method: 'pro_lms.lms_for_dbr.page.lms_dashboard.lms_dashboard.get_open_answer_detail',
				args: { lesson: lessonId },
				callback: (r) => {
					if (!r?.message) { body.innerHTML = this._errHtml(); return; }
					const d = r.message;
					if (!d.questions?.length) {
						body.innerHTML = `<div class="lms-empty"><div class="lms-empty-ico">✍️</div><div class="lms-empty-title">Ochiq savollar topilmadi</div></div>`;
						return;
					}
					let html = '';
					d.questions.forEach((q, idx) => {
						const notSubmitted = !q.answer_text && q.status === 'Not Submitted';
						const isGraded     = q.status === 'Graded';
						const cardCls      = isGraded ? 'lms-oa-graded' : notSubmitted ? 'lms-oa-pending' : 'lms-oa-submitted';
						const statusBadge  = isGraded
							? `<span class="lms-status-badge lms-status-ok">✅ Baholandi</span>`
							: notSubmitted
								? `<span class="lms-status-badge lms-status-warn">⭕ Javob yo'q</span>`
								: `<span class="lms-status-badge lms-status-warn">⏳ Baholanmoqda</span>`;

						html += `
						<div class="lms-oa-card ${cardCls}">
							<div class="lms-sub-hdr">
								<span class="lms-sub-idx">Savol ${idx+1}</span>
								${statusBadge}
								<span class="lms-sub-date">${q.marks} ball</span>
							</div>

							<div class="lms-oa-question">${this._esc(q.question_text)}</div>`;

						// Student answer
						if (q.answer_text) {
							html += `<div class="lms-oa-section">
								<div class="lms-oa-sec-lbl">✏️ Sizning javobingiz <small>(${q.submitted_on})</small></div>
								<div class="lms-oa-answer-box">${this._esc(q.answer_text)}</div>
							</div>`;
						}

						// Correct answer (for Auto type)
						if (q.question_type === 'Auto' && q.correct_answer) {
							html += `<div class="lms-oa-section">
								<div class="lms-oa-sec-lbl">✅ To'g'ri javob</div>
								<div class="lms-oa-correct-box">${this._esc(q.correct_answer)}</div>
							</div>`;
						}

						// Admin grade block
						if (isGraded) {
							html += `<div class="lms-review-block">
								<div class="lms-review-hdr">👤 Admin baholashi</div>
								<div class="lms-sub-row">
									<span class="lms-sub-lbl">⭐ Ball:</span>
									<b>${q.score} / ${q.marks}</b>
									${q.is_auto_graded ? '<span class="lms-chip lms-chip-xs" style="margin-left:8px">🤖 Avto</span>' : ''}
								</div>
								${q.graded_by ? `<div class="lms-sub-row"><span class="lms-sub-lbl">Kim:</span> ${this._esc(q.graded_by)} — ${q.graded_on}</div>` : ''}
								${q.admin_feedback
									? `<div class="lms-feedback-box">
										<div class="lms-feedback-lbl">💬 Admin izohi:</div>
										<div class="lms-feedback-text">${this._esc(q.admin_feedback)}</div>
									   </div>`
									: `<div style="font-size:12px;color:var(--lms-muted);padding:8px 0">Izoh qoldirilmagan</div>`
								}
							</div>`;
						}
						html += `</div>`;
					});
					body.innerHTML = html;
				},
				error: () => { body.innerHTML = this._errHtml(); }
			});
		});
	}

	// ── Generic detail modal factory ──────────────────────────────────────
	_openDetailModal(title, loadFn) {
		document.querySelectorAll('.lms-overlay').forEach(e => e.remove());
		const ov = document.createElement('div');
		ov.className = 'lms-overlay';
		ov.setAttribute('role', 'dialog');
		ov.setAttribute('aria-modal', 'true');
		ov.innerHTML = `
		<div class="lms-modal lms-modal-lg">
			<div class="lms-modal-hdr">
				<h3 class="lms-modal-title" style="font-size:15px">${this._esc(title)}</h3>
				<button class="lms-modal-close" aria-label="Yopish">✕</button>
			</div>
			<div class="lms-modal-body"></div>
		</div>`;
		document.body.appendChild(ov);
		document.body.style.overflow = 'hidden';

		const close = () => {
			ov.classList.add('lms-ov-out');
			document.body.style.overflow = '';
			setTimeout(() => ov.remove(), 220);
			document.removeEventListener('keydown', escFn);
		};
		const escFn = e => { if (e.key === 'Escape') close(); };
		ov.querySelector('.lms-modal-close').addEventListener('click', close);
		ov.addEventListener('click', e => { if (e.target === ov) close(); });
		document.addEventListener('keydown', escFn);
		requestAnimationFrame(() => ov.classList.add('lms-ov-in'));
		loadFn(ov.querySelector('.lms-modal-body'));
	}

	_errHtml() {
		return `<div class="lms-empty"><div class="lms-empty-ico">⚠️</div><div class="lms-empty-title">Xatolik yuz berdi</div></div>`;
	}

	// ═════════════════════════════════════════════════════════════════════
	//  REVIEW TABLE
	// ═════════════════════════════════════════════════════════════════════
	_reviewTableSection() {
		return `
		<section class="lms-section lms-review-section" id="lms-review-section">
			<div class="lms-sec-hdr">
				<h2 class="lms-sec-title">📊 Faoliyat Baholash Jadvali</h2>
				<div class="lms-rtbl-toolbar">
					<select class="lms-rtbl-filter" id="lms-rtbl-filter-type">
						<option value="">Barchasi</option>
						<option value="quiz">🧠 Quiz</option>
						<option value="assignment">📝 Topshiriq</option>
						<option value="open_answer">✍️ Ochiq savol</option>
					</select>
					<select class="lms-rtbl-filter" id="lms-rtbl-filter-status">
						<option value="">Barcha holat</option>
						<option value="needs_retry">⚠️ Qayta yuborish kerak</option>
						<option value="pending">⏳ Kutilmoqda</option>
						<option value="passed">✅ O'tdi</option>
						<option value="approved">✅ Tasdiqlandi</option>
						<option value="graded">✅ Baholandi</option>
						<option value="failed">❌ O'tmadi</option>
						<option value="rejected">❌ Rad etildi</option>
						<option value="reviewed">👁 Ko'rib chiqildi</option>
					</select>
					<select class="lms-rtbl-filter" id="lms-rtbl-filter-course">
						<option value="">Barcha kurs</option>
					</select>
				</div>
			</div>
			<div id="lms-rtbl-alert" class="lms-rtbl-alert" style="display:none"></div>
			<div id="lms-rtbl-wrap" class="lms-rtbl-wrap">
				<div class="lms-modal-load" style="min-height:120px">
					<div class="lms-spinner"></div>
				</div>
			</div>
		</section>`;
	}

	_loadReviewTable() {
		frappe.call({
			method: 'pro_lms.lms_for_dbr.page.lms_dashboard.lms_dashboard.get_activity_review_table',
			callback: (r) => {
				if (!r?.message || r.message.error) {
					this._rtblSetWrap(`<div class="lms-empty lms-empty-sm">
						<div class="lms-empty-ico">⚠️</div>
						<div class="lms-empty-sub">Ma'lumot yuklanmadi</div>
					</div>`);
					return;
				}
				this._rtblData = r.message.rows || [];
				this._rtblRender();

				const nrc = r.message.needs_retry_count || 0;
				const alertEl = document.getElementById('lms-rtbl-alert');
				if (alertEl && nrc > 0) {
					alertEl.style.display = 'flex';
					alertEl.innerHTML = `
					<span class="lms-rtbl-alert-ico">⚠️</span>
					<span><b>${nrc} ta</b> topshiriq/quiz qayta yuborilishi yoki ko'rib chiqilishi kerak</span>`;
				}

				const cf = document.getElementById('lms-rtbl-filter-course');
				if (cf) {
					this._rtblData.forEach(r => {
						if (r.course_id && !cf.querySelector(`option[value="${r.course_id}"]`)) {
							const o = document.createElement('option');
							o.value = r.course_id;
							o.textContent = r.course_name || r.course_id;
							cf.appendChild(o);
						}
					});
				}

				['lms-rtbl-filter-type','lms-rtbl-filter-status','lms-rtbl-filter-course'].forEach(id => {
					const el = document.getElementById(id);
					if (el) el.addEventListener('change', () => this._rtblRender());
				});
			},
			error: () => {
				this._rtblSetWrap(`<div class="lms-empty lms-empty-sm">
					<div class="lms-empty-ico">⚠️</div>
					<div class="lms-empty-sub">Server xatosi</div>
				</div>`);
			}
		});
	}

	_rtblSetWrap(html) {
		const el = document.getElementById('lms-rtbl-wrap');
		if (el) el.innerHTML = html;
	}

	_rtblRender() {
		const typeF   = (document.getElementById('lms-rtbl-filter-type')?.value   || '').toLowerCase();
		const statusF = (document.getElementById('lms-rtbl-filter-status')?.value || '').toLowerCase();
		const courseF = (document.getElementById('lms-rtbl-filter-course')?.value || '').toLowerCase();
		const data    = this._rtblData || [];

		const filtered = data.filter(row => {
			if (typeF   && row.type !== typeF)                                  return false;
			if (courseF && row.course_id.toLowerCase() !== courseF)             return false;
			if (statusF === 'needs_retry' && !row.needs_retry)                  return false;
			if (statusF && statusF !== 'needs_retry' && row.status !== statusF) return false;
			return true;
		});

		if (!filtered.length) {
			this._rtblSetWrap(`<div class="lms-empty lms-empty-sm">
				<div class="lms-empty-ico">🔍</div>
				<div class="lms-empty-sub">Filtr bo'yicha ma'lumot topilmadi</div>
			</div>`);
			return;
		}

		const grouped = {};
		filtered.forEach(row => {
			const key = row.course_id || '__no_course__';
			if (!grouped[key]) grouped[key] = { name: row.course_name, rows: [] };
			grouped[key].rows.push(row);
		});

		let html = '';
		Object.values(grouped).forEach(group => {
			const retryCount = group.rows.filter(r => r.needs_retry).length;
			html += `
			<div class="lms-rtbl-group">
				<div class="lms-rtbl-group-hdr">
					<span class="lms-rtbl-group-name">🎓 ${this._esc(group.name)}</span>
					<span class="lms-sec-badge">${group.rows.length} ta</span>
					${retryCount ? `<span class="lms-chip lms-chip-r lms-chip-xs">⚠️ ${retryCount} ta qayta yuborish</span>` : ''}
				</div>
				<div class="lms-rtbl-desktop">
					<table class="lms-rtbl">
						<thead>
							<tr>
								<th>Tur</th>
								<th>Dars</th>
								<th>Tafsilot</th>
								<th>Holat</th>
								<th>Ball</th>
								<th>Admin izohi</th>
								<th>Sana</th>
								<th>Harakat</th>
							</tr>
						</thead>
						<tbody>
							${group.rows.map(row => this._rtblRow(row)).join('')}
						</tbody>
					</table>
				</div>
				<div class="lms-rtbl-mobile">
					${group.rows.map(row => this._rtblCard(row)).join('')}
				</div>
			</div>`;
		});
		this._rtblSetWrap(html);
	}

	_rtblRow(row) {
		const statusBadge = this._rtblStatusBadge(row);
		const actionBtn   = this._rtblActionBtn(row, false);
		const scoreCls    = row.score_raw >= 80 ? 'lms-score-hi' : row.score_raw >= 60 ? 'lms-score-mid' : row.score_raw > 0 ? 'lms-score-lo' : '';
		const feedbackHtml = row.admin_feedback
			? `<div class="lms-rtbl-feedback" title="${this._esc(row.admin_feedback)}">
				<span class="lms-rtbl-feedback-ico">💬</span>
				<span class="lms-rtbl-feedback-text">${this._esc(row.admin_feedback)}</span>
			   </div>`
			: `<span class="lms-rtbl-no-feedback">—</span>`;
		const retryFlag = row.needs_retry
			? `<div class="lms-rtbl-retry-flag" title="${this._esc(row.retry_reason)}">⚠️</div>` : '';

		return `
		<tr class="${row.needs_retry ? 'lms-rtbl-row-warn' : ''}">
			<td><span class="lms-rtbl-type-badge">${this._esc(row.type_label)}</span></td>
			<td class="lms-rtbl-lesson-cell">
				${retryFlag}
				<div class="lms-rtbl-lesson-name">${this._esc(row.lesson_title)}</div>
			</td>
			<td class="lms-rtbl-detail-cell">
				<span class="lms-rtbl-detail">${this._esc(row.detail)}</span>
				${row.file_url ? `<a href="${this._esc(row.file_url)}" target="_blank" class="lms-rtbl-file-link" onclick="event.stopPropagation()">📎 Fayl</a>` : ''}
			</td>
			<td>${statusBadge}</td>
			<td><span class="lms-rtbl-score ${scoreCls}">${this._esc(row.score)}</span></td>
			<td>${feedbackHtml}</td>
			<td class="lms-rtbl-date">${this._esc(row.submitted_on)}</td>
			<td>${actionBtn}</td>
		</tr>`;
	}

	_rtblCard(row) {
		const statusBadge = this._rtblStatusBadge(row);
		const actionBtn   = this._rtblActionBtn(row, true);
		return `
		<div class="lms-rtbl-mcard ${row.needs_retry ? 'lms-rtbl-mcard-warn' : ''}">
			<div class="lms-rtbl-mcard-top">
				<span class="lms-rtbl-type-badge">${this._esc(row.type_label)}</span>
				${statusBadge}
				${row.needs_retry ? `<span class="lms-rtbl-retry-flag-inline">⚠️ Qayta yuborish kerak</span>` : ''}
			</div>
			<div class="lms-rtbl-mcard-lesson">${this._esc(row.lesson_title)}</div>
			${row.detail ? `<div class="lms-rtbl-mcard-detail">${this._esc(row.detail)}</div>` : ''}
			<div class="lms-rtbl-mcard-row">
				<span class="lms-sub-lbl">Ball:</span>
				<b class="${row.score_raw >= 60 ? 'lms-score-hi' : row.score_raw > 0 ? 'lms-score-lo' : ''}">${this._esc(row.score)}</b>
			</div>
			${row.admin_feedback ? `
			<div class="lms-feedback-box" style="margin-top:8px">
				<div class="lms-feedback-lbl">💬 Admin izohi</div>
				<div class="lms-feedback-text">${this._esc(row.admin_feedback)}</div>
			</div>` : ''}
			${row.file_url ? `<a href="${this._esc(row.file_url)}" target="_blank" class="lms-rtbl-file-link" style="margin-top:8px;display:inline-block">📎 Faylni ko'rish</a>` : ''}
			<div class="lms-rtbl-mcard-footer">
				<span class="lms-rtbl-date">${this._esc(row.submitted_on)}</span>
				${actionBtn}
			</div>
		</div>`;
	}

	_rtblStatusBadge(row) {
		const map = {
			passed:   ['lms-status-ok',   "✅ O'tdi"],
			approved: ['lms-status-ok',   '✅ Tasdiqlandi'],
			graded:   ['lms-status-ok',   '✅ Baholandi'],
			failed:   ['lms-status-err',  "❌ O'tmadi"],
			rejected: ['lms-status-err',  '❌ Rad etildi'],
			reviewed: ['lms-status-blue', "👁 Ko'rib chiqildi"],
			pending:  ['lms-status-warn', '⏳ Kutilmoqda'],
		};
		const [cls, label] = map[row.status] || ['lms-status-warn', row.status_label || row.status];
		return `<span class="lms-status-badge ${cls}">${label}</span>`;
	}

	_rtblActionBtn(row, isMobile) {
		const lessonUrl = `/app/lms-player?lesson=${encodeURIComponent(row.action_lesson)}`;
		if (row.needs_retry) {
			return `<a href="${lessonUrl}" class="lms-rtbl-btn lms-rtbl-btn-warn" title="${this._esc(row.retry_reason)}">🔄 Qayta yuborish</a>`;
		}
		if (row.status === 'failed' || row.status === 'pending') {
			return `<a href="${lessonUrl}" class="lms-rtbl-btn lms-rtbl-btn-blue">▶ Darsga o'tish</a>`;
		}
		return `<a href="${lessonUrl}" class="lms-rtbl-btn lms-rtbl-btn-ghost">👁 Ko'rish</a>`;
	}
}


// ─────────────────────────────────────────────────────────────────────────────
//  CSS
// ─────────────────────────────────────────────────────────────────────────────
const LMS_CSS = `
:root {
	--lms-bg     : #080d1a;
	--lms-card   : #0f1625;
	--lms-glass  : rgba(255,255,255,0.04);
	--lms-border : rgba(255,255,255,0.07);
	--lms-border2: rgba(255,255,255,0.14);
	--lms-text   : #f1f5f9;
	--lms-text2  : #94a3b8;
	--lms-muted  : #64748b;
	--lms-a1     : #6366f1;
	--lms-a2     : #8b5cf6;
	--lms-a3     : #06b6d4;
	--lms-green  : #10b981;
	--lms-yellow : #f59e0b;
	--lms-red    : #ef4444;
	--lms-blue   : #3b82f6;
	--lms-r-sm   : 8px;
	--lms-r-md   : 14px;
	--lms-r-lg   : 20px;
	--lms-r-xl   : 28px;
	--lms-ease   : 0.22s cubic-bezier(0.4,0,0.2,1);
	--lms-g      : 16px;
}
.lms-wrap,.lms-wrap *{box-sizing:border-box;}
.lms-wrap{
	width:100%;min-height:calc(100vh - 56px);
	background:var(--lms-bg);color:var(--lms-text);
	font-family:'DM Sans','Segoe UI',system-ui,sans-serif;
	-webkit-font-smoothing:antialiased;overflow-x:hidden;
}

/* Skeleton */
.lms-skel{
	background:linear-gradient(90deg,#1a2235 25%,#243050 50%,#1a2235 75%);
	background-size:200% 100%;animation:lms-shimmer 1.5s infinite;border-radius:var(--lms-r-md);
}
@keyframes lms-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.lms-skel-hero{padding:32px var(--lms-g);}
.lms-skel-stats{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:0 var(--lms-g) var(--lms-g);max-width:1440px;margin:0 auto;}
.lms-skel-cards{display:grid;grid-template-columns:1fr;gap:12px;padding:0 var(--lms-g);max-width:1440px;margin:0 auto;}
@media(min-width:600px){.lms-skel-stats{grid-template-columns:repeat(5,1fr);}}
@media(min-width:720px){.lms-skel-cards{grid-template-columns:repeat(3,1fr);}}

/* Error */
.lms-err-state{display:flex;flex-direction:column;align-items:center;justify-content:center;
	min-height:60vh;padding:32px 20px;text-align:center;gap:14px;}
.lms-err-title{font-size:22px;font-weight:700;}
.lms-err-msg{font-size:14px;color:var(--lms-text2);max-width:420px;line-height:1.6;}
.lms-retry-btn{padding:12px 28px;background:var(--lms-a1);color:#fff;border:none;
	border-radius:var(--lms-r-md);font-size:14px;font-weight:600;cursor:pointer;}
.lms-retry-btn:hover{background:var(--lms-a2);}

/* Hero */
.lms-hero{position:relative;overflow:hidden;
	background:linear-gradient(145deg,#0b1121 0%,#1a1040 55%,#0b1a2e 100%);
	padding:32px var(--lms-g) 36px;border-bottom:1px solid var(--lms-border);}
.lms-hero-glow{position:absolute;inset:0;pointer-events:none;
	background:radial-gradient(ellipse 60% 80% at 15% 40%,rgba(99,102,241,.18) 0%,transparent 55%),
	radial-gradient(ellipse 40% 60% at 85% 60%,rgba(139,92,246,.14) 0%,transparent 50%);}
.lms-hero-inner{position:relative;z-index:1;display:flex;align-items:center;
	justify-content:space-between;gap:20px;max-width:1440px;margin:0 auto;}
.lms-hero-left{flex:1;min-width:0;}
.lms-hero-greeting{font-size:12px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;
	color:var(--lms-a3);margin-bottom:8px;}
.lms-hero-name{font-size:clamp(24px,5vw,40px);font-weight:800;color:var(--lms-text);
	margin:0 0 10px;line-height:1.15;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lms-hero-meta{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:22px;}
.lms-hero-tag{font-size:12px;color:var(--lms-text2);background:rgba(255,255,255,0.06);
	border:1px solid var(--lms-border);border-radius:20px;padding:3px 11px;}
.lms-hero-cta{display:inline-flex;align-items:center;gap:8px;padding:12px 22px;
	border-radius:var(--lms-r-md);font-size:14px;font-weight:600;white-space:nowrap;
	text-decoration:none;transition:transform var(--lms-ease),box-shadow var(--lms-ease);}
.lms-cta-go{background:linear-gradient(135deg,var(--lms-a1),var(--lms-a2));color:#fff;
	box-shadow:0 4px 22px rgba(99,102,241,.42);}
.lms-cta-go:hover{transform:translateY(-2px);color:#fff;box-shadow:0 6px 30px rgba(99,102,241,.58);text-decoration:none;}
.lms-cta-none{background:rgba(255,255,255,.07);border:1px solid var(--lms-border);color:var(--lms-text2);}
.lms-cta-done{background:rgba(16,185,129,.14);border:1px solid rgba(16,185,129,.3);color:var(--lms-green);}
.lms-hero-right{position:relative;flex-shrink:0;}
.lms-donut{width:130px;height:130px;transform:rotate(-90deg);display:block;}
.lms-donut-bg{fill:none;stroke:rgba(255,255,255,.06);stroke-width:9;}
.lms-donut-arc{fill:none;stroke:url(#lmsDonutGrad);stroke-width:9;stroke-linecap:round;stroke-dashoffset:276;}
.lms-donut-label{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
	justify-content:center;line-height:1;pointer-events:none;}
.lms-donut-pct{font-size:28px;font-weight:800;color:var(--lms-text);}
.lms-donut-sym{font-size:14px;font-weight:600;color:var(--lms-a1);margin-top:1px;}
.lms-donut-sub{font-size:10px;color:var(--lms-muted);margin-top:4px;text-transform:uppercase;letter-spacing:.06em;}

/* Stats — 5 columns */
.lms-stats{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;
	padding:var(--lms-g);max-width:1440px;margin:0 auto;}
@media(min-width:480px){.lms-stats{grid-template-columns:repeat(3,1fr);}}
@media(min-width:700px){.lms-stats{grid-template-columns:repeat(5,1fr);}}
.lms-stat-card{background:var(--lms-card);border:1px solid var(--lms-border);
	border-radius:var(--lms-r-lg);padding:18px 14px;text-align:center;
	opacity:0;transform:translateY(16px);transition:border-color var(--lms-ease),transform var(--lms-ease);}
.lms-stat-card.lms-in{animation:lms-up .5s var(--lms-ease) forwards;}
.lms-stat-card:hover{border-color:var(--lms-border2);transform:translateY(-2px)!important;}
.lms-stat-ico{font-size:24px;margin-bottom:7px;}
.lms-stat-val{font-size:clamp(20px,4vw,28px);font-weight:800;color:var(--lms-text);line-height:1.1;}
.lms-stat-val small{font-size:.6em;color:var(--lms-muted);}
.lms-stat-lbl{font-size:13px;font-weight:600;margin-top:5px;}
.lms-stat-sub{font-size:11px;color:var(--lms-muted);margin-top:2px;}

/* Section */
.lms-section{padding:0 var(--lms-g) var(--lms-g);max-width:1440px;margin:0 auto;width:100%;}
.lms-sec-hdr{display:flex;align-items:center;justify-content:space-between;padding-top:24px;margin-bottom:16px;}
.lms-sec-title{display:flex;align-items:center;gap:8px;font-size:17px;font-weight:700;color:var(--lms-text);margin:0;}
.lms-sec-badge{font-size:12px;color:var(--lms-muted);background:var(--lms-glass);
	border:1px solid var(--lms-border);border-radius:20px;padding:3px 10px;}

/* Courses */
.lms-grid-courses{display:grid;grid-template-columns:1fr;gap:14px;}
@media(min-width:560px){.lms-grid-courses{grid-template-columns:repeat(2,1fr);}}
@media(min-width:900px){.lms-grid-courses{grid-template-columns:repeat(3,1fr);}}
@media(min-width:1280px){.lms-grid-courses{grid-template-columns:repeat(4,1fr);}}
.lms-course-card{background:var(--lms-card);border:1px solid var(--lms-border);
	border-radius:var(--lms-r-lg);overflow:hidden;display:flex;flex-direction:column;
	cursor:pointer;opacity:0;transform:translateY(18px);
	transition:border-color var(--lms-ease),transform var(--lms-ease),box-shadow var(--lms-ease);
	-webkit-tap-highlight-color:transparent;user-select:none;}
.lms-course-card.lms-in{animation:lms-up .5s var(--lms-ease) forwards;}
.lms-course-card:hover{border-color:var(--lms-a1);
	box-shadow:0 0 0 1px var(--lms-a1),0 8px 28px rgba(0,0,0,.45);transform:translateY(-3px)!important;}
.lms-thumb{position:relative;height:100px;
	background:linear-gradient(135deg,#151e35,#0e1520);overflow:hidden;flex-shrink:0;}
.lms-thumb-fb{width:100%;height:100%;display:flex;align-items:center;justify-content:center;
	font-size:40px;background:linear-gradient(135deg,#1a2540 0%,#2d1f5e 100%);}
.lms-badge{position:absolute;top:10px;left:10px;font-size:11px;font-weight:600;border-radius:20px;padding:3px 9px;}
.lms-badge-done{background:rgba(16,185,129,.2);border:1px solid rgba(16,185,129,.4);color:#34d399;}
.lms-badge-live{background:rgba(99,102,241,.2);border:1px solid rgba(99,102,241,.4);color:#a5b4fc;}
.lms-card-body{padding:14px 16px 10px;flex:1;}
.lms-card-name{font-size:15px;font-weight:700;color:var(--lms-text);margin-bottom:6px;line-height:1.4;
	display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.lms-card-desc{font-size:12px;color:var(--lms-muted);margin-bottom:12px;line-height:1.5;
	display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;}
.lms-prog{margin-top:auto;}
.lms-prog-hdr{display:flex;justify-content:space-between;font-size:12px;color:var(--lms-muted);margin-bottom:6px;}
.lms-prog-time{color:var(--lms-a3);}
.lms-prog-track{height:6px;background:rgba(255,255,255,.08);border-radius:99px;overflow:hidden;}
.lms-prog-track>div{height:100%;border-radius:99px;width:0;transition:width .85s cubic-bezier(.4,0,.2,1);}
.lms-bar-done{background:linear-gradient(90deg,#10b981,#34d399);}
.lms-bar-blue{background:linear-gradient(90deg,#3b82f6,#06b6d4);}
.lms-bar-yellow{background:linear-gradient(90deg,#f59e0b,#fbbf24);}
.lms-bar-red{background:linear-gradient(90deg,#ef4444,#f87171);}
.lms-card-foot{padding:0 16px 14px;flex-shrink:0;}
.lms-cta{display:flex;align-items:center;justify-content:center;gap:6px;
	width:100%;padding:10px 16px;border-radius:var(--lms-r-md);font-size:13px;font-weight:600;
	text-align:center;text-decoration:none;min-height:44px;transition:all var(--lms-ease);}
.lms-cta-act{background:linear-gradient(135deg,var(--lms-a1),var(--lms-a2));
	color:#fff;box-shadow:0 2px 12px rgba(99,102,241,.32);}
.lms-cta-act:hover{box-shadow:0 4px 20px rgba(99,102,241,.5);transform:translateY(-1px);color:#fff;text-decoration:none;}
.lms-cta-fin{background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.22);color:var(--lms-green);}

/* Bottom */
.lms-bottom{display:grid;grid-template-columns:1fr;gap:16px;max-width:1440px;margin:0 auto;padding:0 var(--lms-g) 24px;width:100%;}
@media(min-width:900px){
	.lms-bottom{grid-template-columns:1fr 360px;gap:24px;align-items:start;}
}
.lms-timeline-sec{padding:0;}
@media(min-width:900px){.lms-timeline-sec{padding:0;}}

/* Timeline */
.lms-tl-wrap{background:var(--lms-card);border:1px solid var(--lms-border);
	border-radius:var(--lms-r-lg);padding:20px;max-height:480px;overflow-y:auto;
	scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.08) transparent;}
.lms-tl-item{display:flex;gap:12px;align-items:flex-start;opacity:0;transform:translateX(-14px);}
.lms-tl-item.lms-in{animation:lms-right .4s var(--lms-ease) forwards;}
.lms-tl-l{display:flex;flex-direction:column;align-items:center;flex-shrink:0;}
.lms-tl-dot{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;
	justify-content:center;font-size:13px;flex-shrink:0;}
.lms-dot-les{background:rgba(99,102,241,.18);border:2px solid rgba(99,102,241,.45);color:#a5b4fc;}
.lms-dot-qz {background:rgba(139,92,246,.18);border:2px solid rgba(139,92,246,.45);color:#c4b5fd;}
.lms-dot-as {background:rgba(245,158,11,.18);border:2px solid rgba(245,158,11,.45);color:#fbbf24;}
.lms-dot-oa {background:rgba(6,182,212,.18); border:2px solid rgba(6,182,212,.45); color:#67e8f9;}
.lms-tl-line{width:2px;flex:1;min-height:18px;margin:4px 0;
	background:linear-gradient(180deg,rgba(255,255,255,.1) 0%,transparent 100%);}
.lms-tl-body{flex:1;min-width:0;padding-top:4px;padding-bottom:18px;}
.lms-tl-title{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px;}
.lms-tl-sub{font-size:12px;color:var(--lms-text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px;}
.lms-tl-time{font-size:11px;color:var(--lms-muted);}
.lms-tl-badge{flex-shrink:0;align-self:flex-start;margin-top:6px;
	padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;}
.lms-tl-ok  {background:rgba(16,185,129,.14); color:var(--lms-green);border:1px solid rgba(16,185,129,.28);}
.lms-tl-pass{background:rgba(59,130,246,.14);  color:#60a5fa;         border:1px solid rgba(59,130,246,.28);}
.lms-tl-fail{background:rgba(239,68,68,.14);   color:#f87171;         border:1px solid rgba(239,68,68,.28);}
.lms-tl-pend{background:rgba(245,158,11,.14);  color:#fbbf24;         border:1px solid rgba(245,158,11,.28);}
.lms-tl-rev {background:rgba(59,130,246,.14);  color:#60a5fa;         border:1px solid rgba(59,130,246,.28);}

/* Right panel */
.lms-panel{display:flex;flex-direction:column;gap:14px;padding:0;}
@media(min-width:900px){.lms-panel{position:sticky;top:70px;}}
.lms-card{background:var(--lms-card);border:1px solid var(--lms-border);border-radius:var(--lms-r-lg);padding:20px;}
.lms-score-row{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:14px 0;}
.lms-score-box{background:var(--lms-glass);border:1px solid var(--lms-border);
	border-radius:var(--lms-r-md);padding:14px 10px;text-align:center;}
.lms-score-num{font-size:28px;font-weight:800;line-height:1;margin-bottom:4px;}
.lms-score-lbl{font-size:11px;color:var(--lms-muted);}
.lms-chips{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0;}
.lms-chip{font-size:12px;color:var(--lms-text2);background:var(--lms-glass);
	border:1px solid var(--lms-border);border-radius:20px;padding:4px 10px;}
.lms-chip-xs{font-size:11px;padding:2px 8px;cursor:pointer;}
.lms-chip-xs:hover{border-color:var(--lms-border2);}
.lms-chip-g{color:var(--lms-green);background:rgba(16,185,129,.08);border-color:rgba(16,185,129,.22);}
.lms-chip-r{color:var(--lms-red);  background:rgba(239,68,68,.08); border-color:rgba(239,68,68,.22);}
.lms-chip-y{color:var(--lms-yellow);background:rgba(245,158,11,.08);border-color:rgba(245,158,11,.22);}
.lms-chip-b{color:var(--lms-blue); background:rgba(59,130,246,.08);border-color:rgba(59,130,246,.22);}
.lms-bar-wrap{margin-top:8px;}
.lms-bar-row{display:flex;justify-content:space-between;font-size:12px;color:var(--lms-muted);margin-bottom:6px;}
.lms-bar-track{height:6px;background:rgba(255,255,255,.06);border-radius:99px;overflow:hidden;}
.lms-bar-fill{height:100%;border-radius:99px;width:0;transition:width .85s cubic-bezier(.4,0,.2,1);}
.lms-bar-green{background:linear-gradient(90deg,var(--lms-green),#34d399);}
.lms-asg-row{display:flex;align-items:center;justify-content:space-between;
	padding:10px 13px;background:var(--lms-glass);border:1px solid var(--lms-border);
	border-radius:var(--lms-r-md);margin-bottom:10px;}
.lms-asg-left{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--lms-text2);}
.lms-asg-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}

/* Empty */
.lms-empty{text-align:center;padding:40px 20px;}
.lms-empty-sm{padding:20px 16px;}
.lms-empty-ico{font-size:40px;margin-bottom:12px;}
.lms-empty-title{font-size:16px;font-weight:600;color:var(--lms-text2);margin-bottom:6px;}
.lms-empty-sub{font-size:13px;color:var(--lms-muted);line-height:1.6;max-width:320px;margin:0 auto;}

/* Modal */
.lms-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.78);
	backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center;
	opacity:0;transition:opacity .22s ease;}
.lms-overlay.lms-ov-in{opacity:1;}
.lms-overlay.lms-ov-out{opacity:0;}
@media(min-width:640px){.lms-overlay{align-items:center;}}
.lms-modal{background:#111c30;border:1px solid rgba(255,255,255,.1);
	border-radius:var(--lms-r-xl) var(--lms-r-xl) 0 0;
	width:100%;max-width:600px;max-height:90dvh;overflow:hidden;display:flex;flex-direction:column;
	box-shadow:0 20px 60px rgba(0,0,0,.7);
	transform:translateY(24px);transition:transform .25s cubic-bezier(.4,0,.2,1);}
.lms-modal-lg{max-width:720px;}
.lms-ov-in  .lms-modal{transform:translateY(0);}
.lms-ov-out .lms-modal{transform:translateY(24px);}
@media(min-width:640px){
	.lms-modal{border-radius:var(--lms-r-xl);margin:16px;transform:scale(.94);}
	.lms-ov-in  .lms-modal{transform:scale(1);}
	.lms-ov-out .lms-modal{transform:scale(.94);}
}
.lms-modal-hdr{display:flex;align-items:center;justify-content:space-between;
	padding:18px 20px;border-bottom:1px solid var(--lms-border);flex-shrink:0;}
.lms-modal-title{font-size:17px;font-weight:700;color:var(--lms-text);
	margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lms-modal-close{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.06);
	border:1px solid var(--lms-border);color:var(--lms-text2);cursor:pointer;
	display:flex;align-items:center;justify-content:center;font-size:16px;
	transition:all var(--lms-ease);flex-shrink:0;}
.lms-modal-close:hover{background:rgba(239,68,68,.15);color:var(--lms-red);border-color:rgba(239,68,68,.3);}
.lms-modal-body{overflow-y:auto;flex:1;padding:16px 20px 24px;
	scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.08) transparent;}
.lms-modal-load{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:140px;}
.lms-spinner{width:36px;height:36px;border:3px solid rgba(255,255,255,.08);
	border-top:3px solid var(--lms-a1);border-radius:50%;animation:lms-spin .8s linear infinite;}
@keyframes lms-spin{to{transform:rotate(360deg)}}

/* Course modal sections */
.lms-msec{margin-bottom:20px;}
.lms-msec:last-child{margin-bottom:0;}
.lms-msec-hdr{display:flex;align-items:center;gap:8px;padding:10px 14px;
	background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.2);
	border-radius:var(--lms-r-md);margin-bottom:8px;}
.lms-msec-name{flex:1;font-size:13px;font-weight:700;color:#a5b4fc;
	overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lms-msec-cnt{font-size:11px;color:var(--lms-muted);flex-shrink:0;}
.lms-ml-row{display:flex;align-items:center;gap:10px;padding:10px 14px;
	background:var(--lms-glass);border:1px solid var(--lms-border);
	border-radius:var(--lms-r-sm);margin-bottom:6px;cursor:pointer;
	transition:border-color var(--lms-ease);min-height:44px;}
.lms-ml-row:hover{border-color:var(--lms-border2);}
.lms-ml-info{flex:1;min-width:0;}
.lms-ml-name{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:4px;}
.lms-ml-chips{display:flex;flex-wrap:wrap;gap:5px;}
.ml-done{border-left:3px solid var(--lms-green)!important;}
.ml-part{border-left:3px solid var(--lms-yellow)!important;}
.ml-todo{border-left:3px solid rgba(255,255,255,.08)!important;}

/* Quiz detail */
.lms-detail-summary{background:var(--lms-glass);border:1px solid var(--lms-border);
	border-radius:var(--lms-r-md);padding:16px;margin-bottom:20px;}
.lms-ds-row{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px;}
.lms-ds-box{background:rgba(255,255,255,.04);border:1px solid var(--lms-border);
	border-radius:var(--lms-r-sm);padding:12px 16px;text-align:center;flex:1;min-width:80px;}
.lms-ds-num{font-size:22px;font-weight:800;color:var(--lms-text);margin-bottom:4px;}
.lms-ds-lbl{font-size:11px;color:var(--lms-muted);}
.lms-atmp-hdr{font-size:13px;font-weight:700;color:var(--lms-text2);margin:14px 0 8px;}
.lms-atmp-list{display:flex;flex-direction:column;gap:6px;}
.lms-atmp-row{display:flex;align-items:center;gap:8px;font-size:12px;}
.lms-atmp-num{color:var(--lms-muted);width:24px;flex-shrink:0;font-weight:600;}
.lms-atmp-bar-wrap{flex:1;height:6px;background:rgba(255,255,255,.06);border-radius:99px;overflow:hidden;}
.lms-atmp-bar{height:100%;border-radius:99px;transition:width .6s ease;}
.lms-atmp-time{color:var(--lms-muted);font-size:11px;flex-shrink:0;}
.lms-q-hdr{font-size:14px;font-weight:700;color:var(--lms-text2);margin:20px 0 10px;
	padding-bottom:8px;border-bottom:1px solid var(--lms-border);}
.lms-q-card{background:var(--lms-glass);border:1px solid var(--lms-border);
	border-radius:var(--lms-r-md);padding:14px;margin-bottom:10px;}
.lms-q-correct{border-left:3px solid var(--lms-green)!important;}
.lms-q-wrong  {border-left:3px solid var(--lms-red)!important;}
.lms-q-top{display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;}
.lms-q-idx{width:22px;height:22px;border-radius:50%;background:var(--lms-a1);
	color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;
	justify-content:center;flex-shrink:0;margin-top:1px;}
.lms-q-text{flex:1;font-size:13px;font-weight:600;color:var(--lms-text);line-height:1.5;}
.lms-q-marks{font-size:11px;color:var(--lms-muted);flex-shrink:0;margin-top:2px;}
.lms-q-answers{display:flex;flex-direction:column;gap:5px;padding-left:32px;}
.lms-opt{display:flex;align-items:center;gap:8px;padding:7px 10px;
	border-radius:var(--lms-r-sm);border:1px solid transparent;font-size:12px;color:var(--lms-text2);}
.lms-opt-correct{background:rgba(16,185,129,.1);border-color:rgba(16,185,129,.3);color:var(--lms-green);font-weight:600;}
.lms-opt-wrong  {background:rgba(239,68,68,.1); border-color:rgba(239,68,68,.3); color:var(--lms-red);  font-weight:600;}
.lms-opt-chosen {font-weight:700;}
.lms-opt-skipped{color:var(--lms-yellow);background:rgba(245,158,11,.08);border-color:rgba(245,158,11,.2);}
.lms-opt-ico{font-size:13px;flex-shrink:0;width:16px;}

/* Assignment detail */
.lms-instr{background:rgba(99,102,241,.06);border:1px solid rgba(99,102,241,.2);
	border-radius:var(--lms-r-md);padding:14px;margin-bottom:16px;}
.lms-instr-hdr{font-size:12px;font-weight:700;color:#a5b4fc;margin-bottom:8px;}
.lms-instr-body{font-size:13px;color:var(--lms-text2);line-height:1.6;}
.lms-sub-card{background:var(--lms-glass);border:1px solid var(--lms-border);
	border-radius:var(--lms-r-md);padding:14px;margin-bottom:12px;}
.lms-sub-hdr{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;}
.lms-sub-idx{font-size:12px;font-weight:700;color:var(--lms-text2);}
.lms-sub-date{font-size:11px;color:var(--lms-muted);margin-left:auto;}
.lms-sub-row{display:flex;align-items:center;gap:8px;font-size:13px;
	color:var(--lms-text2);margin-bottom:6px;}
.lms-sub-lbl{color:var(--lms-muted);flex-shrink:0;}
.lms-sub-link{color:var(--lms-a3);text-decoration:none;font-weight:600;}
.lms-sub-link:hover{text-decoration:underline;}
.lms-status-badge{display:inline-flex;align-items:center;gap:4px;
	padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;flex-shrink:0;}
.lms-status-ok  {background:rgba(16,185,129,.14);color:var(--lms-green);border:1px solid rgba(16,185,129,.3);}
.lms-status-err {background:rgba(239,68,68,.14);  color:var(--lms-red);  border:1px solid rgba(239,68,68,.3);}
.lms-status-warn{background:rgba(245,158,11,.14);color:var(--lms-yellow);border:1px solid rgba(245,158,11,.3);}
.lms-status-blue{background:rgba(59,130,246,.14); color:var(--lms-blue); border:1px solid rgba(59,130,246,.3);}
.lms-review-block{background:rgba(99,102,241,.05);border:1px solid rgba(99,102,241,.15);
	border-radius:var(--lms-r-sm);padding:12px;margin-top:10px;}
.lms-review-hdr{font-size:12px;font-weight:700;color:#a5b4fc;margin-bottom:8px;}
.lms-feedback-box{background:rgba(255,255,255,.03);border:1px solid var(--lms-border);
	border-radius:var(--lms-r-sm);padding:10px;margin-top:8px;}
.lms-feedback-lbl{font-size:11px;color:var(--lms-muted);margin-bottom:5px;}
.lms-feedback-text{font-size:13px;color:var(--lms-text2);line-height:1.6;}

/* Open answer detail */
.lms-oa-card{background:var(--lms-glass);border:1px solid var(--lms-border);
	border-radius:var(--lms-r-md);padding:14px;margin-bottom:12px;}
.lms-oa-graded  {border-left:3px solid var(--lms-green)!important;}
.lms-oa-submitted{border-left:3px solid var(--lms-yellow)!important;}
.lms-oa-pending {border-left:3px solid rgba(255,255,255,.08)!important;}
.lms-oa-question{font-size:14px;font-weight:600;color:var(--lms-text);
	line-height:1.5;margin-bottom:12px;padding:10px;
	background:rgba(255,255,255,.03);border-radius:var(--lms-r-sm);}
.lms-oa-section{margin-bottom:10px;}
.lms-oa-sec-lbl{font-size:11px;font-weight:600;color:var(--lms-muted);
	text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;}
.lms-oa-answer-box{font-size:13px;color:var(--lms-text2);line-height:1.6;
	background:rgba(255,255,255,.03);border:1px solid var(--lms-border);
	border-radius:var(--lms-r-sm);padding:10px;}
.lms-oa-correct-box{font-size:13px;color:var(--lms-green);line-height:1.6;
	background:rgba(16,185,129,.06);border:1px solid rgba(16,185,129,.2);
	border-radius:var(--lms-r-sm);padding:10px;font-weight:600;}

/* Animations */
@keyframes lms-up   {from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes lms-right{from{opacity:0;transform:translateX(-14px)}to{opacity:1;transform:translateX(0)}}

/* Reduced motion */
@media(prefers-reduced-motion:reduce){
	.lms-stat-card,.lms-course-card,.lms-tl-item{animation:none!important;opacity:1!important;transform:none!important;}
	.lms-bar-track>div,.lms-donut-arc,.lms-atmp-bar{transition:none!important;}
	.lms-spinner{animation-duration:2s;}
}

/* ─── Review Table ───────────────────────────────────────────────────────── */
.lms-review-section{padding-bottom:40px;}
.lms-rtbl-alert{display:flex;align-items:center;gap:10px;
	background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.35);
	border-radius:var(--lms-r-md);padding:12px 16px;
	font-size:13px;color:var(--lms-yellow);margin-bottom:16px;}
.lms-rtbl-alert-ico{font-size:18px;flex-shrink:0;}
.lms-rtbl-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
.lms-rtbl-filter{background:var(--lms-card);border:1px solid var(--lms-border);
	color:var(--lms-text2);border-radius:var(--lms-r-sm);padding:6px 10px;
	font-size:12px;cursor:pointer;outline:none;transition:border-color var(--lms-ease);}
.lms-rtbl-filter:focus{border-color:var(--lms-a1);}
.lms-rtbl-filter option{background:#111c30;}
.lms-rtbl-wrap{display:flex;flex-direction:column;gap:20px;}
.lms-rtbl-group-hdr{display:flex;align-items:center;gap:10px;flex-wrap:wrap;
	padding:10px 0;margin-bottom:10px;border-bottom:1px solid var(--lms-border);}
.lms-rtbl-group-name{font-size:14px;font-weight:700;color:var(--lms-text);flex:1;}
.lms-rtbl-mobile{display:none;}
.lms-rtbl-desktop{display:block;overflow-x:auto;border-radius:var(--lms-r-lg);border:1px solid var(--lms-border);}
@media(max-width:767px){
	.lms-rtbl-desktop{display:none;}
	.lms-rtbl-mobile{display:flex;flex-direction:column;gap:10px;}
}
.lms-rtbl{width:100%;border-collapse:collapse;font-size:13px;}
.lms-rtbl thead tr{background:rgba(255,255,255,.04);border-bottom:1px solid var(--lms-border);}
.lms-rtbl th{padding:12px 14px;text-align:left;font-size:11px;font-weight:700;
	color:var(--lms-muted);text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;}
.lms-rtbl tbody tr{border-bottom:1px solid var(--lms-border);transition:background var(--lms-ease);}
.lms-rtbl tbody tr:last-child{border-bottom:none;}
.lms-rtbl tbody tr:hover{background:rgba(255,255,255,.03);}
.lms-rtbl-row-warn{background:rgba(245,158,11,.05)!important;}
.lms-rtbl-row-warn:hover{background:rgba(245,158,11,.08)!important;}
.lms-rtbl td{padding:12px 14px;vertical-align:middle;}
.lms-rtbl-type-badge{display:inline-block;font-size:11px;font-weight:600;
	padding:3px 8px;border-radius:20px;background:var(--lms-glass);
	border:1px solid var(--lms-border);white-space:nowrap;color:var(--lms-text2);}
.lms-rtbl-lesson-cell{min-width:160px;max-width:200px;}
.lms-rtbl-lesson-name{font-size:13px;font-weight:600;color:var(--lms-text);
	overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lms-rtbl-detail-cell{max-width:200px;}
.lms-rtbl-detail{display:block;font-size:12px;color:var(--lms-text2);
	overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;}
.lms-rtbl-file-link{display:inline-block;margin-top:4px;font-size:11px;color:var(--lms-a3);text-decoration:none;}
.lms-rtbl-file-link:hover{text-decoration:underline;}
.lms-rtbl-retry-flag{display:inline-block;font-size:14px;margin-right:4px;flex-shrink:0;}
.lms-rtbl-retry-flag-inline{font-size:11px;color:var(--lms-yellow);font-weight:600;}
.lms-rtbl-feedback{display:flex;align-items:flex-start;gap:5px;max-width:220px;}
.lms-rtbl-feedback-ico{font-size:13px;flex-shrink:0;margin-top:1px;}
.lms-rtbl-feedback-text{font-size:12px;color:var(--lms-text2);line-height:1.5;
	display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;cursor:help;}
.lms-rtbl-no-feedback{color:var(--lms-muted);font-size:13px;}
.lms-rtbl-date{font-size:11px;color:var(--lms-muted);white-space:nowrap;}
.lms-rtbl-score{font-weight:700;}
.lms-score-hi {color:var(--lms-green);}
.lms-score-mid{color:var(--lms-yellow);}
.lms-score-lo {color:var(--lms-red);}
.lms-rtbl-btn{display:inline-flex;align-items:center;gap:5px;
	padding:6px 12px;border-radius:var(--lms-r-sm);font-size:12px;font-weight:600;
	text-decoration:none;white-space:nowrap;transition:all var(--lms-ease);}
.lms-rtbl-btn-warn{background:rgba(245,158,11,.14);border:1px solid rgba(245,158,11,.35);color:var(--lms-yellow);}
.lms-rtbl-btn-warn:hover{background:rgba(245,158,11,.24);color:var(--lms-yellow);text-decoration:none;}
.lms-rtbl-btn-blue{background:rgba(99,102,241,.14);border:1px solid rgba(99,102,241,.35);color:#a5b4fc;}
.lms-rtbl-btn-blue:hover{background:rgba(99,102,241,.24);color:#a5b4fc;text-decoration:none;}
.lms-rtbl-btn-ghost{background:transparent;border:1px solid var(--lms-border);color:var(--lms-muted);}
.lms-rtbl-btn-ghost:hover{border-color:var(--lms-border2);color:var(--lms-text2);text-decoration:none;}
.lms-rtbl-mcard{background:var(--lms-card);border:1px solid var(--lms-border);
	border-radius:var(--lms-r-md);padding:14px;display:flex;flex-direction:column;gap:8px;}
.lms-rtbl-mcard-warn{border-color:rgba(245,158,11,.35);background:rgba(245,158,11,.04);}
.lms-rtbl-mcard-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.lms-rtbl-mcard-lesson{font-size:14px;font-weight:700;color:var(--lms-text);}
.lms-rtbl-mcard-detail{font-size:12px;color:var(--lms-text2);}
.lms-rtbl-mcard-row{display:flex;align-items:center;gap:8px;font-size:13px;}
.lms-rtbl-mcard-footer{display:flex;align-items:center;justify-content:space-between;margin-top:4px;}
`;