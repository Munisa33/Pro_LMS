// ═══════════════════════════════════════════════════════════════════════════
//  LMS Student Dashboard  —  Frappe Custom Page
//  Author  : 20-year Frappe Architect
//  Version : 2.0.0  (Mobile-First, Full-Screen, Production-Grade)
// ═══════════════════════════════════════════════════════════════════════════

frappe.pages['lms_dashboard'].on_page_load = function (wrapper) {
    frappe.ui.make_app_page({
        parent: wrapper,
        title: "O'quv Dashboard",
        single_column: true
    });

    // Inject scoped CSS once — idempotent guard
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
//  MAIN CLASS
// ─────────────────────────────────────────────────────────────────────────────
class LMSDashboard {
    constructor(wrapper) {
        this.$wrapper = $(wrapper);
        this.$root = this.$wrapper.find('.layout-main-section');
        this.data = null;
        this._cache_key = 'lms_dash_cache_v2';
        this._cache_ttl = 5 * 60 * 1000; // 5 minutes

        // Force full-width layout on Frappe containers
        this._injectLayoutFix();
        this._showSkeleton();
        this._load();
    }

    // ── Layout Fix: Break out of Frappe container cage ───────────────────────
    _injectLayoutFix() {
        // Scope: only affect THIS page's containers
        const route = 'lms_dashboard';
        const containers = [
            `.page-body .container`,
            `.page-body .layout-main-section-wrapper`,
            `.page-body .layout-main-section`,
            `.page-body .page-content`,
            `.page-body .layout-side-section`
        ];

        // We set these via a scoped rule that only fires when on this page
        // The page wrapper gets data-page-route by Frappe router
        const fixCSS = `
            .frappe-app [data-page="lms_dashboard"] .page-content,
            .frappe-app [data-page="lms_dashboard"] .layout-main-section-wrapper,
            .frappe-app [data-page="lms_dashboard"] .layout-main-section,
            .frappe-app [data-page="lms_dashboard"] .container {
                max-width: 100% !important;
                width: 100% !important;
                padding: 0 !important;
                margin: 0 !important;
            }
        `;

        // Also apply direct DOM manipulation as fallback
        try {
            const pageEl = this.$wrapper[0];
            // Walk up to find .page-body and force layout
            let el = pageEl;
            for (let i = 0; i < 6; i++) {
                if (!el) break;
                if (el.classList && (
                    el.classList.contains('container') ||
                    el.classList.contains('layout-main-section-wrapper') ||
                    el.classList.contains('layout-main-section')
                )) {
                    el.style.maxWidth = '100%';
                    el.style.width = '100%';
                    el.style.padding = '0';
                    el.style.margin = '0';
                    el.style.overflowX = 'hidden';
                }
                el = el.parentElement;
            }
        } catch (e) {
            // Silent fail — CSS fallback handles it
        }

        if (!document.getElementById('lms-layout-fix')) {
            const s = document.createElement('style');
            s.id = 'lms-layout-fix';
            s.textContent = fixCSS;
            document.head.appendChild(s);
        }
    }

    // ── Skeleton Loading ─────────────────────────────────────────────────────
    _showSkeleton() {
        this.$root.html(`
            <div class="lms-wrap">
                <div class="lms-skeleton-hero">
                    <div class="lms-skel lms-skel-title"></div>
                    <div class="lms-skel lms-skel-sub"></div>
                </div>
                <div class="lms-skeleton-stats">
                    ${[1, 2, 3, 4].map(() => `<div class="lms-skel lms-skel-card"></div>`).join('')}
                </div>
                <div class="lms-skeleton-cards">
                    ${[1, 2, 3].map(() => `<div class="lms-skel lms-skel-big"></div>`).join('')}
                </div>
            </div>
        `);
    }

    // ── Data Load with Cache ─────────────────────────────────────────────────
    _load() {
        // Try cache first for instant render
        const cached = this._getCache();
        if (cached) {
            this.data = cached;
            this._render();
        }

        // Always fetch fresh data
        frappe.call({
            method: 'pro_lms.lms_for_dbr.page.lms_dashboard.lms_dashboard.get_dashboard_data',
            callback: (r) => {
                if (!r || !r.message) {
                    if (!cached) this._showError("Server bilan aloqa yo'q. Qayta urinib ko'ring.");
                    return;
                }
                if (r.message.error) {
                    if (!cached) this._showError(
                        r.message.message ||
                        "Ma'lumot topilmadi. HR modulida Employee → User bog'lash kerak."
                    );
                    return;
                }
                this.data = r.message;
                this._setCache(r.message);
                this._render();
            },
            error: (err) => {
                if (!cached) {
                    this._showError("Xatolik yuz berdi: " + (err.message || "Noma'lum xato"));
                }
            }
        });
    }

    _getCache() {
        try {
            const raw = localStorage.getItem(this._cache_key);
            if (!raw) return null;
            const { data, ts } = JSON.parse(raw);
            if (Date.now() - ts > this._cache_ttl) {
                localStorage.removeItem(this._cache_key);
                return null;
            }
            return data;
        } catch (e) { return null; }
    }

    _setCache(data) {
        try {
            localStorage.setItem(this._cache_key, JSON.stringify({ data, ts: Date.now() }));
        } catch (e) { /* localStorage might be full */ }
    }

    _showError(msg) {
        this.$root.html(`
            <div class="lms-wrap">
                <div class="lms-error-state">
                    <div class="lms-error-icon">⚠️</div>
                    <div class="lms-error-title">Xatolik</div>
                    <div class="lms-error-msg">${this._esc(msg)}</div>
                    <button class="lms-retry-btn" onclick="window.lms_dash && window.lms_dash._load()">
                        🔄 Qayta urinish
                    </button>
                </div>
            </div>
        `);
    }

    // ── Main Render ──────────────────────────────────────────────────────────
    _render() {
        const d = this.data;

        // Defensive: ensure all expected keys exist
        const emp = d.employee || {};
        const myC = Array.isArray(d.my_courses) ? d.my_courses : [];
        const tl = Array.isArray(d.activity_timeline) ? d.activity_timeline : [];
        const qp = d.quiz_performance || { best_score: 0, last_score: 0, total_attempts: 0, passed: 0 };
        const asgn = d.assignment_summary || { pending: 0, approved: 0, rejected: 0 };
        const pct = typeof d.overall_progress === 'number' ? d.overall_progress : 0;
        const done = typeof d.done_lessons === 'number' ? d.done_lessons : 0;
        const total = typeof d.total_lessons === 'number' ? d.total_lessons : 0;

        const h = new Date().getHours();
        const greeting = h < 5 ? 'Xayrli tun' : h < 12 ? 'Xayrli tong' : h < 17 ? 'Xayrli kun' : 'Xayrli kech';

        // SVG Donut
        const R = 44;
        const C = parseFloat((2 * Math.PI * R).toFixed(2));
        const dashOffset = parseFloat((C - (pct / 100) * C).toFixed(2));

        // Next lesson for mobile CTA
        const nextLesson = myC.find(c => !c.is_completed && c.next_lesson);

        this.$root.html(`
        <div class="lms-wrap">

            <!-- SVG Defs -->
            <svg width="0" height="0" style="position:absolute;overflow:hidden;pointer-events:none" aria-hidden="true">
                <defs>
                    <linearGradient id="lmsDonutGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%"   stop-color="var(--lms-accent-1)"/>
                        <stop offset="100%" stop-color="var(--lms-accent-2)"/>
                    </linearGradient>
                    <linearGradient id="lmsHeroGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%"   stop-color="#0f172a"/>
                        <stop offset="100%" stop-color="#1e1b4b"/>
                    </linearGradient>
                </defs>
            </svg>

            <!-- ═══ HERO SECTION ═══ -->
            <div class="lms-hero">
                <div class="lms-hero-bg-dots" aria-hidden="true"></div>
                <div class="lms-hero-content">
                    <div class="lms-hero-left">
                        <div class="lms-hero-greeting">${greeting} 👋</div>
                        <h1 class="lms-hero-name">${this._esc(emp.employee_name || 'Foydalanuvchi')}</h1>
                        <div class="lms-hero-meta">
                            ${emp.department ? `<span class="lms-hero-dept">🏢 ${this._esc(emp.department)}</span>` : ''}
                            ${emp.designation ? `<span class="lms-hero-desig">💼 ${this._esc(emp.designation)}</span>` : ''}
                        </div>
                        <!-- Mobile: Next Lesson CTA -->
                        ${nextLesson
                ? `<a class="lms-hero-cta" href="/app/lms-player?lesson=${encodeURIComponent(nextLesson.next_lesson)}">
                                   ▶ Davom etish — ${this._esc(nextLesson.course_name)}
                               </a>`
                : myC.length === 0
                    ? `<div class="lms-hero-cta lms-hero-cta-inactive">📭 Hali kurs biriktirilmagan</div>`
                    : `<div class="lms-hero-cta lms-hero-cta-done">🏆 Barcha kurslar yakunlangan</div>`
            }
                    </div>
                    <div class="lms-hero-right">
                        <div class="lms-donut-container" role="img" aria-label="Umumiy progress ${pct}%">
                            <svg class="lms-donut-svg" viewBox="0 0 110 110" width="120" height="120">
                                <circle class="lms-donut-track" cx="55" cy="55" r="${R}"/>
                                <circle class="lms-donut-progress" cx="55" cy="55" r="${R}"
                                        stroke-dasharray="${C}"
                                        stroke-dashoffset="${C}"
                                        data-offset="${dashOffset}"/>
                            </svg>
                            <div class="lms-donut-center">
                                <span class="lms-donut-pct" id="lms-pct-num">${pct}</span>
                                <span class="lms-donut-symbol">%</span>
                                <span class="lms-donut-label">Progress</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ═══ STATS ROW ═══ -->
            <div class="lms-stats-row">
                ${this._statCard('📚', myC.length, "Kurslar", "Biriktirilgan")}
                ${this._statCard('✅', `${done}<span class="lms-stat-sep">/${total}</span>`, "Darslar", "Bajarilgan")}
                ${this._statCard('🏆', `${qp.best_score}<span class="lms-stat-sym">%</span>`, "Eng yuqori", "Quiz bali")}
                ${this._statCard('📝', asgn.pending, "Topshiriq", "Kutilmoqda")}
            </div>

            <!-- ═══ COURSES ═══ -->
            <section class="lms-section" aria-labelledby="lms-courses-heading">
                <div class="lms-section-header">
                    <h2 class="lms-section-title" id="lms-courses-heading">
                        <span class="lms-section-icon">🎓</span>
                        Mening Kurslarim
                    </h2>
                    <span class="lms-section-count">${myC.length} ta kurs</span>
                </div>

                ${myC.length > 0
                ? `<div class="lms-courses-grid">
                           ${myC.map(c => this._courseCard(c)).join('')}
                       </div>`
                : `<div class="lms-empty-state">
                           <div class="lms-empty-icon">📭</div>
                           <div class="lms-empty-title">Hali kurs yo'q</div>
                           <div class="lms-empty-sub">Administrator siz uchun kurs biriktirgach bu yerda ko'rinadi</div>
                       </div>`
            }
            </section>

            <!-- ═══ BOTTOM GRID ═══ -->
            <div class="lms-bottom-grid">

                <!-- TIMELINE -->
                <section class="lms-timeline-section" aria-labelledby="lms-tl-heading">
                    <div class="lms-section-header">
                        <h2 class="lms-section-title" id="lms-tl-heading">
                            <span class="lms-section-icon">⚡</span>
                            Faoliyat Tarixi
                        </h2>
                        ${tl.length > 0 ? `<span class="lms-section-count">${tl.length} ta hodisa</span>` : ''}
                    </div>
                    <div class="lms-timeline-wrap">
                        ${tl.length > 0
                ? `<div class="lms-timeline">
                                   ${tl.map((item, i) => this._tlItem(item, i, tl.length)).join('')}
                               </div>`
                : `<div class="lms-empty-state lms-empty-sm">
                                   <div class="lms-empty-icon">💤</div>
                                   <div class="lms-empty-title">Faoliyat yo'q</div>
                                   <div class="lms-empty-sub">Dars ko'rgach yoki quiz yechgach bu yerda ko'rinadi</div>
                               </div>`
            }
                    </div>
                </section>

                <!-- RIGHT PANEL -->
                <div class="lms-right-panel">

                    <!-- QUIZ PERFORMANCE -->
                    <section class="lms-card lms-quiz-card" aria-labelledby="lms-quiz-heading">
                        <h2 class="lms-section-title" id="lms-quiz-heading">
                            <span class="lms-section-icon">🧠</span>
                            Quiz Natijalari
                        </h2>
                        ${qp.total_attempts > 0
                ? `<div class="lms-quiz-scores">
                                   <div class="lms-score-pill lms-score-best">
                                       <div class="lms-score-val">${qp.best_score}%</div>
                                       <div class="lms-score-lbl">Eng yuqori</div>
                                   </div>
                                   <div class="lms-score-pill lms-score-last">
                                       <div class="lms-score-val">${qp.last_score}%</div>
                                       <div class="lms-score-lbl">Oxirgi</div>
                                   </div>
                               </div>
                               <div class="lms-quiz-meta">
                                   <span class="lms-meta-chip">
                                       🎯 Jami urinish: <strong>${qp.total_attempts}</strong>
                                   </span>
                                   <span class="lms-meta-chip lms-chip-green">
                                       ✓ O'tdi: <strong>${qp.passed}</strong>
                                   </span>
                                   <span class="lms-meta-chip lms-chip-red">
                                       ✗ O'tmadi: <strong>${qp.total_attempts - qp.passed}</strong>
                                   </span>
                               </div>
                               ${qp.total_attempts > 0
                    ? `<div class="lms-pass-bar-wrap">
                                          <div class="lms-pass-bar-label">
                                              <span>O'tish darajasi</span>
                                              <span>${Math.round((qp.passed / qp.total_attempts) * 100)}%</span>
                                          </div>
                                          <div class="lms-pass-bar-track">
                                              <div class="lms-pass-bar-fill"
                                                   style="width:0%"
                                                   data-width="${Math.round((qp.passed / qp.total_attempts) * 100)}%">
                                              </div>
                                          </div>
                                      </div>`
                    : ''
                }`
                : `<div class="lms-empty-state lms-empty-sm">
                                   <div class="lms-empty-icon">🎯</div>
                                   <div class="lms-empty-sub">Hali quiz yechilmagan</div>
                               </div>`
            }
                    </section>

                    <!-- ASSIGNMENTS -->
                    <section class="lms-card lms-assign-card" aria-labelledby="lms-asgn-heading">
                        <h2 class="lms-section-title" id="lms-asgn-heading">
                            <span class="lms-section-icon">📋</span>
                            Topshiriqlar
                        </h2>
                        <div class="lms-assign-list">
                            ${this._assignRow('#f59e0b', '⏳', 'Kutilmoqda', asgn.pending, 'lms-chip-yellow')}
                            ${this._assignRow('#10b981', '✓', 'Tasdiqlangan', asgn.approved, 'lms-chip-green')}
                            ${this._assignRow('#ef4444', '✗', 'Rad etilgan', asgn.rejected, 'lms-chip-red')}
                        </div>
                        ${(asgn.pending + asgn.approved + asgn.rejected) === 0
                ? `<div class="lms-assign-empty">Hali topshiriq yo'q</div>`
                : ''
            }
                    </section>

                </div>
            </div>

            <!-- Footer spacer for mobile -->
            <div class="lms-footer-space"></div>

        </div>`);

        // ── Post-render Animations ───────────────────────────────────────────
        this._runAnimations();
    }

    // ── Animations ───────────────────────────────────────────────────────────
    _runAnimations() {
        // Use double rAF to ensure DOM painted
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const root = this.$root[0];
            if (!root) return;

            // 1. Donut progress animation
            const donut = root.querySelector('.lms-donut-progress');
            if (donut && donut.dataset.offset !== undefined) {
                donut.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1)';
                donut.style.strokeDashoffset = donut.dataset.offset;
            }

            // 2. Counter animation for donut percentage
            const pctEl = root.querySelector('#lms-pct-num');
            if (pctEl) {
                const target = parseInt(pctEl.textContent) || 0;
                let current = 0;
                const step = Math.max(1, Math.ceil(target / 60));
                const timer = setInterval(() => {
                    current = Math.min(current + step, target);
                    pctEl.textContent = current;
                    if (current >= target) clearInterval(timer);
                }, 16);
            }

            // 3. Course progress bars
            root.querySelectorAll('.lms-prog-fill[data-width]').forEach((el, i) => {
                setTimeout(() => {
                    el.style.width = el.dataset.width;
                }, i * 80);
            });

            // 4. Quiz pass rate bar
            root.querySelectorAll('.lms-pass-bar-fill[data-width]').forEach(el => {
                setTimeout(() => {
                    el.style.width = el.dataset.width;
                }, 400);
            });

            // 5. Stagger fade-in for stat cards
            root.querySelectorAll('.lms-stat-card').forEach((el, i) => {
                el.style.animationDelay = `${i * 80}ms`;
                el.classList.add('lms-anim-in');
            });

            // 6. Stagger fade-in for course cards
            root.querySelectorAll('.lms-course-card').forEach((el, i) => {
                el.style.animationDelay = `${100 + i * 60}ms`;
                el.classList.add('lms-anim-in');
            });

            // 7. Timeline items
            root.querySelectorAll('.lms-tl-item').forEach((el, i) => {
                el.style.animationDelay = `${i * 50}ms`;
                el.classList.add('lms-anim-in');
            });
        }));
    }

    // ── Course Card ───────────────────────────────────────────────────────────
    _courseCard(c) {
        if (!c || typeof c !== 'object') return '';

        const pct = typeof c.progress_pct === 'number' ? c.progress_pct : 0;
        const done = typeof c.done_lessons === 'number' ? c.done_lessons : 0;
        const total = typeof c.total_lessons === 'number' ? c.total_lessons : 0;

        const colorClass = c.is_completed ? 'lms-prog-done'
            : pct >= 70 ? 'lms-prog-green'
                : pct >= 35 ? 'lms-prog-yellow'
                    : 'lms-prog-red';

        const thumb = c.image
            ? `<img src="${this._esc(c.image)}" alt="${this._esc(c.course_name)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'lms-thumb-fallback\\'>🎓</div>'">`
            : `<div class="lms-thumb-fallback">🎓</div>`;

        const statusBadge = c.is_completed
            ? `<span class="lms-badge lms-badge-done">✓ Yakunlangan</span>`
            : `<span class="lms-badge lms-badge-active">● Davom etmoqda</span>`;

        const ctaBtn = c.is_completed
            ? `<span class="lms-cta-btn lms-cta-done">✓ Tugatildi</span>`
            : c.next_lesson
                ? `<a class="lms-cta-btn lms-cta-active"
                      href="/app/lms-player?lesson=${encodeURIComponent(c.next_lesson)}"
                      onclick="event.stopPropagation()"
                      aria-label="${this._esc(c.course_name)} — Davom etish">
                       ▶ Davom etish
                   </a>`
                : `<span class="lms-cta-btn lms-cta-done">✓ Tugatildi</span>`;

        // Safe values for onclick attribute
        const safeId = this._esc(c.course || '');
        const safeName = (c.course_name || '').replace(/['"\\<>]/g, '');

        return `
        <article class="lms-course-card"
                 role="button"
                 tabindex="0"
                 aria-label="${this._esc(c.course_name)} — ${pct}% yakunlangan"
                 onclick="window.lms_dash && window.lms_dash._openModal('${safeId}','${safeName}')"
                 onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.lms_dash&&window.lms_dash._openModal('${safeId}','${safeName}');}">
            <div class="lms-card-thumb">
                ${thumb}
                ${statusBadge}
            </div>
            <div class="lms-card-body">
                <div class="lms-card-name">${this._esc(c.course_name || '')}</div>
                ${c.description
                ? `<div class="lms-card-desc">${this._esc(c.description)}</div>`
                : ''}
                <div class="lms-prog-wrap">
                    <div class="lms-prog-header">
                        <span class="lms-prog-lessons">${done}/${total} dars</span>
                        <span class="lms-prog-pct">${pct}%</span>
                    </div>
                    <div class="lms-prog-track" role="progressbar"
                         aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
                        <div class="lms-prog-fill ${colorClass}"
                             style="width: 0%"
                             data-width="${pct}%">
                        </div>
                    </div>
                </div>
            </div>
            <div class="lms-card-footer">
                ${ctaBtn}
            </div>
        </article>`;
    }

    // ── Timeline Item ────────────────────────────────────────────────────────
    _tlItem(t, index, total) {
        if (!t || typeof t !== 'object') return '';

        const isLesson = t.type === 'lesson';
        const dotClass = isLesson ? 'lms-dot-lesson' : 'lms-dot-quiz';
        const icon = isLesson ? '▶' : '🧠';
        const isLast = index === total - 1;

        let badge = '';
        if (isLesson) {
            badge = `<span class="lms-tl-badge lms-tl-check" aria-label="Bajarildi">✓</span>`;
        } else {
            const score = typeof t.value === 'number' ? t.value : (parseInt(t.value) || 0);
            const passed = t.extra === 'passed';
            badge = `<span class="lms-tl-badge ${passed ? 'lms-tl-passed' : 'lms-tl-failed'}"
                           aria-label="${passed ? "O'tdi" : "O'tmadi"}: ${score}%">${score}%</span>`;
        }

        return `
        <div class="lms-tl-item" role="listitem">
            <div class="lms-tl-left">
                <div class="lms-tl-dot ${dotClass}" aria-hidden="true">${icon}</div>
                ${!isLast ? `<div class="lms-tl-line" aria-hidden="true"></div>` : ''}
            </div>
            <div class="lms-tl-body">
                <div class="lms-tl-title">${this._esc(t.title || '')}</div>
                <div class="lms-tl-sub">${this._esc(t.subtitle || '')}</div>
                <div class="lms-tl-time">🕐 ${this._esc(t.time || '')}</div>
            </div>
            ${badge}
        </div>`;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────
    _statCard(icon, val, label, sub) {
        return `
        <div class="lms-stat-card" role="group" aria-label="${label}: ${sub}">
            <div class="lms-stat-icon" aria-hidden="true">${icon}</div>
            <div class="lms-stat-val">${val}</div>
            <div class="lms-stat-label">${label}</div>
            <div class="lms-stat-sub">${sub}</div>
        </div>`;
    }

    _assignRow(color, icon, label, count, chipClass) {
        return `
        <div class="lms-assign-row">
            <div class="lms-assign-left">
                <div class="lms-assign-dot" style="background:${color}" aria-hidden="true"></div>
                <span>${icon} ${label}</span>
            </div>
            <span class="lms-assign-count ${chipClass}">${count}</span>
        </div>`;
    }

    // XSS-safe escaper — handles null/undefined/non-string
    _esc(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/\//g, '&#x2F;');
    }

    // ── Course Detail Modal ──────────────────────────────────────────────────
    _openModal(course, courseName) {
        if (!course) return;

        // Remove existing modals
        document.querySelectorAll('.lms-modal-overlay').forEach(el => el.remove());

        const overlay = document.createElement('div');
        overlay.className = 'lms-modal-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', `${courseName} — kurs tafsilotlari`);

        overlay.innerHTML = `
        <div class="lms-modal">
            <div class="lms-modal-head">
                <div class="lms-modal-title">
                    <span class="lms-modal-icon" aria-hidden="true">🎓</span>
                    <h3>${this._esc(courseName)}</h3>
                </div>
                <button class="lms-modal-close" aria-label="Yopish">✕</button>
            </div>
            <div class="lms-modal-body">
                <div class="lms-modal-loading">
                    <div class="lms-spinner" aria-label="Yuklanmoqda"></div>
                    <div style="margin-top:12px;color:var(--lms-text-muted);font-size:14px">Yuklanmoqda...</div>
                </div>
            </div>
        </div>`;

        document.body.appendChild(overlay);

        // Prevent body scroll on mobile
        document.body.style.overflow = 'hidden';

        const close = () => {
            overlay.classList.add('lms-modal-closing');
            document.body.style.overflow = '';
            setTimeout(() => overlay.remove(), 200);
            document.removeEventListener('keydown', escHandler);
        };

        const closeBtn = overlay.querySelector('.lms-modal-close');
        if (closeBtn) closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        const escHandler = e => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', escHandler);

        // Animate in
        requestAnimationFrame(() => overlay.classList.add('lms-modal-visible'));

        // Fetch course detail
        frappe.call({
            method: 'pro_lms.lms_for_dbr.page.lms_dashboard.lms_dashboard.get_course_detail',
            args: { course },
            callback: (r) => {
                const body = overlay.querySelector('.lms-modal-body');
                if (!body) return;

                if (!r || !r.message || !r.message.sections) {
                    body.innerHTML = `
                        <div class="lms-empty-state">
                            <div class="lms-empty-icon">📭</div>
                            <div class="lms-empty-title">Ma'lumot topilmadi</div>
                        </div>`;
                    return;
                }

                const sections = r.message.sections;
                if (!sections.length) {
                    body.innerHTML = `
                        <div class="lms-empty-state">
                            <div class="lms-empty-icon">📭</div>
                            <div class="lms-empty-title">Darslar topilmadi</div>
                        </div>`;
                    return;
                }

                let html = '';
                sections.forEach(sec => {
                    const lessons = Array.isArray(sec.lessons) ? sec.lessons : [];
                    const secDone = lessons.filter(l => l.is_completed).length;

                    html += `
                    <div class="lms-modal-section">
                        <div class="lms-modal-sec-head">
                            <span class="lms-modal-sec-icon" aria-hidden="true">📂</span>
                            <span class="lms-modal-sec-title">${this._esc(sec.section_title || '')}</span>
                            <span class="lms-modal-sec-count">${secDone}/${lessons.length}</span>
                        </div>
                        <div class="lms-modal-lessons">
                            ${lessons.map(l => this._modalLesson(l)).join('')}
                        </div>
                    </div>`;
                });

                body.innerHTML = html;
            },
            error: () => {
                const body = overlay.querySelector('.lms-modal-body');
                if (body) body.innerHTML = `
                    <div class="lms-empty-state">
                        <div class="lms-empty-icon">⚠️</div>
                        <div class="lms-empty-title">Xatolik yuz berdi</div>
                    </div>`;
            }
        });
    }

    _modalLesson(l) {
        if (!l || typeof l !== 'object') return '';

        const iconMap = { Video: '🎬', Assignment: '📝', Quiz: '🧠', Article: '📖' };
        const icon = iconMap[l.type] || '📄';

        let statusIcon, statusClass;
        if (l.is_completed) {
            statusIcon = '✅';
            statusClass = 'lms-lesson-done';
        } else if (l.completion_percent > 0) {
            statusIcon = '🔄';
            statusClass = 'lms-lesson-partial';
        } else {
            statusIcon = '⭕';
            statusClass = 'lms-lesson-todo';
        }

        const pctTag = (!l.is_completed && l.completion_percent > 0)
            ? `<span class="lms-lesson-pct">${l.completion_percent}%</span>`
            : '';

        return `
        <div class="lms-lesson-row ${statusClass}"
             role="button" tabindex="0"
             style="cursor:pointer"
             onclick="window.location.href='/app/lms-player?lesson=${encodeURIComponent(l.name)}'"
             onkeydown="if(event.key==='Enter'){window.location.href='/app/lms-player?lesson=${encodeURIComponent(l.name)}'}"
             title="${this._esc(l.lesson_title || '')} — ochish">
            <span class="lms-lesson-type-icon" aria-hidden="true">${icon}</span>
            <span class="lms-lesson-name">${this._esc(l.lesson_title || '')}</span>
            ${pctTag}
            <span class="lms-lesson-status" aria-label="${l.is_completed ? 'Bajarildi' : 'Bajarilmadi'}">${statusIcon}</span>
        </div>`;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  CSS — Mobile-First, Scoped, Production-Grade
// ─────────────────────────────────────────────────────────────────────────────
const LMS_CSS = `
/* ═══════════════════════════════════════════════════════════
   CSS CUSTOM PROPERTIES
═══════════════════════════════════════════════════════════ */
:root {
    --lms-bg         : #0a0f1e;
    --lms-bg-card    : #111827;
    --lms-bg-glass   : rgba(255,255,255,0.04);
    --lms-border     : rgba(255,255,255,0.08);
    --lms-border-hov : rgba(255,255,255,0.16);

    --lms-text-1     : #f1f5f9;
    --lms-text-2     : #94a3b8;
    --lms-text-muted : #64748b;

    --lms-accent-1   : #6366f1;
    --lms-accent-2   : #8b5cf6;
    --lms-accent-3   : #06b6d4;

    --lms-green      : #10b981;
    --lms-yellow     : #f59e0b;
    --lms-red        : #ef4444;
    --lms-blue       : #3b82f6;

    --lms-radius-sm  : 8px;
    --lms-radius-md  : 14px;
    --lms-radius-lg  : 20px;
    --lms-radius-xl  : 28px;

    --lms-shadow-sm  : 0 1px 3px rgba(0,0,0,0.4);
    --lms-shadow-md  : 0 4px 24px rgba(0,0,0,0.5);
    --lms-shadow-lg  : 0 8px 48px rgba(0,0,0,0.6);

    --lms-transition : 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}

/* ═══════════════════════════════════════════════════════════
   FRAPPE LAYOUT OVERRIDE — Scoped to this page only
═══════════════════════════════════════════════════════════ */
.lms-wrap,
.lms-wrap * {
    box-sizing: border-box;
}

/* Force full-width */
.lms-wrap {
    width             : 100%;
    min-height        : calc(100vh - 60px);
    background        : var(--lms-bg);
    color             : var(--lms-text-1);
    font-family       : 'Segoe UI', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif;
    -webkit-font-smoothing: antialiased;
    overflow-x        : hidden;
}

/* ═══════════════════════════════════════════════════════════
   SKELETON LOADING
═══════════════════════════════════════════════════════════ */
.lms-skel {
    background: linear-gradient(90deg, #1e293b 25%, #334155 50%, #1e293b 75%);
    background-size: 200% 100%;
    animation: lms-shimmer 1.5s infinite;
    border-radius: var(--lms-radius-md);
}
@keyframes lms-shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}
.lms-skeleton-hero   { padding: 32px 20px; }
.lms-skel-title      { height: 36px; width: 60%; margin-bottom: 12px; }
.lms-skel-sub        { height: 20px; width: 40%; }
.lms-skeleton-stats  { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; padding: 0 16px 16px; }
.lms-skel-card       { height: 90px; }
.lms-skeleton-cards  { display: grid; grid-template-columns: 1fr; gap: 12px; padding: 0 16px; }
.lms-skel-big        { height: 180px; }

@media (min-width: 768px) {
    .lms-skeleton-stats  { grid-template-columns: repeat(4, 1fr); }
    .lms-skeleton-cards  { grid-template-columns: repeat(3, 1fr); }
}

/* ═══════════════════════════════════════════════════════════
   ERROR STATE
═══════════════════════════════════════════════════════════ */
.lms-error-state {
    display        : flex;
    flex-direction : column;
    align-items    : center;
    justify-content: center;
    min-height     : 60vh;
    padding        : 32px 20px;
    text-align     : center;
    gap            : 12px;
}
.lms-error-icon  { font-size: 48px; }
.lms-error-title { font-size: 22px; font-weight: 700; color: var(--lms-text-1); }
.lms-error-msg   { font-size: 14px; color: var(--lms-text-2); max-width: 420px; line-height: 1.6; }
.lms-retry-btn {
    margin-top     : 8px;
    padding        : 12px 28px;
    background     : var(--lms-accent-1);
    color          : #fff;
    border         : none;
    border-radius  : var(--lms-radius-md);
    font-size      : 14px;
    font-weight    : 600;
    cursor         : pointer;
    transition     : background var(--lms-transition);
}
.lms-retry-btn:hover { background: var(--lms-accent-2); }

/* ═══════════════════════════════════════════════════════════
   HERO SECTION
═══════════════════════════════════════════════════════════ */
.lms-hero {
    position        : relative;
    overflow        : hidden;
    background      : linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0c1a2e 100%);
    padding         : 28px 16px 32px;
    border-bottom   : 1px solid var(--lms-border);
}

/* Decorative background dots */
.lms-hero-bg-dots {
    position        : absolute;
    inset           : 0;
    pointer-events  : none;
    background-image:
        radial-gradient(circle at 20% 30%, rgba(99,102,241,0.15) 0%, transparent 50%),
        radial-gradient(circle at 80% 70%, rgba(139,92,246,0.12) 0%, transparent 50%),
        radial-gradient(circle at 60% 10%, rgba(6,182,212,0.08) 0%, transparent 40%);
}

.lms-hero-content {
    position       : relative;
    z-index        : 1;
    display        : flex;
    align-items    : center;
    justify-content: space-between;
    gap            : 16px;
    max-width      : 1400px;
    margin         : 0 auto;
}

.lms-hero-left {
    flex     : 1;
    min-width: 0;
}

.lms-hero-greeting {
    font-size   : 13px;
    font-weight : 500;
    color       : var(--lms-accent-3);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom : 6px;
}

.lms-hero-name {
    font-size  : clamp(22px, 5vw, 36px);
    font-weight: 800;
    color      : var(--lms-text-1);
    margin     : 0 0 8px;
    line-height: 1.2;
    overflow   : hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.lms-hero-meta {
    display    : flex;
    flex-wrap  : wrap;
    gap        : 8px;
    margin-bottom: 20px;
}

.lms-hero-dept,
.lms-hero-desig {
    font-size   : 12px;
    color       : var(--lms-text-2);
    background  : rgba(255,255,255,0.06);
    border      : 1px solid var(--lms-border);
    border-radius: 20px;
    padding     : 3px 10px;
}

.lms-hero-cta {
    display        : inline-flex;
    align-items    : center;
    gap            : 8px;
    padding        : 12px 20px;
    background     : linear-gradient(135deg, var(--lms-accent-1), var(--lms-accent-2));
    color          : #fff;
    text-decoration: none;
    border-radius  : var(--lms-radius-md);
    font-size      : 14px;
    font-weight    : 600;
    box-shadow     : 0 4px 20px rgba(99,102,241,0.4);
    transition     : transform var(--lms-transition), box-shadow var(--lms-transition);
    max-width      : 100%;
    overflow       : hidden;
    text-overflow  : ellipsis;
    white-space    : nowrap;
}
.lms-hero-cta:hover {
    transform  : translateY(-2px);
    box-shadow : 0 6px 28px rgba(99,102,241,0.55);
    color      : #fff;
    text-decoration: none;
}
.lms-hero-cta-inactive {
    background   : rgba(255,255,255,0.08);
    box-shadow   : none;
    border       : 1px solid var(--lms-border);
    color        : var(--lms-text-2);
    cursor       : default;
}
.lms-hero-cta-inactive:hover { transform: none; box-shadow: none; }
.lms-hero-cta-done {
    background : rgba(16,185,129,0.15);
    border     : 1px solid rgba(16,185,129,0.3);
    box-shadow : none;
    color      : var(--lms-green);
    cursor     : default;
}
.lms-hero-cta-done:hover { transform: none; box-shadow: none; }

/* DONUT */
.lms-hero-right { flex-shrink: 0; }

.lms-donut-container {
    position: relative;
    width   : 120px;
    height  : 120px;
}

.lms-donut-svg {
    transform: rotate(-90deg);
    display  : block;
}

.lms-donut-track {
    fill           : none;
    stroke         : rgba(255,255,255,0.06);
    stroke-width   : 8;
}

.lms-donut-progress {
    fill             : none;
    stroke           : url(#lmsDonutGrad);
    stroke-width     : 8;
    stroke-linecap   : round;
    stroke-dashoffset: 276.46;
    /* transition set via JS */
}

.lms-donut-center {
    position       : absolute;
    inset          : 0;
    display        : flex;
    flex-direction : column;
    align-items    : center;
    justify-content: center;
    line-height    : 1;
    pointer-events : none;
}

.lms-donut-pct {
    font-size  : 26px;
    font-weight: 800;
    color      : var(--lms-text-1);
    line-height: 1;
}
.lms-donut-symbol {
    font-size  : 13px;
    font-weight: 600;
    color      : var(--lms-accent-1);
    margin-top : 1px;
}
.lms-donut-label {
    font-size  : 10px;
    color      : var(--lms-text-muted);
    margin-top : 3px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

/* ═══════════════════════════════════════════════════════════
   STATS ROW
═══════════════════════════════════════════════════════════ */
.lms-stats-row {
    display              : grid;
    grid-template-columns: repeat(2, 1fr);
    gap                  : 10px;
    padding              : 16px;
    max-width            : 1400px;
    margin               : 0 auto;
}

@media (min-width: 600px) {
    .lms-stats-row { grid-template-columns: repeat(4, 1fr); }
}

.lms-stat-card {
    background   : var(--lms-bg-card);
    border       : 1px solid var(--lms-border);
    border-radius: var(--lms-radius-lg);
    padding      : 16px 14px;
    text-align   : center;
    opacity      : 0;
    transform    : translateY(16px);
    transition   : border-color var(--lms-transition), transform var(--lms-transition);
}
.lms-stat-card:hover {
    border-color: var(--lms-border-hov);
    transform   : translateY(-2px) !important;
}
.lms-stat-card.lms-anim-in {
    animation: lms-fade-up 0.5s var(--lms-transition) forwards;
}
.lms-stat-icon  { font-size: 24px; margin-bottom: 6px; }
.lms-stat-val   {
    font-size  : clamp(20px, 4vw, 28px);
    font-weight: 800;
    color      : var(--lms-text-1);
    line-height: 1.1;
}
.lms-stat-val .lms-stat-sep { color: var(--lms-text-muted); font-size: 0.65em; }
.lms-stat-val .lms-stat-sym { color: var(--lms-accent-1);   font-size: 0.6em; }
.lms-stat-label {
    font-size  : 13px;
    font-weight: 600;
    color      : var(--lms-text-1);
    margin-top : 4px;
}
.lms-stat-sub {
    font-size: 11px;
    color    : var(--lms-text-muted);
    margin-top: 2px;
}

/* ═══════════════════════════════════════════════════════════
   SECTION HEADER
═══════════════════════════════════════════════════════════ */
.lms-section {
    padding  : 0 16px 8px;
    max-width: 1400px;
    margin   : 0 auto;
}

.lms-section-header {
    display        : flex;
    align-items    : center;
    justify-content: space-between;
    margin-bottom  : 14px;
    padding-top    : 24px;
}

.lms-section-title {
    display    : flex;
    align-items: center;
    gap        : 8px;
    font-size  : 18px;
    font-weight: 700;
    color      : var(--lms-text-1);
    margin     : 0;
    line-height: 1.3;
}
.lms-section-icon { font-size: 20px; flex-shrink: 0; }
.lms-section-count {
    font-size   : 12px;
    font-weight : 500;
    color       : var(--lms-text-muted);
    background  : var(--lms-bg-glass);
    border      : 1px solid var(--lms-border);
    border-radius: 20px;
    padding     : 3px 10px;
    white-space : nowrap;
}

/* ═══════════════════════════════════════════════════════════
   COURSES GRID
═══════════════════════════════════════════════════════════ */
.lms-courses-grid {
    display              : grid;
    grid-template-columns: 1fr;
    gap                  : 14px;
}

@media (min-width: 640px) {
    .lms-courses-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (min-width: 1024px) {
    .lms-courses-grid { grid-template-columns: repeat(3, 1fr); }
}
@media (min-width: 1400px) {
    .lms-courses-grid { grid-template-columns: repeat(4, 1fr); }
}

.lms-course-card {
    background    : var(--lms-bg-card);
    border        : 1px solid var(--lms-border);
    border-radius : var(--lms-radius-lg);
    overflow      : hidden;
    cursor        : pointer;
    display       : flex;
    flex-direction: column;
    opacity       : 0;
    transform     : translateY(20px);
    transition    : border-color var(--lms-transition), transform var(--lms-transition), box-shadow var(--lms-transition);
    -webkit-tap-highlight-color: transparent;
    user-select   : none;
}
.lms-course-card.lms-anim-in {
    animation: lms-fade-up 0.5s var(--lms-transition) forwards;
}
.lms-course-card:hover,
.lms-course-card:focus-visible {
    border-color: var(--lms-accent-1);
    box-shadow  : 0 0 0 1px var(--lms-accent-1), var(--lms-shadow-md);
    transform   : translateY(-3px) !important;
    outline     : none;
}
.lms-course-card:active { transform: scale(0.985) !important; }

.lms-card-thumb {
    position    : relative;
    height      : 140px;
    background  : linear-gradient(135deg, #1e293b, #0f172a);
    overflow    : hidden;
    flex-shrink : 0;
}
.lms-card-thumb img {
    width     : 100%;
    height    : 100%;
    object-fit: cover;
    display   : block;
    transition: transform 0.4s ease;
}
.lms-course-card:hover .lms-card-thumb img {
    transform: scale(1.04);
}
.lms-thumb-fallback {
    width          : 100%;
    height         : 100%;
    display        : flex;
    align-items    : center;
    justify-content: center;
    font-size      : 44px;
    background     : linear-gradient(135deg, #1e293b 0%, #312e81 100%);
}

.lms-badge {
    position     : absolute;
    top          : 10px;
    left         : 10px;
    font-size    : 11px;
    font-weight  : 600;
    border-radius: 20px;
    padding      : 3px 9px;
}
.lms-badge-done   { background: rgba(16,185,129,0.2); border: 1px solid rgba(16,185,129,0.4); color: #34d399; }
.lms-badge-active { background: rgba(99,102,241,0.2); border: 1px solid rgba(99,102,241,0.4); color: #a5b4fc; }

.lms-card-body {
    padding : 14px 16px 12px;
    flex    : 1;
}
.lms-card-name {
    font-size    : 15px;
    font-weight  : 700;
    color        : var(--lms-text-1);
    margin-bottom: 6px;
    display      : -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow     : hidden;
    line-height  : 1.4;
}
.lms-card-desc {
    font-size  : 12px;
    color      : var(--lms-text-muted);
    margin-bottom: 12px;
    display    : -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow   : hidden;
    line-height: 1.5;
}

/* Progress */
.lms-prog-wrap { margin-top: auto; }
.lms-prog-header {
    display        : flex;
    justify-content: space-between;
    align-items    : center;
    margin-bottom  : 6px;
}
.lms-prog-lessons { font-size: 12px; color: var(--lms-text-muted); }
.lms-prog-pct     { font-size: 12px; font-weight: 700; color: var(--lms-text-1); }
.lms-prog-track {
    height       : 6px;
    background   : rgba(255,255,255,0.08);
    border-radius: 99px;
    overflow     : hidden;
}
.lms-prog-fill {
    height       : 100%;
    border-radius: 99px;
    width        : 0%;
    transition   : width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
}
.lms-prog-done   { background: linear-gradient(90deg, #10b981, #34d399); }
.lms-prog-green  { background: linear-gradient(90deg, #3b82f6, #06b6d4); }
.lms-prog-yellow { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
.lms-prog-red    { background: linear-gradient(90deg, #ef4444, #f87171); }

.lms-card-footer {
    padding       : 0 16px 14px;
    flex-shrink   : 0;
}
.lms-cta-btn {
    display        : flex;
    align-items    : center;
    justify-content: center;
    gap            : 6px;
    width          : 100%;
    padding        : 10px 16px;
    border-radius  : var(--lms-radius-md);
    font-size      : 13px;
    font-weight    : 600;
    text-align     : center;
    text-decoration: none;
    transition     : all var(--lms-transition);
    min-height     : 44px; /* Touch target */
}
.lms-cta-active {
    background: linear-gradient(135deg, var(--lms-accent-1), var(--lms-accent-2));
    color     : #fff;
    box-shadow: 0 2px 12px rgba(99,102,241,0.35);
}
.lms-cta-active:hover {
    box-shadow     : 0 4px 20px rgba(99,102,241,0.5);
    transform      : translateY(-1px);
    color          : #fff;
    text-decoration: none;
}
.lms-cta-done {
    background: rgba(16,185,129,0.12);
    border    : 1px solid rgba(16,185,129,0.25);
    color     : var(--lms-green);
    cursor    : default;
}

/* ═══════════════════════════════════════════════════════════
   BOTTOM GRID (Timeline + Right Panel)
═══════════════════════════════════════════════════════════ */
.lms-bottom-grid {
    display              : grid;
    grid-template-columns: 1fr;
    gap                  : 0;
    max-width            : 1400px;
    margin               : 0 auto;
    padding              : 0 0 16px;
}

@media (min-width: 900px) {
    .lms-bottom-grid {
        grid-template-columns: 1fr 340px;
        gap                  : 0 16px;
        align-items          : start;
        padding              : 0 16px 16px;
    }
}

.lms-timeline-section {
    padding: 0 16px 8px;
}
@media (min-width: 900px) {
    .lms-timeline-section { padding: 0; }
}

/* ═══════════════════════════════════════════════════════════
   TIMELINE
═══════════════════════════════════════════════════════════ */
.lms-timeline-wrap {
    background   : var(--lms-bg-card);
    border       : 1px solid var(--lms-border);
    border-radius: var(--lms-radius-lg);
    padding      : 20px;
    max-height   : 440px;
    overflow-y   : auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.1) transparent;
}
.lms-timeline-wrap::-webkit-scrollbar       { width: 4px; }
.lms-timeline-wrap::-webkit-scrollbar-track { background: transparent; }
.lms-timeline-wrap::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 99px; }

.lms-tl-item {
    display   : flex;
    gap       : 12px;
    align-items: flex-start;
    opacity   : 0;
    transform : translateX(-16px);
}
.lms-tl-item.lms-anim-in {
    animation: lms-fade-right 0.4s var(--lms-transition) forwards;
}

.lms-tl-left {
    display       : flex;
    flex-direction: column;
    align-items   : center;
    flex-shrink   : 0;
}

.lms-tl-dot {
    width          : 34px;
    height         : 34px;
    border-radius  : 50%;
    display        : flex;
    align-items    : center;
    justify-content: center;
    font-size      : 13px;
    flex-shrink    : 0;
    z-index        : 1;
}
.lms-dot-lesson {
    background : rgba(99,102,241,0.2);
    border     : 2px solid rgba(99,102,241,0.5);
    color      : #a5b4fc;
}
.lms-dot-quiz {
    background : rgba(139,92,246,0.2);
    border     : 2px solid rgba(139,92,246,0.5);
    color      : #c4b5fd;
}

.lms-tl-line {
    width     : 2px;
    flex      : 1;
    min-height: 20px;
    margin    : 4px 0;
    background: linear-gradient(180deg, rgba(255,255,255,0.1) 0%, transparent 100%);
    border-radius: 99px;
}

.lms-tl-body {
    flex         : 1;
    min-width    : 0;
    padding-top  : 4px;
    padding-bottom: 20px;
}
.lms-tl-title {
    font-size   : 14px;
    font-weight : 600;
    color       : var(--lms-text-1);
    overflow    : hidden;
    text-overflow: ellipsis;
    white-space : nowrap;
    margin-bottom: 3px;
}
.lms-tl-sub {
    font-size: 12px;
    color    : var(--lms-text-2);
    overflow : hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 3px;
}
.lms-tl-time { font-size: 11px; color: var(--lms-text-muted); }

.lms-tl-badge {
    flex-shrink  : 0;
    align-self   : flex-start;
    margin-top   : 6px;
    padding      : 2px 8px;
    border-radius: 20px;
    font-size    : 11px;
    font-weight  : 700;
}
.lms-tl-check  { background: rgba(16,185,129,0.15); color: var(--lms-green); border: 1px solid rgba(16,185,129,0.3); }
.lms-tl-passed { background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); }
.lms-tl-failed { background: rgba(239,68,68,0.15);  color: #f87171; border: 1px solid rgba(239,68,68,0.3); }

/* ═══════════════════════════════════════════════════════════
   RIGHT PANEL CARDS
═══════════════════════════════════════════════════════════ */
.lms-right-panel {
    display       : flex;
    flex-direction: column;
    gap           : 14px;
    padding       : 0 16px;
}
@media (min-width: 900px) {
    .lms-right-panel {
        padding       : 0;
        position      : sticky;
        top           : 80px;
    }
}

.lms-card {
    background   : var(--lms-bg-card);
    border       : 1px solid var(--lms-border);
    border-radius: var(--lms-radius-lg);
    padding      : 20px;
}

.lms-quiz-scores {
    display              : grid;
    grid-template-columns: repeat(2, 1fr);
    gap                  : 10px;
    margin               : 16px 0 14px;
}
.lms-score-pill {
    background   : var(--lms-bg-glass);
    border       : 1px solid var(--lms-border);
    border-radius: var(--lms-radius-md);
    padding      : 14px 10px;
    text-align   : center;
}
.lms-score-best .lms-score-val { color: var(--lms-accent-2); }
.lms-score-last .lms-score-val { color: var(--lms-blue); }
.lms-score-val {
    font-size  : 28px;
    font-weight: 800;
    line-height: 1;
    margin-bottom: 4px;
}
.lms-score-lbl { font-size: 11px; color: var(--lms-text-muted); }

.lms-quiz-meta {
    display  : flex;
    flex-wrap: wrap;
    gap      : 8px;
    margin   : 12px 0;
}
.lms-meta-chip {
    font-size    : 12px;
    color        : var(--lms-text-2);
    background   : var(--lms-bg-glass);
    border       : 1px solid var(--lms-border);
    border-radius: 20px;
    padding      : 4px 10px;
}
.lms-chip-green { color: var(--lms-green); border-color: rgba(16,185,129,0.25); background: rgba(16,185,129,0.08); }
.lms-chip-red   { color: var(--lms-red);   border-color: rgba(239,68,68,0.25);  background: rgba(239,68,68,0.08); }
.lms-chip-yellow{ color: var(--lms-yellow);border-color: rgba(245,158,11,0.25); background: rgba(245,158,11,0.08); }

.lms-pass-bar-wrap { margin-top: 8px; }
.lms-pass-bar-label {
    display        : flex;
    justify-content: space-between;
    font-size      : 12px;
    color          : var(--lms-text-muted);
    margin-bottom  : 6px;
}
.lms-pass-bar-track {
    height       : 6px;
    background   : rgba(255,255,255,0.06);
    border-radius: 99px;
    overflow     : hidden;
}
.lms-pass-bar-fill {
    height       : 100%;
    background   : linear-gradient(90deg, var(--lms-green), #34d399);
    border-radius: 99px;
    width        : 0%;
    transition   : width 0.9s cubic-bezier(0.4, 0, 0.2, 1);
}

/* ASSIGNMENTS */
.lms-assign-list { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; }

.lms-assign-row {
    display        : flex;
    align-items    : center;
    justify-content: space-between;
    padding        : 10px 14px;
    background     : var(--lms-bg-glass);
    border         : 1px solid var(--lms-border);
    border-radius  : var(--lms-radius-md);
}
.lms-assign-left {
    display    : flex;
    align-items: center;
    gap        : 10px;
    font-size  : 13px;
    color      : var(--lms-text-2);
}
.lms-assign-dot {
    width        : 8px;
    height       : 8px;
    border-radius: 50%;
    flex-shrink  : 0;
}
.lms-assign-count {
    font-size  : 16px;
    font-weight: 800;
}
.lms-assign-empty {
    text-align: center;
    font-size : 13px;
    color     : var(--lms-text-muted);
    padding   : 16px 0 4px;
}

/* ═══════════════════════════════════════════════════════════
   EMPTY STATE
═══════════════════════════════════════════════════════════ */
.lms-empty-state {
    text-align    : center;
    padding       : 40px 20px;
}
.lms-empty-sm { padding: 20px 16px; }
.lms-empty-icon  { font-size: 40px; margin-bottom: 12px; }
.lms-empty-title { font-size: 16px; font-weight: 600; color: var(--lms-text-2); margin-bottom: 6px; }
.lms-empty-sub   { font-size: 13px; color: var(--lms-text-muted); line-height: 1.6; max-width: 320px; margin: 0 auto; }

/* ═══════════════════════════════════════════════════════════
   MODAL
═══════════════════════════════════════════════════════════ */
.lms-modal-overlay {
    position  : fixed;
    inset     : 0;
    z-index   : 9999;
    background: rgba(0, 0, 0, 0.75);
    display   : flex;
    align-items: flex-end;
    justify-content: center;
    backdrop-filter: blur(4px);
    opacity   : 0;
    transition: opacity 0.2s ease;
}
.lms-modal-overlay.lms-modal-visible { opacity: 1; }
.lms-modal-overlay.lms-modal-closing { opacity: 0; }

@media (min-width: 640px) {
    .lms-modal-overlay { align-items: center; }
}

.lms-modal {
    background   : #161f30;
    border       : 1px solid rgba(255,255,255,0.1);
    border-radius: var(--lms-radius-xl) var(--lms-radius-xl) 0 0;
    width        : 100%;
    max-width    : 600px;
    max-height   : 90dvh;
    overflow     : hidden;
    display      : flex;
    flex-direction: column;
    transform    : translateY(24px);
    transition   : transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow   : var(--lms-shadow-lg);
}
.lms-modal-overlay.lms-modal-visible .lms-modal { transform: translateY(0); }
.lms-modal-overlay.lms-modal-closing .lms-modal { transform: translateY(24px); }

@media (min-width: 640px) {
    .lms-modal {
        border-radius: var(--lms-radius-xl);
        transform    : scale(0.95) translateY(0);
        margin       : 16px;
    }
    .lms-modal-overlay.lms-modal-visible .lms-modal { transform: scale(1); }
    .lms-modal-overlay.lms-modal-closing .lms-modal { transform: scale(0.95); }
}

.lms-modal-head {
    display        : flex;
    align-items    : center;
    justify-content: space-between;
    padding        : 18px 20px;
    border-bottom  : 1px solid var(--lms-border);
    flex-shrink    : 0;
}
.lms-modal-title {
    display    : flex;
    align-items: center;
    gap        : 10px;
    min-width  : 0;
}
.lms-modal-icon { font-size: 22px; flex-shrink: 0; }
.lms-modal-title h3 {
    font-size    : 17px;
    font-weight  : 700;
    color        : var(--lms-text-1);
    margin       : 0;
    overflow     : hidden;
    text-overflow: ellipsis;
    white-space  : nowrap;
}
.lms-modal-close {
    width         : 36px;
    height        : 36px;
    border-radius : 50%;
    background    : rgba(255,255,255,0.06);
    border        : 1px solid var(--lms-border);
    color         : var(--lms-text-2);
    cursor        : pointer;
    display       : flex;
    align-items   : center;
    justify-content: center;
    font-size     : 16px;
    transition    : all var(--lms-transition);
    flex-shrink   : 0;
}
.lms-modal-close:hover { background: rgba(239,68,68,0.15); color: var(--lms-red); border-color: rgba(239,68,68,0.3); }

.lms-modal-body {
    overflow-y     : auto;
    flex           : 1;
    padding        : 16px 20px 24px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.1) transparent;
}
.lms-modal-body::-webkit-scrollbar       { width: 4px; }
.lms-modal-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 99px; }

.lms-modal-loading {
    display        : flex;
    flex-direction : column;
    align-items    : center;
    justify-content: center;
    min-height     : 120px;
}
.lms-spinner {
    width        : 36px;
    height       : 36px;
    border       : 3px solid rgba(255,255,255,0.08);
    border-top   : 3px solid var(--lms-accent-1);// ═══════════════════════════════════════════════════════════════════════════
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
            const cName  = frappe.utils.escape_html(c// ═══════════════════════════════════════════════════════════════════════════
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
.course_name || c.course);
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

    border-radius: 50%;
    animation    : lms-spin 0.8s linear infinite;
}
@keyframes lms-spin {
    to { transform: rotate(360deg); }
}

.lms-modal-section { margin-bottom: 20px; }
.lms-modal-section:last-child { margin-bottom: 0; }

.lms-modal-sec-head {
    display    : flex;
    align-items: center;
    gap        : 8px;
    padding    : 10px 14px;
    background : rgba(99,102,241,0.08);
    border     : 1px solid rgba(99,102,241,0.2);
    border-radius: var(--lms-radius-md);
    margin-bottom: 10px;
}
.lms-modal-sec-icon  { font-size: 16px; flex-shrink: 0; }
.lms-modal-sec-title {
    flex       : 1;
    font-size  : 13px;
    font-weight: 700;
    color      : #a5b4fc;
    min-width  : 0;
    overflow   : hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.lms-modal-sec-count {
    font-size  : 11px;
    color      : var(--lms-text-muted);
    flex-shrink: 0;
}

.lms-modal-lessons { display: flex; flex-direction: column; gap: 6px; }

.lms-lesson-row {
    display    : flex;
    align-items: center;
    gap        : 10px;
    padding    : 10px 14px;
    background : var(--lms-bg-glass);
    border     : 1px solid var(--lms-border);
    border-radius: var(--lms-radius-sm);
    transition : border-color var(--lms-transition);
    min-height : 44px;
}
.lms-lesson-row:hover { border-color: var(--lms-border-hov); }
.lms-lesson-done    { border-left: 3px solid var(--lms-green) !important; }
.lms-lesson-partial { border-left: 3px solid var(--lms-yellow) !important; }
.lms-lesson-todo    { border-left: 3px solid rgba(255,255,255,0.08) !important; }

.lms-lesson-type-icon { font-size: 16px; flex-shrink: 0; }
.lms-lesson-name {
    flex         : 1;
    font-size    : 13px;
    color        : var(--lms-text-1);
    overflow     : hidden;
    text-overflow: ellipsis;
    white-space  : nowrap;
    min-width    : 0;
}
.lms-lesson-pct {
    font-size  : 11px;
    color      : var(--lms-yellow);
    font-weight: 600;
    flex-shrink: 0;
}
.lms-lesson-status { font-size: 16px; flex-shrink: 0; }

/* ═══════════════════════════════════════════════════════════
   ANIMATIONS
═══════════════════════════════════════════════════════════ */
@keyframes lms-fade-up {
    from {
        opacity  : 0;
        transform: translateY(16px);
    }
    to {
        opacity  : 1;
        transform: translateY(0);
    }
}

@keyframes lms-fade-right {
    from {
        opacity  : 0;
        transform: translateX(-16px);
    }
    to {
        opacity  : 1;
        transform: translateX(0);
    }
}

/* ═══════════════════════════════════════════════════════════
   FOOTER SPACE
═══════════════════════════════════════════════════════════ */
.lms-footer-space { height: 40px; }
@media (min-width: 900px) { .lms-footer-space { height: 60px; } }

/* ═══════════════════════════════════════════════════════════
   ACCESSIBILITY — Reduced Motion
═══════════════════════════════════════════════════════════ */
@media (prefers-reduced-motion: reduce) {
    .lms-stat-card,
    .lms-course-card,
    .lms-tl-item { animation: none !important; opacity: 1 !important; transform: none !important; }
    .lms-prog-fill,
    .lms-pass-bar-fill,
    .lms-donut-progress { transition: none !important; }
    .lms-spinner { animation-duration: 2s; }
}

/* ═══════════════════════════════════════════════════════════
   DARK MODE (already dark, but ensure browser override)
═══════════════════════════════════════════════════════════ */
@media (prefers-color-scheme: light) {
    /* Keep dark theme regardless — LMS is dark-only */
    .lms-wrap { background: var(--lms-bg); color: var(--lms-text-1); }
}

/* ═══════════════════════════════════════════════════════════
   PRINT STYLES
═══════════════════════════════════════════════════════════ */
@media print {
    .lms-hero-cta,
    .lms-modal-overlay,
    .lms-cta-btn { display: none; }
    .lms-wrap    { background: #fff; color: #000; }
}

/* ═══════════════════════════════════════════════════════════
   COURSE TREE
═══════════════════════════════════════════════════════════ */
.lms-tree-section { margin: 0 var(--lms-gutter) 24px; }
.lms-tree-hint   { font-size: 12px; color: var(--lms-text-muted); }
.lms-tree-root   { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
.lms-tree-loading,
.lms-tree-empty  { display: flex; align-items: center; gap: 10px;
                   color: var(--lms-text-muted); font-size: 14px; padding: 20px 0; }

/* Course node */
.lms-tr-course {
    border: 1px solid var(--lms-border);
    border-radius: var(--lms-radius-md);
    background: var(--lms-bg-glass);
    overflow: hidden;
}
.lms-tr-course-hdr {
    display: flex; align-items: center; gap: 10px;
    padding: 14px 16px; cursor: pointer;
    user-select: none; transition: background var(--lms-transition);
}
.lms-tr-course-hdr:hover { background: rgba(255,255,255,0.06); }
.lms-tr-arr {
    font-size: 10px; color: var(--lms-text-muted);
    transition: transform 0.2s;
    display: inline-block;
}
.lms-tr-open > .lms-tr-course-hdr > .lms-tr-arr,
.lms-tr-open > .lms-tr-sec-hdr   > .lms-tr-arr { transform: rotate(90deg); }
.lms-tr-ico  { font-size: 18px; flex-shrink: 0; }
.lms-tr-course-name {
    flex: 1; font-size: 15px; font-weight: 600;
    color: var(--lms-text-1); white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis;
}
.lms-tr-course-prog {
    font-size: 12px; color: var(--lms-accent-2);
    white-space: nowrap; margin-left: auto; padding-left: 8px;
}
.lms-tr-bar-wrap {
    width: 60px; height: 4px; background: rgba(255,255,255,0.1);
    border-radius: 2px; overflow: hidden; flex-shrink: 0;
}
.lms-tr-bar {
    height: 100%; border-radius: 2px;
    background: linear-gradient(90deg, var(--lms-accent-1), var(--lms-accent-2));
    transition: width 0.6s ease;
}
.lms-tr-course-body {
    display: none; padding: 0 12px 12px;
    flex-direction: column; gap: 8px;
}
.lms-tr-open > .lms-tr-course-body { display: flex; }

/* Section node */
.lms-tr-sec {
    border-radius: var(--lms-radius-sm);
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.05);
}
.lms-tr-sec-hdr {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px; cursor: pointer;
    user-select: none; transition: background var(--lms-transition);
    border-radius: var(--lms-radius-sm);
}
.lms-tr-sec-hdr:hover { background: rgba(255,255,255,0.05); }
.lms-tr-sec-ico   { font-size: 15px; }
.lms-tr-sec-name  { flex: 1; font-size: 13px; font-weight: 500; color: var(--lms-text-2); }
.lms-tr-sec-count { font-size: 11px; color: var(--lms-text-muted); }
.lms-tr-sec-body  {
    display: none; padding: 4px 8px 8px 28px;
    flex-direction: column; gap: 2px;
}
.lms-tr-open > .lms-tr-sec-body { display: flex; }

/* Lesson row */
.lms-tr-les {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 12px; border-radius: 8px;
    cursor: pointer; transition: background var(--lms-transition);
    border: 1px solid transparent;
}
.lms-tr-les:hover {
    background: rgba(99,102,241,0.15);
    border-color: rgba(99,102,241,0.3);
}
.lms-tr-les:focus-visible {
    outline: 2px solid var(--lms-accent-1);
    outline-offset: 2px;
}
.lms-tr-les-type   { font-size: 14px; flex-shrink: 0; }
.lms-tr-les-name   { flex: 1; font-size: 13px; color: var(--lms-text-1);
                     white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lms-tr-les-pct    { font-size: 11px; color: var(--lms-accent-2);
                     background: rgba(99,102,241,0.15); padding: 2px 6px;
                     border-radius: 10px; }
.lms-tr-les-status { font-size: 13px; flex-shrink: 0; }
.lms-tr-done .lms-tr-les-name   { color: var(--lms-text-muted); text-decoration: line-through; }
.lms-tr-partial .lms-tr-les-name { color: var(--lms-accent-2); }
.lms-tr-empty { font-size: 12px; color: var(--lms-text-muted); padding: 6px 0; }
`;