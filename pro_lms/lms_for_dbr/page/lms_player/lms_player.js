frappe.pages['lms-player'].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({ parent: wrapper, title: 'LMS Player', single_column: true });
	_injectOpenQCSS();
	_injectInactivityCSS();
	frappe.after_ajax(() => {
		_ensurePhotoSwipeDom();
		_injectInactivityModalDOM();
		_loadYouTubeAPI();
		window.lms_player = new LMSPlayer(wrapper);
	});
};

/* ══════════════════════════════════════════════════════════════════════
   CSS INJECTORS
══════════════════════════════════════════════════════════════════════ */

function _injectOpenQCSS() {
	if (document.getElementById('lms-oq-style')) return;
	const s = document.createElement('style');
	s.id = 'lms-oq-style';
	s.textContent = `
/* ── Ochiq savol action tugmasi ── */
.lp-btn-oq {
	background: linear-gradient(135deg, #0891b2, #06b6d4);
	color: #fff;
}
.lp-btn-oq:hover {
	transform: translateY(-1px);
	box-shadow: 0 6px 18px rgba(6,182,212,0.4);
}
/* ── Modal wrapper ── */
.lp-oq-wrap { padding: 2px 0 8px; }
/* ── Header ── */
.lp-oq-header {
	margin-bottom: 20px;
	padding-bottom: 14px;
	border-bottom: 1px solid rgba(0,0,0,0.07);
}
.lp-oq-title {
	font-size: 16px;
	font-weight: 700;
	color: var(--text-color, #1f2937);
	margin-bottom: 10px;
}
.lp-oq-meta { display: flex; flex-wrap: wrap; gap: 8px; }
/* ── Chips ── */
.lp-oq-chip {
	font-size: 12px;
	font-weight: 600;
	padding: 3px 10px;
	border-radius: 20px;
	background: rgba(99,102,241,0.09);
	color: #6366f1;
	border: 1px solid rgba(99,102,241,0.2);
}
.lp-oq-chip-green  { background: rgba(16,185,129,0.1);  color: #059669; border-color: rgba(16,185,129,0.25); }
.lp-oq-chip-orange { background: rgba(245,158,11,0.1);  color: #d97706; border-color: rgba(245,158,11,0.25); }
.lp-oq-chip-blue   { background: rgba(59,130,246,0.1);  color: #2563eb; border-color: rgba(59,130,246,0.25); }
.lp-oq-chip-red    { background: rgba(239,68,68,0.1);   color: #dc2626; border-color: rgba(239,68,68,0.25); }
/* ── Question block ── */
.lp-oq-q {
	margin-bottom: 18px;
	padding: 15px;
	border: 1.5px solid rgba(99,102,241,0.18);
	border-radius: 12px;
	background: rgba(99,102,241,0.025);
	transition: border-color 0.2s;
}
.lp-oq-q:hover        { border-color: rgba(99,102,241,0.38); }
.lp-oq-q-graded       { border-color: rgba(16,185,129,0.3) !important; background: rgba(16,185,129,0.025); }
.lp-oq-q-pending      { border-color: rgba(245,158,11,0.3)  !important; background: rgba(245,158,11,0.025); }
.lp-oq-q-head {
	display: flex;
	align-items: flex-start;
	flex-wrap: wrap;
	gap: 8px;
	margin-bottom: 11px;
}
.lp-oq-q-num {
	width: 24px; height: 24px;
	border-radius: 50%;
	background: linear-gradient(135deg, #6366f1, #8b5cf6);
	color: #fff;
	font-size: 11px; font-weight: 700;
	display: flex; align-items: center; justify-content: center;
	flex-shrink: 0; margin-top: 2px;
}
.lp-oq-q-text {
	flex: 1; min-width: 0;
	font-size: 14px; font-weight: 600;
	color: var(--text-color, #1f2937);
	line-height: 1.5;
}
.lp-oq-q-marks {
	font-size: 11px; color: #6366f1; font-weight: 700;
	background: rgba(99,102,241,0.1);
	padding: 2px 8px; border-radius: 10px;
	white-space: nowrap; flex-shrink: 0;
}
/* ── Badges ── */
.lp-oq-badge {
	font-size: 11px; font-weight: 600;
	padding: 2px 8px; border-radius: 10px;
	border: 1px solid transparent;
	white-space: nowrap; flex-shrink: 0;
}
.lp-oq-badge-pending { background: rgba(245,158,11,0.12); color: #d97706; border-color: rgba(245,158,11,0.3); }
.lp-oq-badge-auto    { background: rgba(59,130,246,0.12);  color: #2563eb; border-color: rgba(59,130,246,0.3); }
.lp-oq-badge-manual  { background: rgba(139,92,246,0.12); color: #7c3aed; border-color: rgba(139,92,246,0.3); }
/* ── Textarea ── */
.lp-oq-ta {
	width: 100%;
	padding: 10px 13px;
	border: 1.5px solid rgba(99,102,241,0.22);
	border-radius: 8px;
	font-size: 14px; line-height: 1.6;
	color: var(--text-color, #1f2937);
	background: #fff;
	resize: vertical; min-height: 78px;
	transition: border-color 0.2s, box-shadow 0.2s;
	font-family: inherit; box-sizing: border-box;
}
.lp-oq-ta:focus {
	outline: none;
	border-color: #6366f1;
	box-shadow: 0 0 0 3px rgba(99,102,241,0.11);
}
.lp-oq-ta[readonly] {
	background: rgba(0,0,0,0.03);
	cursor: default;
	border-color: rgba(0,0,0,0.08);
	color: #6b7280;
}
.lp-oq-ta-err {
	border-color: #ef4444 !important;
	box-shadow: 0 0 0 3px rgba(239,68,68,0.1) !important;
}
/* ── To'g'ri javob / xato ── */
.lp-oq-correct {
	margin-top: 8px; padding: 8px 12px;
	border-radius: 7px; font-size: 13px; line-height: 1.5;
}
.lp-oq-correct-ok {
	background: rgba(16,185,129,0.08);
	border: 1px solid rgba(16,185,129,0.2);
	color: #059669;
}
.lp-oq-correct-no {
	background: rgba(239,68,68,0.07);
	border: 1px solid rgba(239,68,68,0.18);
	color: #dc2626;
}
/* ── Admin feedback ── */
.lp-oq-feedback {
	margin-top: 8px; padding: 8px 12px;
	background: rgba(59,130,246,0.07);
	border: 1px solid rgba(59,130,246,0.18);
	border-radius: 7px;
	font-size: 13px; color: #2563eb; line-height: 1.5;
}
/* ── Footer ── */
.lp-oq-footer {
	display: flex; align-items: center;
	gap: 12px; flex-wrap: wrap;
	padding-top: 14px;
	border-top: 1px solid rgba(0,0,0,0.06);
	margin-top: 6px;
}
.lp-oq-hint { font-size: 12px; color: #d97706; }
.lp-oq-pending-info {
	width: 100%; text-align: center;
	padding: 12px 16px;
	background: rgba(245,158,11,0.08);
	border: 1px solid rgba(245,158,11,0.25);
	border-radius: 8px;
	font-size: 13px; color: #d97706; font-weight: 500;
}
/* ── Error / result ── */
.lp-oq-err { text-align: center; padding: 36px; color: #ef4444; font-size: 14px; }
.lp-oq-result { text-align: center; padding: 32px 16px; }
.lp-oq-result-title {
	font-size: 20px; font-weight: 700;
	margin-bottom: 16px;
	color: var(--text-color, #1f2937);
}
.lp-oq-result-row {
	display: flex; flex-wrap: wrap;
	justify-content: center; gap: 8px; margin-bottom: 8px;
}
/* ── Spinners ── */
.lp-oq-spinner {
	width: 34px; height: 34px;
	border: 3px solid rgba(99,102,241,0.15);
	border-top: 3px solid #6366f1;
	border-radius: 50%;
	animation: lp-oq-spin 0.8s linear infinite;
	display: inline-block;
}
.lp-oq-spinner-sm {
	width: 14px; height: 14px;
	border: 2px solid rgba(255,255,255,0.3);
	border-top: 2px solid #fff;
	border-radius: 50%;
	animation: lp-oq-spin 0.7s linear infinite;
	display: inline-block;
	vertical-align: middle; margin-right: 6px;
}
@keyframes lp-oq-spin { to { transform: rotate(360deg); } }
`;
	document.head.appendChild(s);
}

function _injectInactivityCSS() {
	if (document.getElementById('lms-inact-style')) return;
	const s = document.createElement('style');
	s.id = 'lms-inact-style';
	s.textContent = `
/* ── Inactivity Warning Modal ── */
#lp-inact-modal {
	display: none;
	position: fixed;
	inset: 0;
	z-index: 99999;
	background: rgba(0, 0, 0, 0.65);
	backdrop-filter: blur(4px);
	-webkit-backdrop-filter: blur(4px);
	align-items: center;
	justify-content: center;
}
#lp-inact-modal.lp-inact-visible {
	display: flex;
}
.lp-inact-box {
	background: #fff;
	border-radius: 18px;
	padding: 36px 32px 28px;
	max-width: 400px;
	width: 90%;
	text-align: center;
	box-shadow: 0 28px 72px rgba(0, 0, 0, 0.28);
	animation: lp-inact-pop 0.22s cubic-bezier(.34,1.56,.64,1) both;
}
@keyframes lp-inact-pop {
	from { transform: scale(0.88); opacity: 0; }
	to   { transform: scale(1);    opacity: 1; }
}
.lp-inact-icon    { font-size: 52px; margin-bottom: 14px; }
.lp-inact-title   { margin: 0 0 8px; font-size: 19px; font-weight: 700; color: #1f2937; }
.lp-inact-sub     { font-size: 14px; color: #6b7280; margin-bottom: 6px; line-height: 1.6; }
.lp-inact-counter {
	font-size: 46px;
	font-weight: 800;
	color: #ef4444;
	display: block;
	margin: 8px 0 20px;
	line-height: 1;
	font-variant-numeric: tabular-nums;
}
.lp-inact-stay {
	background: linear-gradient(135deg, #6366f1, #8b5cf6);
	color: #fff;
	border: none;
	border-radius: 10px;
	padding: 12px 32px;
	font-size: 15px;
	font-weight: 600;
	cursor: pointer;
	width: 100%;
	transition: transform 0.15s, box-shadow 0.15s;
}
.lp-inact-stay:hover {
	transform: translateY(-1px);
	box-shadow: 0 8px 24px rgba(99,102,241,0.35);
}
`;
	document.head.appendChild(s);
}

/* ── CSS inject (idempotent) ── */
/* ── CSS inject (idempotent) ── */
function _injectQuizExtraCSS() {
	if (document.getElementById('lms-qz-extra-style')) return;
	const s = document.createElement('style');
	s.id = 'lms-qz-extra-style';
	s.textContent = `
.lms-qz-map { display:flex; flex-wrap:wrap; gap:6px; padding:14px 16px; background:rgba(99,102,241,0.04); border:1px solid rgba(99,102,241,0.12); border-radius:10px; margin-bottom:18px; }
.lms-qz-map-btn { width:34px; height:34px; border-radius:8px; border:1.5px solid rgba(99,102,241,0.25); background:#fff; font-size:12px; font-weight:700; color:#6366f1; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.15s; }
.lms-qz-map-btn:hover { background:rgba(99,102,241,0.1); }
.lms-qz-map-btn.qz-answered { background:#6366f1; color:#fff; border-color:#6366f1; }
.lms-qz-map-btn.qz-current { outline:2.5px solid #6366f1; outline-offset:2px; }
.lms-qz-prog { flex:1; height:6px; background:rgba(99,102,241,0.12); border-radius:4px; overflow:hidden; }
.lms-qz-prog-fill { height:100%; background:linear-gradient(90deg,#6366f1,#8b5cf6); border-radius:4px; transition:width 0.3s ease; }
.lms-qz-topbar { display:flex; align-items:center; gap:12px; margin-bottom:16px; }
.lms-qz-counter { font-size:13px; font-weight:700; color:#6366f1; white-space:nowrap; }
.lms-qz-timer { font-size:13px; font-weight:700; color:#ef4444; white-space:nowrap; background:rgba(239,68,68,0.08); padding:3px 10px; border-radius:8px; }
.lms-qz-question { font-size:15px; font-weight:600; color:var(--text-color,#1f2937); line-height:1.6; margin-bottom:6px; }
.lms-qz-marks { font-size:12px; color:#6366f1; font-weight:600; margin-bottom:14px; }
.lms-qz-options { display:flex; flex-direction:column; gap:8px; margin-bottom:18px; }
.lms-qz-opt { display:flex; align-items:center; gap:12px; padding:12px 16px; border:1.5px solid rgba(99,102,241,0.18); border-radius:10px; cursor:pointer; font-size:14px; transition:all 0.15s; background:#fff; user-select:none; }
.lms-qz-opt:hover { border-color:#6366f1; background:rgba(99,102,241,0.04); }
.lms-qz-opt--selected { border-color:#6366f1; background:rgba(99,102,241,0.09); font-weight:600; }
.lms-qz-opt-radio { font-size:16px; color:#6366f1; flex-shrink:0; }
.lms-qz-nav { display:flex; align-items:center; justify-content:space-between; gap:8px; padding-top:6px; border-top:1px solid rgba(0,0,0,0.06); }
.lms-qz-nav-right { display:flex; gap:8px; margin-left:auto; }
`;
	document.head.appendChild(s);
}



/* ══════════════════════════════════════════════════════════════════════
   DOM GUARDS
══════════════════════════════════════════════════════════════════════ */

function _injectInactivityModalDOM() {
	if (document.getElementById('lp-inact-modal')) return;
	const el = document.createElement('div');
	el.id = 'lp-inact-modal';
	el.setAttribute('role', 'alertdialog');
	el.setAttribute('aria-modal', 'true');
	el.setAttribute('aria-label', 'Faolsizlik ogohlantirishiarshamasi');
	el.innerHTML = `
		<div class="lp-inact-box">
			<div class="lp-inact-icon">⏰</div>
			<h3 class="lp-inact-title">Faolsizlik aniqlandi</h3>
			<p class="lp-inact-sub">Siz <strong>5 daqiqa</strong> faol bo'lmadingiz.</p>
			<span class="lp-inact-counter" id="lp-inact-counter">60</span>
			<p class="lp-inact-sub" style="margin-bottom:20px">soniyadan so'ng tizimdan chiqasiz.</p>
			<button class="lp-inact-stay" id="lp-inact-stay">✓ Davom etish</button>
		</div>
	`;
	document.body.appendChild(el);
}

function _ensurePhotoSwipeDom() {
	if (!window.__lms_ael_patched) {
		const _orig = EventTarget.prototype.addEventListener;
		EventTarget.prototype.addEventListener = function (type, fn, opts) {
			if (this == null) return;
			return _orig.call(this, type, fn, opts);
		};
		window.__lms_ael_patched = true;
	}
	try {
		if (document.querySelector('.pswp')) return;
		const pswp = document.createElement('div');
		pswp.className = 'pswp';
		pswp.setAttribute('tabindex', '-1');
		pswp.setAttribute('role', 'dialog');
		pswp.setAttribute('aria-hidden', 'true');
		pswp.style.cssText = 'display:none!important';
		pswp.innerHTML = [
			'<div class="pswp__bg"></div>',
			'<div class="pswp__scroll-wrap">',
			'<div class="pswp__container">',
			'<div class="pswp__item"></div><div class="pswp__item"></div><div class="pswp__item"></div>',
			'</div>',
			'<div class="pswp__ui pswp__ui--hidden">',
			'<div class="pswp__top-bar">',
			'<div class="pswp__counter"></div>',
			'<button class="pswp__button pswp__button--close"></button>',
			'<button class="pswp__button pswp__button--share"></button>',
			'<button class="pswp__button pswp__button--fs"></button>',
			'<button class="pswp__button pswp__button--zoom"></button>',
			'<div class="pswp__preloader"><div class="pswp__preloader__icn"><div class="pswp__preloader__cut"><div class="pswp__preloader__donut"></div></div></div></div>',
			'</div>',
			'<div class="pswp__share-modal pswp__share-modal--hidden pswp__single-tap">',
			'<div class="pswp__share-tooltip"><a></a></div>',
			'</div>',
			'<button class="pswp__button pswp__button--arrow--left"></button>',
			'<button class="pswp__button pswp__button--arrow--right"></button>',
			'<div class="pswp__caption"><div class="pswp__caption__center"></div></div>',
			'</div></div>'
		].join('');
		document.body.appendChild(pswp);
	} catch (e) {
		console.warn('[LMS] PhotoSwipe DOM guard failed silently:', e);
	}
}

function _loadYouTubeAPI() {
	if (window._ytApiReady) return;
	window._ytApiReady = new Promise((resolve) => {
		if (window.YT && window.YT.Player) { resolve(window.YT); return; }
		const prev = window.onYouTubeIframeAPIReady;
		window.onYouTubeIframeAPIReady = function () {
			try { if (prev) prev(); } catch (e) { }
			resolve(window.YT);
		};
		if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
			const s = document.createElement('script');
			s.src = 'https://www.youtube.com/iframe_api';
			s.async = true;
			document.head.appendChild(s);
		}
	});
}

function _extractYouTubeId(url) {
	if (!url) return null;
	if (/^[A-Za-z0-9_\-]{11}$/.test(url.trim())) return url.trim();
	const patterns = [
		/youtu\.be\/([A-Za-z0-9_\-]{11})/,
		/youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)([A-Za-z0-9_\-]{11})/,
	];
	for (const pat of patterns) {
		const m = url.match(pat);
		if (m) return m[1];
	}
	return null;
}


/* ══════════════════════════════════════════════════════════════════════
   InactivityEngine
   ──────────────────────────────────────────────────────────────────────
   Dunyo standarti (Coursera / LinkedIn Learning algoritmiga mos):
   - DOM events (mousemove, keydown, click, touchstart, scroll, wheel)
	 orqali foydalanuvchi faolligini kuzatadi.
   - Har 10 soniyada idle vaqtni tekshiradi.
   - INACTIVE_THRESHOLD_MS (5 daqiqa) dan oshsa: onWarn callback chaqiriladi.
   - WARN_COUNTDOWN_SEC (60 soniya) ichida javob bo'lmasa: onLogout chaqiriladi.
   - Video/audio ijro paytida pulse() ni chaqirish bilan timer yangilanadi.
══════════════════════════════════════════════════════════════════════ */
class InactivityEngine {
	static INACTIVE_THRESHOLD_MS = 5 * 60 * 1000;  // 5 daqiqa
	static WARN_COUNTDOWN_SEC = 60;              // 1 daqiqa ogohlantirish

	constructor({ onWarn, onCountdown, onStay, onLogout }) {
		this.onWarn = onWarn;       // ()    → ogohlantirishni ko'rsat
		this.onCountdown = onCountdown;  // (sec) → sanachini yangilash
		this.onStay = onStay;       // ()    → foydalanuvchi davom etdi
		this.onLogout = onLogout;     // ()    → chiqish bajar

		this._lastActivity = Date.now();
		this._warnActive = false;
		this._remaining = 0;
		this._checkTimer = null;
		this._countdownTimer = null;

		this._EVENTS = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll', 'wheel'];
		this._handler = this._onActivity.bind(this);
	}

	/** Kuzatishni boshlaydi */
	start() {
		this._lastActivity = Date.now();
		this._EVENTS.forEach(e =>
			document.addEventListener(e, this._handler, { passive: true })
		);
		this._checkTimer = setInterval(() => this._check(), 10_000);
	}

	/** Kuzatishni to'xtatadi (page unload / logout oldidan chaqiring) */
	stop() {
		this._EVENTS.forEach(e => document.removeEventListener(e, this._handler));
		clearInterval(this._checkTimer);
		this._clearCountdown();
	}

	/**
	 * Video/quiz aktiv bo'lganda tashqaridan chaqiriladi.
	 * Bu media ijrosi = foydalanuvchi faol degan ma'noni anglatadi.
	 */
	pulse() {
		if (!this._warnActive) {
			this._lastActivity = Date.now();
		}
	}

	/** Foydalanuvchi "Davom etish" tugmasini bosdi */
	stayActive() {
		this._lastActivity = Date.now();
		this._warnActive = false;
		this._clearCountdown();
		if (this.onStay) this.onStay();
	}

	_onActivity() {
		this._lastActivity = Date.now();
		if (this._warnActive) this.stayActive();
	}

	_check() {
		if (this._warnActive) return;
		if (Date.now() - this._lastActivity >= InactivityEngine.INACTIVE_THRESHOLD_MS) {
			this._triggerWarn();
		}
	}

	_triggerWarn() {
		this._warnActive = true;
		this._remaining = InactivityEngine.WARN_COUNTDOWN_SEC;
		if (this.onWarn) this.onWarn();
		if (this.onCountdown) this.onCountdown(this._remaining);

		this._countdownTimer = setInterval(() => {
			this._remaining--;
			if (this._remaining <= 0) {
				this._clearCountdown();
				this._warnActive = false;
				if (this.onLogout) this.onLogout();
			} else {
				if (this.onCountdown) this.onCountdown(this._remaining);
			}
		}, 1000);
	}

	_clearCountdown() {
		clearInterval(this._countdownTimer);
		this._countdownTimer = null;
	}
}


/* ══════════════════════════════════════════════════════════════════════
   SessionManager
   ──────────────────────────────────────────────────────────────────────
   LMS Time Log doctype bilan ishlaydi.
   - start()          → yangi sessiya yozuvini yaratadi (server)
   - ping()           → 30s heartbeat: session_end va duration_sec yangilaydi
   - switchActivity() → joriy sessiyani yopib, yangi activity_type bilan yangi ochadi
   - end()            → sessiyani yakunlaydi; sendBeacon ishlatadi (page unload ham ishlaydi)
══════════════════════════════════════════════════════════════════════ */
class SessionManager {
	static PING_INTERVAL_MS = 30_000;  // 30 soniya

	constructor(lessonName) {
		this.lessonName = lessonName;
		this._sessionId = null;
		this._activityType = 'Video';
		this._pingTimer = null;
		this._starting = false;   // race condition oldini olish
	}

	/** Yangi sessiya boshlaydi */
	start(activityType = 'Video') {
		if (this._starting) return;
		this._starting = true;
		this._activityType = activityType;

		frappe.call({
			method: 'pro_lms.lms_for_dbr.page.lms_player.lms_player.start_session',
			args: { lesson_name: this.lessonName, activity_type: activityType },
			callback: (r) => {
				this._starting = false;
				if (r.message && !r.message.error) {
					this._sessionId = r.message.session_id;
					this._startPing();
				}
			},
			error: () => { this._starting = false; }
		});
	}

	/**
	 * Activity turini almashtiradi.
	 * Masalan: Video → Quiz yoki Quiz → Video.
	 * Joriy sessiya yopiladi, yangi sessiya ochiladi.
	 */
	switchActivity(newType) {
		if (newType === this._activityType && this._sessionId) return;
		this.end('activity_switch');
		setTimeout(() => this.start(newType), 300);
	}

	/** Tashqi manba (masalan, ytPoll) tomonidan ping yuborish */
	ping() {
		if (!this._sessionId) return;
		frappe.call({
			method: 'pro_lms.lms_for_dbr.page.lms_player.lms_player.ping_session',
			args: { session_id: this._sessionId, activity_type: this._activityType },
			callback: (r) => {
				// Agar server "restart kerak" desa — yangi sessiya boshlaydi
				if (r.message && r.message.restart) {
					this._sessionId = null;
					this.start(this._activityType);
				}
			}
		});
	}

	/**
	 * Sessiyani yakunlaydi.
	 * navigator.sendBeacon ishlatiladi — page unload paytida ham ishonchli jo'natiladi.
	 * Frappe v15: X-Frappe-CSRF-Token form_dict dan ham qabul qilinadi.
	 */
	end(reason = 'normal') {
		if (!this._sessionId) return;
		this._stopPing();
		const sid = this._sessionId;
		this._sessionId = null;

		const fd = new FormData();
		fd.append('cmd', 'pro_lms.lms_for_dbr.page.lms_player.lms_player.end_session');
		fd.append('session_id', sid);
		fd.append('reason', reason);
		fd.append('X-Frappe-CSRF-Token', frappe.csrf_token || '');

		const url = '/api/method/pro_lms.lms_for_dbr.page.lms_player.lms_player.end_session';

		if (navigator.sendBeacon) {
			navigator.sendBeacon(url, fd);
		} else {
			// Fallback: synchronous XHR (deprecated lekin ishonchli)
			try {
				const xhr = new XMLHttpRequest();
				xhr.open('POST', url, false);  // sync
				xhr.setRequestHeader('X-Frappe-CSRF-Token', frappe.csrf_token || '');
				xhr.send(fd);
			} catch (e) { /* silent */ }
		}
	}

	_startPing() {
		this._stopPing();
		this._pingTimer = setInterval(() => this.ping(), SessionManager.PING_INTERVAL_MS);
	}

	_stopPing() {
		clearInterval(this._pingTimer);
		this._pingTimer = null;
	}

	get currentActivity() { return this._activityType; }
	get hasActiveSession() { return !!this._sessionId; }
}


/* ══════════════════════════════════════════════════════════════════════
   LMSPlayer
══════════════════════════════════════════════════════════════════════ */
class LMSPlayer {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.lesson_name = this._resolveLesson();
		this.data = null;
		this.save_interval = 5000;
		this.video_element = null;
		this.ytPlayer = null;
		this.ytVideoId = null;
		this._ytLastKnownTime = 0;
		this._ytWatchedSec = 0;
		this._ytSaveTimer = null;

		// ── Time tracking ──────────────────────────────────────────────
		this.sessionManager = null;   // SessionManager — sessiyani boshqaradi
		this.inactivityEngine = null;   // InactivityEngine — idle kuzatadi

		this._init();
	}

	_resolveLesson() {
		if (frappe.route_options && frappe.route_options.lesson) {
			const val = frappe.route_options.lesson;
			delete frappe.route_options.lesson;
			return val;
		}
		const qs = new URLSearchParams(window.location.search).get('lesson');
		if (qs) return qs;
		try {
			const hash = window.location.hash || '';
			const qi = hash.indexOf('?');
			if (qi !== -1) return new URLSearchParams(hash.slice(qi)).get('lesson') || null;
		} catch (e) { }
		return null;
	}

	_init() {
		const $b = this.wrapper.querySelector('.layout-main-section') || this.wrapper;
		this.$b = $b;
		if (!this.lesson_name) {
			$b.innerHTML = this._err(
				'Dars topilmadi',
				"URL da <code>?lesson=Lesson-00001</code> parametri yo'q."
			);
			return;
		}
		$b.innerHTML = '<div class="lp-loading">Yuklanmoqda...</div>';
		frappe.call({
			method: 'pro_lms.lms_for_dbr.page.lms_player.lms_player.get_lesson_data',
			args: { lesson_name: this.lesson_name },
			callback: (r) => {
				if (!r.message || r.message.error) {
					$b.innerHTML = this._err((r.message && r.message.message) || 'Dars topilmadi');
					return;
				}
				this.data = r.message;
				this._render();
				this._attachEvents();
				// ── Sessiyani boshlaydi: render tugagandan keyin ────────
				this._startTracking();
			},
			error: () => { $b.innerHTML = this._err('Server xatosi'); }
		});
	}

	/* ── Time tracking lifecycle ─────────────────────────────────── */

	_startTracking() {
		// SessionManager
		this.sessionManager = new SessionManager(this.lesson_name);
		this.sessionManager.start('Video');

		// InactivityEngine
		this.inactivityEngine = new InactivityEngine({
			onWarn: () => this._showInactivityWarning(),
			onCountdown: (sec) => this._updateInactivityCountdown(sec),
			onStay: () => this._hideInactivityWarning(),
			onLogout: () => this._doLogout(),
		});
		this.inactivityEngine.start();

		// "Davom etish" tugmasi
		const stayBtn = document.getElementById('lp-inact-stay');
		if (stayBtn) {
			stayBtn.addEventListener('click', () => {
				this.inactivityEngine.stayActive();
			});
		}

		// Page unload / navigation — sessiyani yopadi
		this._beforeUnloadHandler = () => {
			this.sessionManager.end('page_unload');
		};
		window.addEventListener('beforeunload', this._beforeUnloadHandler);
	}

	_stopTracking(reason) {
		if (this.sessionManager) this.sessionManager.end(reason || 'normal');
		if (this.inactivityEngine) this.inactivityEngine.stop();
		window.removeEventListener('beforeunload', this._beforeUnloadHandler);
	}

	/** Logout: video to'xtating, sessiyani yoping, Frappe'dan chiqing */
	_doLogout() {
		this._hideInactivityWarning();
		try { if (this.ytPlayer) this.ytPlayer.pauseVideo(); } catch (e) { }
		if (this.video_element) try { this.video_element.pause(); } catch (e) { }
		this._stopTracking('inactivity');

		// Frappe v15 logout
		frappe.call({
			method: 'logout',
			callback: () => { window.location.href = '/login?timeout=1'; },
			error: () => { window.location.href = '/login?timeout=1'; }
		});
	}

	_showInactivityWarning() {
		try { if (this.ytPlayer) this.ytPlayer.pauseVideo(); } catch (e) { }
		const m = document.getElementById('lp-inact-modal');
		if (m) m.classList.add('lp-inact-visible');
	}

	_hideInactivityWarning() {
		const m = document.getElementById('lp-inact-modal');
		if (m) m.classList.remove('lp-inact-visible');
	}

	_updateInactivityCountdown(sec) {
		const el = document.getElementById('lp-inact-counter');
		if (el) el.textContent = sec;
	}

	/* ── Render ──────────────────────────────────────────────────── */
	_render() {
		const L = this.data.lesson;
		const P = this.data.progress;
		const isLocked = !!this.data.is_locked;
		const pct = Math.round(P.completion_percent || 0);
		const wm = Math.floor((P.watch_time_sec || 0) / 60);
		const ws = String((P.watch_time_sec || 0) % 60).padStart(2, '0');

		this._ytLastKnownTime = P.last_position_sec || 0;
		this._ytWatchedSec = P.watch_time_sec || 0;
		this.ytVideoId = L.youtube_id || _extractYouTubeId(L.video_url);

		this.$b.innerHTML =
			'<div class="lp-page" id="lp-page">' +

			'<div class="lp-topbar">' +
			'<div class="lp-topbar-left">' +
			'<button class="lp-icon-btn" id="lp-back">&larr; Dashboard</button>' +
			'<span class="lp-lesson-title">' + this._esc(L.title) + '</span>' +
			'</div>' +
			'<div class="lp-topbar-right">' +
			'<span class="lp-pct-badge" id="lp-pct">' + pct + '%</span>' +
			'<button class="lp-icon-btn" id="lp-toggle" title="Darslar ro\'yxati">&#9776; Bo\'limlar</button>' +
			'</div>' +
			'</div>' +

			'<div class="lp-main">' +
			'<div class="lp-left">' +
			this._video(L, pct, isLocked) +
			'<div class="lp-info-bar">' +
			'<div class="lp-stat">' +
			'<span class="lp-stat-label">Ko\'rildi</span>' +
			'<span class="lp-stat-value">' + wm + 'm ' + ws + 's</span>' +
			'</div>' +
			'<div class="lp-stat">' +
			'<span class="lp-stat-label">Tamomlangan</span>' +
			'<span class="lp-stat-value" id="lp-stat-pct">' + pct + '%</span>' +
			'</div>' +
			(P.is_completed ? '<span class="lp-done-badge">&#10003; Tugallangan</span>' : '') +
			this._actions(L) +
			'</div>' +
			'</div>' +
			this._sidebar(this.data.hierarchy, L.name) +
			'</div>' +
			'</div>';

		this.video_element = document.getElementById('lp-video');
		if (this.video_element && P.last_position_sec > 0) {
			this.video_element.addEventListener('loadedmetadata', () => {
				this.video_element.currentTime = P.last_position_sec;
			}, { once: true });
		}
	}

	/* ── Video ───────────────────────────────────────────────────── */
	_video(L, pct, isLocked) {
		const lockOverlay = isLocked
			? '<div class="lp-lock-overlay"><div class="lp-lock-msg">&#128274; Bu dars qulflangan.<br>Avvalgi darsni tugatish kerak.</div></div>'
			: '';
		const skipWarn =
			'<div class="lp-lock-overlay" id="lp-skip-warn" style="display:none;">' +
			'<div class="lp-lock-msg" style="background:rgba(245,158,11,0.92)">' +
			'&#9888; Oldinga o\'tkazib bo\'lmaydi<br>' +
			'<small>' + pct + '% ko\'rildi, 90% kerak</small></div></div>';

		const ytId = this.ytVideoId;
		if (ytId) {
			return '<div class="lp-video-container">' + lockOverlay + skipWarn +
				'<div id="lp-yt-mount"></div>' +
				'</div>' +
				'<div class="lp-progress-line"><div class="lp-progress-fill" id="lp-pfill" style="width:' + pct + '%"></div></div>';
		}
		if (L.video_url) {
			return '<div class="lp-video-container">' + lockOverlay + skipWarn +
				'<video id="lp-video" controls preload="metadata" playsinline' +
				(isLocked ? ' style="pointer-events:none"' : '') + '>' +
				'<source src="' + this._esc(L.video_url) + '">' +
				'Brauzeringiz video elementni qo\'llab-quvvatlamaydi.' +
				'</video>' +
				'</div>' +
				'<div class="lp-progress-line"><div class="lp-progress-fill" id="lp-pfill" style="width:' + pct + '%"></div></div>';
		}
		return '<div class="lp-no-video">' +
			'<div class="lp-no-video-inner">' +
			'<span class="lp-no-video-icon">&#127909;</span>' +
			'<p class="lp-no-video-title">Video yuklanmagan</p>' +
			'<p class="lp-no-video-sub">Ushbu darsga video fayl yoki YouTube havolasi biriktirilmagan.</p>' +
			'</div></div>';
	}

	/* ── Sidebar ─────────────────────────────────────────────────── */
	_sidebar(hierarchy, cur) {
		let h = '';
		(hierarchy || []).forEach(function (sec) {
			const hc = (sec.lessons || []).some(function (l) { return l.lesson_id === cur; });
			const ad = sec.lessons.length > 0 && sec.lessons.every(function (l) { return l.is_completed; });
			const scls = 'lp-s-section' + (hc ? '' : ' lp-s-section--closed');

			h += '<div class="' + scls + '">' +
				'<div class="lp-s-sec-hdr" onclick="this.closest(\'.lp-s-section\').classList.toggle(\'lp-s-section--closed\')">' +
				'<span>' + (ad ? '&#9989;' : '&#128193;') + '</span>' +
				'<span style="flex:1;overflow:hidden;text-overflow:ellipsis">' + this._esc(sec.section_title) + '</span>' +
				'<span style="font-size:10px;opacity:.6;margin-left:4px">' +
				sec.lessons.filter(function (l) { return l.is_completed; }).length + '/' + sec.lessons.length +
				'</span>' +
				'</div>' +
				'<div class="lp-s-lessons">';

			sec.lessons.forEach(function (l) {
				const ic = l.lesson_id === cur;
				const icon = l.is_locked ? '&#128274;' : (l.is_completed ? '&#10003;' : '&#9675;');
				let cls = 'lp-s-lesson';
				if (ic) cls += ' lp-s-lesson--active';
				if (l.is_locked) cls += ' lp-s-lesson--locked';
				const nav = l.is_locked
					? 'onclick="frappe.msgprint(\'Avval oldingi darsni tugating\')"; title="Qulflangan"'
					: 'onclick="window.lms_player && window.lms_player._navigateLesson(\'' + encodeURIComponent(l.lesson_id) + '\')"';
				const pctBadge = (!l.is_completed && l.completion_percent > 0)
					? '<span style="font-size:10px;opacity:.7;margin-left:auto">' + Math.round(l.completion_percent) + '%</span>' : '';

				h += '<div class="' + cls + '" ' + nav + '>' +
					'<span class="lp-s-icon">' + icon + '</span>' +
					'<span class="lp-s-text">' + this._esc(l.lesson_title) + '</span>' +
					pctBadge +
					'</div>';
			}, this);

			h += '</div></div>';
		}, this);

		return '<div class="lp-sidebar" id="lp-sidebar">' +
			'<div class="lp-s-hdr">' +
			'<span>Kurs bo\'limlari</span>' +
			'<button class="lp-icon-btn" id="lp-close-sb" title="Yopish">&#10005;</button>' +
			'</div>' +
			'<div class="lp-s-body">' +
			(h || '<p style="padding:16px;opacity:.5">Bo\'limlar topilmadi</p>') +
			'</div>' +
			'</div>';
	}

	/** Sidebar'dan dars navigatsiyasi — sessiyani to'g'ri yopadi */
	_navigateLesson(encodedId) {
		this._stopTracking('navigation');
		window.location.href = '/app/lms-player?lesson=' + encodedId;
	}

	/* ── Actions bar ─────────────────────────────────────────────── */
	_actions(L) {
		const P = this.data.progress;
		const pct = P.completion_percent || 0;
		const quizUnlocked = pct >= 90 || P.is_completed;
		const oqStatus = this.data.oq_status;

		let h = '<div class="lp-actions" id="lp-actions">';

		if (L.has_quiz) {
			if (quizUnlocked) {
				h += '<button class="lp-btn lp-btn-primary" id="lp-quiz">&#129504; Test boshlash</button>';
			} else {
				h += '<button class="lp-btn lp-btn-primary" id="lp-quiz" disabled ' +
					'title="Testni boshlash uchun videoni 90% ko&#39;ring (' + Math.round(pct) + '% ko\'rildi)" ' +
					'style="opacity:.45;cursor:not-allowed">&#129504; Test boshlash (' + Math.round(pct) + '%)</button>';
			}
		}

		if (L.has_open_questions) {
			let oqLabel = '&#9998; Savollar';
			let oqStyle = '';
			if (oqStatus) {
				if (oqStatus.graded === oqStatus.total_questions && oqStatus.total_questions > 0) {
					oqLabel = '&#10003; Savollar yakunlandi';
					oqStyle = 'style="background:rgba(16,185,129,0.25);border-color:rgba(16,185,129,0.5);color:#34d399"';
				} else if (oqStatus.pending > 0) {
					oqLabel = '&#9203; Tekshirilmoqda (' + oqStatus.pending + ')';
					oqStyle = 'style="background:rgba(245,158,11,0.2);border-color:rgba(245,158,11,0.4);color:#fbbf24"';
				} else if (oqStatus.answered === oqStatus.total_questions && oqStatus.total_questions > 0) {
					oqLabel = '&#10003; Javob berildi';
					oqStyle = 'style="background:rgba(16,185,129,0.15);color:#34d399"';
				}
			}
			if (quizUnlocked) {
				h += '<button class="lp-btn lp-btn-oq" id="lp-open-q" ' + oqStyle + '>' + oqLabel + '</button>';
			} else {
				h += '<button class="lp-btn lp-btn-oq" id="lp-open-q" disabled ' +
					'title="Savollarni ochish uchun videoni 90% ko&#39;ring (' + Math.round(pct) + '% ko\'rildi)" ' +
					'style="opacity:.45;cursor:not-allowed">&#9998; Savollar (' + Math.round(pct) + '%)</button>';
			}
		}

		if (L.has_assignment) {
			h += '<button class="lp-btn lp-btn-secondary" id="lp-assign">&#128203; Vazifa topshirish</button>';
		}

		h += '</div>';
		return h;
	}

	/* ── Events ──────────────────────────────────────────────────── */
	_attachEvents() {
		// Back button — sessiyani navigation sababli yopadi
		document.getElementById('lp-back')?.addEventListener('click', () => {
			this._stopTracking('navigation');
			frappe.set_route('lms_dashboard');
		});

		document.getElementById('lp-toggle')?.addEventListener('click', () => {
			document.getElementById('lp-sidebar')?.classList.toggle('lp-sidebar--hidden');
		});
		document.getElementById('lp-close-sb')?.addEventListener('click', () => {
			document.getElementById('lp-sidebar')?.classList.add('lp-sidebar--hidden');
		});

		document.getElementById('lp-quiz')?.addEventListener('click', () => {
			if (document.getElementById('lp-quiz')?.disabled) return;
			this._openQuiz();
		});
		document.getElementById('lp-assign')?.addEventListener('click', () => {
			this._openAssignment();
		});
		document.getElementById('lp-open-q')?.addEventListener('click', () => {
			if (document.getElementById('lp-open-q')?.disabled) return;
			this._openOpenQuestions();
		});

		const vid = this.video_element;
		if (vid) {
			vid.addEventListener('timeupdate', () => this._onTime());
			vid.addEventListener('seeking', (e) => this._onSeek(e));
			vid.addEventListener('ended', () => this._save());
			setInterval(() => this._save(), this.save_interval);
		}

		if (this.ytVideoId && document.getElementById('lp-yt-mount')) {
			window._ytApiReady.then(() => {
				try { this._initYouTubePlayer(); } catch (e) {
					console.error('[LMS] YT player init failed:', e);
				}
			});
		}
	}

	/* ── YouTube IFrame Player ───────────────────────────────────── */
	_initYouTubePlayer() {
		const resumeSec = this._ytLastKnownTime || 0;
		this.ytPlayer = new YT.Player('lp-yt-mount', {
			videoId: this.ytVideoId,
			playerVars: { autoplay: 0, controls: 1, rel: 0, modestbranding: 1, start: Math.floor(resumeSec) },
			events: { onReady: (e) => this._onYTReady(e), onStateChange: (e) => this._onYTState(e) }
		});
	}

	_onYTReady(e) {
		try {
			const t = e.target.getCurrentTime() || 0;
			if (t > this._ytLastKnownTime) this._ytLastKnownTime = t;
		} catch (ex) { }
		this._ytReady = true;
		this._ytPollTimer = setInterval(() => this._ytPoll(), 2000);
		this._ytSaveTimer = setInterval(() => this._ytSave(), this.save_interval);
	}

	_onYTState(e) {
		if (e.data === 1) {  // PLAYING
			if (!this._ytPlayStarted) {
				this._ytPlayStarted = true;
				try {
					const cur = this.ytPlayer.getCurrentTime() || 0;
					if (cur > this._ytLastKnownTime) this._ytLastKnownTime = cur;
				} catch (ex) { }
			}
		}
		if (e.data === 0) {  // ENDED
			clearInterval(this._ytPollTimer);
			clearInterval(this._ytSaveTimer);
			this._ytSave(true);
		}
	}

	_ytPoll() {
		try {
			if (!this.ytPlayer || typeof this.ytPlayer.getCurrentTime !== 'function') return;
			const state = this.ytPlayer.getPlayerState();
			const current = this.ytPlayer.getCurrentTime();
			const duration = this.ytPlayer.getDuration();
			if (!duration) return;

			if (state === 1 && this._ytPlayStarted) {
				// ── Inactivity: video ijrosi = foydalanuvchi faol ────────
				if (this.inactivityEngine) this.inactivityEngine.pulse();

				// ── Session heartbeat sync (har 2s pollda SessionManager'ga ishonmaymiz,
				//    uning o'z 30s timer bor) ──────────────────────────────

				const TOLERANCE_SEC = 5;
				const pctNow = (this._ytLastKnownTime / duration) * 100;
				const skipEnforced = pctNow < 85;

				if (skipEnforced && current > this._ytLastKnownTime + TOLERANCE_SEC) {
					this.ytPlayer.seekTo(this._ytLastKnownTime, true);
					const ov = document.getElementById('lp-skip-warn');
					if (ov) {
						ov.style.display = 'flex';
						clearTimeout(this._ovt);
						this._ovt = setTimeout(() => { ov.style.display = 'none'; }, 3000);
					}
					return;
				}
				if (current > this._ytLastKnownTime) this._ytLastKnownTime = current;
				this._ytWatchedSec += 2;
			}

			const pct = (this._ytLastKnownTime / duration) * 100;
			const f = document.getElementById('lp-pfill');
			if (f) f.style.width = pct + '%';
			const b = document.getElementById('lp-pct');
			if (b) b.textContent = Math.round(pct) + '%';
			const s = document.getElementById('lp-stat-pct');
			if (s) s.textContent = Math.round(pct) + '%';

			if (this.data && this.data.progress) {
				this.data.progress.last_position_sec = Math.round(this._ytLastKnownTime);
				this.data.progress.completion_percent = pct;
			}

			if (pct >= 90 && !this._ytCompleted) {
				this._ytCompleted = true;
				this._ytSave(true);
				this._unlockActionButtons();
			}
		} catch (e) {
			console.warn('[LMS] ytPoll error:', e);
		}
	}

	_ytSave(force) {
		try {
			if (!this.ytPlayer || typeof this.ytPlayer.getDuration !== 'function') return;
			const duration = this.ytPlayer.getDuration();
			if (!duration && !force) return;
			const pct = Math.min(100, Math.round((this._ytLastKnownTime / (duration || 1)) * 100));
			const payload = {
				lesson_name: this.lesson_name,
				watch_time_sec: Math.round(this._ytWatchedSec),
				last_position_sec: Math.round(this._ytLastKnownTime),
				completion_percent: pct,
			};
			try { localStorage.setItem('lms_progress_' + this.lesson_name, JSON.stringify(payload)); } catch (e) { }
			frappe.call({
				method: 'pro_lms.lms_for_dbr.page.lms_player.lms_player.save_progress',
				args: payload,
				callback: (r) => {
					if (r.message && r.message.is_completed) {
						if (this.data) { this.data.progress.is_completed = true; this.data.progress.completion_percent = 100; }
						const b = document.getElementById('lp-pct');
						if (b) b.textContent = '100%';
						this._showNextLesson();
						try { localStorage.removeItem('lms_progress_' + this.lesson_name); } catch (e) { }
					}
				},
				error: () => {
					clearTimeout(this._ytRetry);
					this._ytRetry = setTimeout(() => this._ytSave(), 10000);
				}
			});
		} catch (e) {
			console.warn('[LMS] ytSave error:', e);
		}
	}

	/* ── 90% unlock ──────────────────────────────────────────────── */
	_unlockActionButtons() {
		const quizBtn = document.getElementById('lp-quiz');
		if (quizBtn && quizBtn.disabled) {
			quizBtn.disabled = false;
			quizBtn.style.opacity = '';
			quizBtn.style.cursor = '';
			quizBtn.textContent = '🧠 Test boshlash';
		}
		const oqBtn = document.getElementById('lp-open-q');
		if (oqBtn && oqBtn.disabled) {
			oqBtn.disabled = false;
			oqBtn.style.opacity = '';
			oqBtn.style.cursor = '';
			const oqStatus = this.data && this.data.oq_status;
			if (!oqStatus || !oqStatus.answered) {
				oqBtn.textContent = '✏️ Savollar';
			}
		}
	}

	/* ── Quiz Modal ──────────────────────────────────────────────── */
	_openQuiz() {
		const quizName = this.data.lesson.quiz;
		if (!quizName) {
			frappe.msgprint({ title: 'Test topilmadi', message: 'Bu darsga test biriktirilmagan.', indicator: 'orange' });
			return;
		}
		try { if (this.ytPlayer) this.ytPlayer.pauseVideo(); } catch (e) { }

		// ── Activity: Video → Quiz ──────────────────────────────────
		if (this.sessionManager) this.sessionManager.switchActivity('Quiz');

		frappe.call({
			method: 'pro_lms.lms_for_dbr.page.lms_player.lms_player.get_quiz',
			args: { quiz_name: quizName, lesson_name: this.lesson_name },
			callback: (r) => {
				if (!r.message || r.message.error) {
					frappe.msgprint({ title: 'Xato', message: (r.message && r.message.message) || 'Test yuklanmadi', indicator: 'red' });
					// Qaytarish
					if (this.sessionManager) this.sessionManager.switchActivity('Video');
					return;
				}
				this._renderQuizModal(r.message);
			}
		});
	}

	_renderQuizModal(data) {
		_injectQuizExtraCSS();

		const questions = data.questions;
		const quizMeta = data.quiz;
		const totalQ = questions.length;

		if (!totalQ) {
			frappe.msgprint({ title: "Test bo'sh", message: 'Savollar topilmadi.', indicator: 'orange' });
			if (this.sessionManager) this.sessionManager.switchActivity('Video');
			return;
		}

		/* ── Option shuffle: har savol uchun bir marta, sessiya davomida o'zgarmaydi ──
		   shuffleMap[q.name] = [ {text, origIdx}, ... ]
		   Shu tufayli "answers[q.name] = origIdx" doim to'g'ri saqlanadi.            */
		const shuffleMap = {};
		questions.forEach(q => {
			const indexed = (q.options || []).map((opt, i) => ({ text: opt.option_text, origIdx: i }));
			// Fisher-Yates shuffle
			for (let i = indexed.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[indexed[i], indexed[j]] = [indexed[j], indexed[i]];
			}
			shuffleMap[q.name] = indexed;
		});

		let curIdx = 0;
		const answers = {};          // { q.name → originalOptionIndex }
		let timerInterval = null;
		let startTime = Date.now();

		/* ── Savol xaritasi (overview) ── */
		const buildMap = () => {
			let h = '<div class="lms-qz-map">';
			questions.forEach((q, i) => {
				const answered = answers[q.name] !== undefined;
				const active = i === curIdx;
				h += `<button
					class="lms-qz-map-btn${answered ? ' qz-answered' : ''}${active ? ' qz-current' : ''}"
					data-qidx="${i}"
					title="Savol ${i + 1}${answered ? ' ✓' : ''}"
				>${i + 1}</button>`;
			});
			h += '</div>';
			return h;
		};

		/* ── Asosiy kontent ── */
		const buildBody = () => {
			const q = questions[curIdx];
			const opts = shuffleMap[q.name];           // shuffled
			const chosen = answers[q.name];               // origIdx yoki undefined
			const donePct = Math.round((Object.keys(answers).length / totalQ) * 100);
			const isLast = curIdx === totalQ - 1;
			const allDone = Object.keys(answers).length === totalQ;

			let html = `
			<div class="lms-quiz-wrap">
				${buildMap()}
				<div class="lms-qz-topbar">
					<span class="lms-qz-counter">${curIdx + 1} / ${totalQ}</span>
					<div class="lms-qz-prog">
						<div class="lms-qz-prog-fill" style="width:${donePct}%"></div>
					</div>
					${quizMeta.time_limit_min
					? '<span class="lms-qz-timer" id="lms-qz-timer">⏱ --:--</span>'
					: ''}
				</div>
				<p class="lms-qz-question">${frappe.utils.escape_html(q.question)}</p>
				<div class="lms-qz-marks">+${q.marks} ball</div>
				<div class="lms-qz-options">`;

			opts.forEach((opt) => {
				const sel = chosen === opt.origIdx;
				html += `<div class="lms-qz-opt${sel ? ' lms-qz-opt--selected' : ''}"
					data-orig-idx="${opt.origIdx}">
					<span class="lms-qz-opt-radio">${sel ? '&#9679;' : '&#9675;'}</span>
					<span>${frappe.utils.escape_html(opt.text)}</span>
				</div>`;
			});

			html += `</div>
				<div class="lms-qz-nav">
					<button class="lp-btn lp-btn-secondary" id="lms-qz-prev"
						${curIdx === 0 ? 'disabled style="opacity:.4"' : ''}>
						&#8592; Oldingi
					</button>
					<div class="lms-qz-nav-right">`;

			if (!isLast) {
				html += `<button class="lp-btn lp-btn-primary" id="lms-qz-next">
							Keyingi &#8594;
						</button>`;
			}

			html += `<button class="lp-btn lp-btn-primary" id="lms-qz-submit"
						${!allDone ? 'disabled style="opacity:.45;cursor:not-allowed"' : ''}
						title="${!allDone ? (totalQ - Object.keys(answers).length) + ' ta savol javobsiz' : 'Testni yakunlash'}">
						&#10003; Yakunlash${allDone ? '' : ' (' + Object.keys(answers).length + '/' + totalQ + ')'}
					</button>`;

			html += `</div></div></div>`;
			return html;
		};

		const d = new frappe.ui.Dialog({
			title: quizMeta.quiz_title || 'Test',
			size: 'large',
			fields: [{ fieldtype: 'HTML', fieldname: 'quiz_html' }],
			on_hide: () => {
				clearInterval(timerInterval);
				if (this.sessionManager) this.sessionManager.switchActivity('Video');
			}
		});

		const render = () => {
			d.fields_dict.quiz_html.$wrapper.html(buildBody());

			/* Option tanlash */
			d.fields_dict.quiz_html.$wrapper.find('.lms-qz-opt').on('click', function () {
				const origIdx = parseInt($(this).data('orig-idx'));
				answers[questions[curIdx].name] = origIdx;
				render();
			});

			/* Savol xaritasi (overview) */
			d.fields_dict.quiz_html.$wrapper.find('.lms-qz-map-btn').on('click', function () {
				const idx = parseInt($(this).data('qidx'));
				if (!isNaN(idx) && idx >= 0 && idx < totalQ) {
					curIdx = idx;
					render();
				}
			});

			/* Oldingi / Keyingi */
			d.$wrapper.find('#lms-qz-prev').on('click', () => {
				if (curIdx > 0) { curIdx--; render(); }
			});
			d.$wrapper.find('#lms-qz-next').on('click', () => {
				if (curIdx < totalQ - 1) { curIdx++; render(); }
			});

			/* Yakunlash */
			d.$wrapper.find('#lms-qz-submit').on('click', () => {
				if (Object.keys(answers).length < totalQ) return;
				clearInterval(timerInterval);
				this._submitQuiz(
					d, quizMeta, questions, answers,
					Math.round((Date.now() - startTime) / 1000)
				);
			});
		};

		d.show();
		render();

		/* ── Timer ── */
		if (quizMeta.time_limit_min) {
			let remaining = quizMeta.time_limit_min * 60;
			const tick = () => {
				remaining--;
				const m = String(Math.floor(remaining / 60)).padStart(2, '0');
				const s = String(remaining % 60).padStart(2, '0');
				const el = document.getElementById('lms-qz-timer');
				if (el) {
					el.textContent = `⏱ ${m}:${s}`;
					el.style.color = remaining <= 60 ? '#ef4444' : '#d97706';
				}
				if (remaining <= 0) {
					clearInterval(timerInterval);
					this._submitQuiz(d, quizMeta, questions, answers, quizMeta.time_limit_min * 60);
				}
			};
			timerInterval = setInterval(tick, 1000);
		}
	}


	_submitQuiz(dialog, quizMeta, questions, answers, timeTaken) {
		/* answers = { q.name → originalOptionIndex }
		   Bu serverga yuboriladi — server options ni idx asosida baholaydi.
		   Shuffle bo'lganida ham origIdx to'g'ri keladi.                    */
		const answersArr = questions.map(q => ({
			question: q.name,
			selected_option_idx: answers[q.name] !== undefined ? answers[q.name] : -1
		}));

		frappe.call({
			method: 'pro_lms.lms_for_dbr.page.lms_player.lms_player.submit_quiz',
			args: {
				quiz_name: quizMeta.name,
				lesson_name: this.lesson_name,
				answers: JSON.stringify(answersArr),
				time_taken_sec: timeTaken,
			},
			callback: (r) => {
				if (!r.message || r.message.error) {
					frappe.msgprint({
						title: 'Xato',
						message: (r.message && r.message.message) || 'Test saqlanmadi',
						indicator: 'red'
					});
					return;
				}

				const res = r.message;
				const passed = res.passed;
				const icon = passed ? '&#127881;' : '&#128543;';
				const color = passed ? '#22c55e' : '#ef4444';
				const msg = passed
					? `Tabriklaymiz! Siz <b>${res.score}/${res.total_marks}</b> ball bilan o'tdingiz!`
					: `Afsus, ${res.score}/${res.total_marks} ball. O'tish bali: ${res.passing_score}. Qayta urinib ko'ring!`;

				dialog.fields_dict.quiz_html.$wrapper.html(`
					<div style="text-align:center;padding:32px 16px">
						<div style="font-size:56px">${icon}</div>
						<h2 style="color:${color};margin:16px 0 8px">
							${passed ? "O'tdingiz!" : "Muvaffaqiyatsiz"}
						</h2>
						<p style="font-size:15px">${msg}</p>
						<div style="display:flex;justify-content:center;gap:12px;margin-top:24px">
							${!passed
						? '<button class="lp-btn lp-btn-primary" id="lms-qz-retry">&#8635; Qayta urinish</button>'
						: ''}
							<button class="lp-btn lp-btn-secondary" id="lms-qz-close">&#10005; Yopish</button>
						</div>
						<div style="margin-top:20px;text-align:left">
							${res.answer_review.map((a, i) => `
								<div style="
									padding:10px 12px;margin:6px 0;border-radius:8px;
									background:${a.correct ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)'};
									border:1px solid ${a.correct ? 'rgba(34,197,94,.2)' : 'rgba(239,68,68,.2)'}
								">
									<span style="font-weight:700;color:${a.correct ? '#22c55e' : '#ef4444'}">
										${a.correct ? '✓' : '✗'}
									</span>
									<b> ${i + 1}.</b> ${frappe.utils.escape_html(a.question)}
									${!a.correct
								? `<br><small style="color:#ef4444;margin-top:4px;display:block">
											To'g'ri javob: <b>${frappe.utils.escape_html(a.correct_answer)}</b>
										</small>`
								: ''}
								</div>`
						).join('')}
						</div>
					</div>`);

				dialog.$wrapper.find('#lms-qz-close').on('click', () => dialog.hide());
				dialog.$wrapper.find('#lms-qz-retry').on('click', () => {
					dialog.hide();
					this._openQuiz();
				});

				if (passed) {
					const qBtn = document.getElementById('lp-quiz');
					if (qBtn) {
						qBtn.textContent = '✓ Test o\'tildi';
						qBtn.style.background = '#22c55e';
					}
				}
			},
			error: () => frappe.msgprint({
				title: 'Server xatosi',
				message: 'Test natijasi saqlanmadi.',
				indicator: 'red'
			})
		});
	}


	/* ── Assignment Modal ────────────────────────────────────────── */
	_openAssignment() {
		try { if (this.ytPlayer) this.ytPlayer.pauseVideo(); } catch (e) { }
		// Assignment passive — activity type o'zgarmaydi

		const d = new frappe.ui.Dialog({
			title: '📋 Vazifa topshirish',
			size: 'small',
			fields: [
				{
					fieldtype: 'HTML',
					fieldname: 'info_html',
					options: `<p style="color:var(--text-muted);font-size:13px;margin-bottom:12px">
						Faylni yuklang. Qabul qilinadigan formatlar: PDF, DOCX, XLSX, ZIP, rasmlar.
					</p>`
				},
				{ fieldtype: 'Attach', fieldname: 'attached_file', label: 'Fayl yuklash', reqd: 1 }
			],
			primary_action_label: '📤 Topshirish',
			primary_action: (values) => {
				if (!values.attached_file) {
					frappe.msgprint({ title: 'Fayl tanlanmagan', message: 'Iltimos, fayl yuklang.', indicator: 'orange' });
					return;
				}
				d.disable_primary_action();
				frappe.call({
					method: 'pro_lms.lms_for_dbr.page.lms_player.lms_player.upload_assignment',
					args: { lesson_name: this.lesson_name, file_url: values.attached_file },
					callback: (r) => {
						d.enable_primary_action();
						if (!r.message || r.message.error) {
							frappe.msgprint({ title: 'Xato', message: (r.message && r.message.message) || 'Vazifa saqlanmadi', indicator: 'red' });
							return;
						}
						d.hide();
						frappe.show_alert({ message: r.message.updated ? '✅ Vazifa yangilandi!' : '✅ Vazifa muvaffaqiyatli topshirildi!', indicator: 'green' }, 5);
						const btn = document.getElementById('lp-assign');
						if (btn) { btn.textContent = '✓ Vazifa topshirildi'; btn.style.opacity = '0.7'; }
					},
					error: () => {
						d.enable_primary_action();
						frappe.msgprint({ title: 'Server xatosi', message: 'Qayta urinib ko\'ring.', indicator: 'red' });
					}
				});
			}
		});
		d.show();
	}

	/* ── Open Questions Modal ────────────────────────────────────── */
	_openOpenQuestions() {
		try { if (this.ytPlayer) this.ytPlayer.pauseVideo(); } catch (e) { }

		// ── Activity: Video → Open Question ────────────────────────
		if (this.sessionManager) this.sessionManager.switchActivity('Open Question');

		const d = new frappe.ui.Dialog({
			title: '✏️ Ochiq Savollar',
			size: 'large',
			fields: [{ fieldtype: 'HTML', fieldname: 'oq_html' }],
			on_hide: () => {
				// ── Activity: Open Question → Video ─────────────────
				if (this.sessionManager) this.sessionManager.switchActivity('Video');
			}
		});
		d.show();
		d.fields_dict.oq_html.$wrapper.html(
			'<div style="text-align:center;padding:40px">' +
			'<div class="lp-oq-spinner"></div>' +
			'<p style="margin-top:14px;color:#888;font-size:13px">Yuklanmoqda...</p></div>'
		);

		frappe.call({
			method: 'pro_lms.lms_for_dbr.page.lms_player.lms_player.get_open_questions',
			args: { lesson_name: this.lesson_name },
			callback: (r) => {
				if (!r.message || r.message.error) {
					d.fields_dict.oq_html.$wrapper.html(
						'<div class="lp-oq-err">⚠️ ' +
						this._esc((r.message && r.message.message) || 'Savollar yuklanmadi') +
						'</div>'
					);
					return;
				}
				this._renderOQModal(d, r.message);
			},
			error: () => {
				d.fields_dict.oq_html.$wrapper.html('<div class="lp-oq-err">⚠️ Server xatosi</div>');
			}
		});
	}

	_renderOQModal(dialog, data) {
		const questions = data.questions || [];
		if (!questions.length) {
			dialog.fields_dict.oq_html.$wrapper.html('<div class="lp-oq-err">📭 Savollar topilmadi</div>');
			return;
		}

		let html = '<div class="lp-oq-wrap">';
		html += `<div class="lp-oq-header">
			<div class="lp-oq-title">${this._esc(data.title)}</div>
			<div class="lp-oq-meta">
				<span class="lp-oq-chip">📊 Jami: ${data.total_marks} ball</span>
				${data.is_submitted
				? `<span class="lp-oq-chip lp-oq-chip-green">✓ Topshirildi (${data.answered_count}/${data.total_count})</span>`
				: `<span class="lp-oq-chip lp-oq-chip-orange">⏳ ${data.answered_count}/${data.total_count} javob berilgan</span>`
			}
				${data.all_graded && data.earned_marks > 0
				? `<span class="lp-oq-chip lp-oq-chip-blue">🏆 ${data.earned_marks}/${data.total_marks} ball</span>`
				: ''
			}
			</div>
		</div>`;

		questions.forEach((q, idx) => {
			const isGraded = q.status === 'Graded';
			const isPending = q.status === 'Pending';
			const isAuto = q.question_type === 'Auto';
			const isReadonly = isGraded || isPending;

			let badge = '';
			if (isGraded) {
				const c = q.score > 0 ? '#22c55e' : '#ef4444';
				badge = `<span class="lp-oq-badge" style="background:${c}18;color:${c};border-color:${c}40">${q.score > 0 ? '✓' : '✗'} ${q.score}/${q.marks} ball</span>`;
			} else if (isPending) {
				badge = `<span class="lp-oq-badge lp-oq-badge-pending">⏳ Tekshirilmoqda</span>`;
			} else if (isAuto) {
				badge = `<span class="lp-oq-badge lp-oq-badge-auto">🤖 Avtomatik</span>`;
			} else {
				badge = `<span class="lp-oq-badge lp-oq-badge-manual">👤 Admin tekshiradi</span>`;
			}

			html += `<div class="lp-oq-q ${isGraded ? 'lp-oq-q-graded' : ''} ${isPending ? 'lp-oq-q-pending' : ''}">
				<div class="lp-oq-q-head">
					<span class="lp-oq-q-num">${idx + 1}</span>
					<span class="lp-oq-q-text">${this._esc(q.question_text)}</span>
					<span class="lp-oq-q-marks">+${q.marks} ball</span>
					${badge}
				</div>
				<textarea
					class="lp-oq-ta"
					id="lp-oq-${this._esc(q.name)}"
					data-qitem="${this._esc(q.name)}"
					placeholder="Javobingizni yozing..."
					rows="3"
					${isReadonly ? 'readonly' : ''}
				>${this._esc(q.answer_text || '')}</textarea>`;

			if (isGraded && isAuto && q.correct_answer) {
				html += `<div class="lp-oq-correct ${q.score > 0 ? 'lp-oq-correct-ok' : 'lp-oq-correct-no'}">
					${q.score > 0 ? '✅' : '❌'} To'g'ri javob: <strong>${this._esc(q.correct_answer)}</strong>
				</div>`;
			}
			if (q.admin_feedback) {
				html += `<div class="lp-oq-feedback">💬 Admin izohi: <em>${this._esc(q.admin_feedback)}</em></div>`;
			}
			html += '</div>';
		});

		const hasUnsubmitted = questions.some(q => !q.status);
		const hasPending = questions.some(q => q.status === 'Pending');

		if (hasUnsubmitted) {
			html += `<div class="lp-oq-footer">
				<button class="lp-btn lp-btn-primary" id="lp-oq-submit">✓ Javoblarni yuborish</button>
				${hasPending ? '<span class="lp-oq-hint">⚠️ Baʼzi javoblar tekshirilishini kutmoqda</span>' : ''}
			</div>`;
		} else if (hasPending) {
			html += `<div class="lp-oq-footer">
				<div class="lp-oq-pending-info">⏳ Barcha javoblar yuborildi. Admin tekshirmoqda...</div>
			</div>`;
		}

		html += '</div>';
		dialog.fields_dict.oq_html.$wrapper.html(html);

		dialog.$wrapper.find('#lp-oq-submit').on('click', () => {
			this._submitOQAnswers(dialog, questions, data);
		});
	}

	_submitOQAnswers(dialog, questions, data) {
		const toSubmit = [];
		let hasEmpty = false;

		questions.forEach(q => {
			if (q.status === 'Graded' || q.status === 'Pending') return;
			const ta = document.getElementById('lp-oq-' + q.name);
			const text = ta ? ta.value.trim() : '';
			if (!text) {
				hasEmpty = true;
				if (ta) ta.classList.add('lp-oq-ta-err');
				return;
			}
			if (ta) ta.classList.remove('lp-oq-ta-err');
			toSubmit.push({ question_item: q.name, answer_text: text });
		});

		if (hasEmpty) {
			frappe.show_alert({ message: '⚠️ Barcha savollarga javob yozing', indicator: 'orange' }, 3);
			return;
		}
		if (!toSubmit.length) {
			frappe.show_alert({ message: 'Yangi javob yo\'q', indicator: 'orange' }, 3);
			return;
		}

		const submitBtn = dialog.$wrapper.find('#lp-oq-submit');
		submitBtn.prop('disabled', true).html('<span class="lp-oq-spinner-sm"></span> Yuklanmoqda...');

		frappe.call({
			method: 'pro_lms.lms_for_dbr.page.lms_player.lms_player.submit_open_answers',
			args: { lesson_name: this.lesson_name, answers: JSON.stringify(toSubmit) },
			callback: (r) => {
				submitBtn.prop('disabled', false).text('✓ Javoblarni yuborish');

				if (!r.message || r.message.error) {
					frappe.msgprint({ title: 'Xato', message: (r.message && r.message.message) || 'Javoblar saqlanmadi', indicator: 'red' });
					return;
				}

				const res = r.message;
				let autoCorrect = 0;
				let autoWrong = 0;
				let manualPending = 0;

				(res.results || []).forEach(item => {
					if (item.status === 'Graded') { item.score > 0 ? autoCorrect++ : autoWrong++; }
					else if (item.status === 'Pending') { manualPending++; }
				});

				let rhtml = '<div class="lp-oq-result">';
				rhtml += '<div style="font-size:52px;margin-bottom:12px">📝</div>';
				rhtml += '<h3 class="lp-oq-result-title">Javoblar yuborildi!</h3>';

				if (autoCorrect > 0 || autoWrong > 0) {
					rhtml += `<div class="lp-oq-result-row">
						<span class="lp-oq-chip lp-oq-chip-green">✓ To'g'ri: ${autoCorrect}</span>
						${autoWrong > 0 ? `<span class="lp-oq-chip lp-oq-chip-red">✗ Noto'g'ri: ${autoWrong}</span>` : ''}
						<span class="lp-oq-chip">🏆 Ball: ${res.auto_score}</span>
					</div>`;
				}
				if (manualPending > 0) {
					rhtml += `<div class="lp-oq-result-row" style="margin-top:8px">
						<span class="lp-oq-chip lp-oq-chip-orange">⏳ Admin tekshirishini kutmoqda: ${manualPending} ta</span>
					</div>`;
				}

				rhtml += `<div style="display:flex;gap:10px;justify-content:center;margin-top:24px">
					<button class="lp-btn lp-btn-secondary" id="lp-oq-reopen">📊 Natijalarni ko'rish</button>
					<button class="lp-btn lp-btn-primary" id="lp-oq-close">✓ Yopish</button>
				</div></div>`;

				dialog.fields_dict.oq_html.$wrapper.html(rhtml);
				this._updateOQButton(manualPending, autoCorrect + autoWrong, res.auto_score);

				dialog.$wrapper.find('#lp-oq-close').on('click', () => dialog.hide());
				dialog.$wrapper.find('#lp-oq-reopen').on('click', () => {
					dialog.hide();
					setTimeout(() => this._openOpenQuestions(), 250);
				});
			},
			error: () => {
				submitBtn.prop('disabled', false).text('✓ Javoblarni yuborish');
				frappe.msgprint({ title: 'Server xatosi', message: 'Qayta urinib ko\'ring.', indicator: 'red' });
			}
		});
	}

	_updateOQButton(pendingCount, gradedCount, autoScore) {
		const btn = document.getElementById('lp-open-q');
		if (!btn) return;
		if (pendingCount > 0) {
			btn.textContent = `⏳ Tekshirilmoqda (${pendingCount})`;
			btn.style.background = 'rgba(245,158,11,0.2)';
			btn.style.color = '#fbbf24';
		} else if (gradedCount > 0) {
			btn.textContent = '✓ Savollar yakunlandi';
			btn.style.background = 'rgba(16,185,129,0.2)';
			btn.style.color = '#34d399';
		}
	}

	/* ── Native video logic ──────────────────────────────────────── */
	_onTime() {
		const now = Date.now();
		if (now - (this._lastTimeUpdate || 0) < 250) return;
		this._lastTimeUpdate = now;

		const vid = this.video_element;
		if (!vid || !vid.duration) return;

		// ── Inactivity: video ijrosi = foydalanuvchi faol ──────────
		if (!vid.paused && this.inactivityEngine) {
			this.inactivityEngine.pulse();
		}

		const pct = (vid.currentTime / vid.duration) * 100;
		const f = document.getElementById('lp-pfill');
		if (f) f.style.width = pct + '%';
		const b = document.getElementById('lp-pct');
		if (b) b.textContent = Math.round(pct) + '%';
		const s = document.getElementById('lp-stat-pct');
		if (s) s.textContent = Math.round(pct) + '%';

		if (this.data && this.data.progress) {
			this.data.progress.last_position_sec = Math.round(vid.currentTime);
			this.data.progress.completion_percent = pct;
		}
		if (pct >= 90 && !this._vidCompleted) {
			this._vidCompleted = true;
			this._unlockActionButtons();
		}
	}

	_onSeek(e) {
		const vid = e.target;
		if (!vid.duration) return;
		const saved = this.data?.progress?.completion_percent || 0;
		const req = (vid.currentTime / vid.duration) * 100;
		if (saved < 90 && req > saved + 2) {
			vid.currentTime = this.data?.progress?.last_position_sec || 0;
			const ov = document.getElementById('lp-skip-warn');
			if (ov) {
				ov.style.display = 'flex';
				clearTimeout(this._ovt);
				this._ovt = setTimeout(() => { ov.style.display = 'none'; }, 3000);
			}
		}
	}

	_save() {
		const vid = this.video_element;
		if (!vid || !vid.duration) return;
		const t = vid.currentTime || 0;
		const pct = Math.round((t / vid.duration) * 100);
		const payload = {
			lesson_name: this.lesson_name,
			watch_time_sec: Math.round(t),
			last_position_sec: Math.round(t),
			completion_percent: pct
		};
		try { localStorage.setItem('lms_progress_' + this.lesson_name, JSON.stringify(payload)); } catch (e) { }
		frappe.call({
			method: 'pro_lms.lms_for_dbr.page.lms_player.lms_player.save_progress',
			args: payload,
			callback: (r) => {
				if (r.message && r.message.is_completed) {
					if (this.data) { this.data.progress.is_completed = true; this.data.progress.completion_percent = 100; }
					const b = document.getElementById('lp-pct');
					if (b) b.textContent = '100%';
					this._showNextLesson();
					try { localStorage.removeItem('lms_progress_' + this.lesson_name); } catch (e) { }
				}
			},
			error: () => {
				clearTimeout(this._retryTimer);
				this._retryTimer = setTimeout(() => this._save(), 10000);
			}
		});
	}

	_showNextLesson() {
		if (!this.data?.hierarchy) return;
		let nextId = null, nextTitle = null, found = false;
		outer: for (const sec of this.data.hierarchy) {
			for (const l of sec.lessons) {
				if (found) { nextId = l.lesson_id; nextTitle = l.lesson_title; break outer; }
				if (l.lesson_id === this.lesson_name) found = true;
			}
		}
		const acts = document.getElementById('lp-actions');
		if (!acts) return;
		document.getElementById('lp-next-btn')?.remove();
		if (nextId) {
			const btn = document.createElement('a');
			btn.id = 'lp-next-btn';
			btn.className = 'lp-btn lp-btn-primary';
			btn.href = '/app/lms-player?lesson=' + encodeURIComponent(nextId);
			btn.addEventListener('click', (e) => {
				e.preventDefault();
				this._stopTracking('navigation');
				window.location.href = btn.href;
			});
			btn.textContent = '\u25b6 Keyingi dars: ' + (nextTitle || '');
			acts.appendChild(btn);
		} else {
			const done = document.createElement('span');
			done.id = 'lp-next-btn';
			done.className = 'lp-done-badge';
			done.textContent = '\u2713 Kurs yakunlandi!';
			acts.appendChild(done);
		}
	}

	/* ── Helpers ─────────────────────────────────────────────────── */
	_esc(v) {
		if (!v) return '';
		return String(v).replace(/[&<>"']/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c];
		});
	}

	_err(title, detail) {
		return '<div class="lp-errpage"><div class="lp-errbox">' +
			'<h2>Xato</h2>' +
			'<p class="lp-err-title">' + this._esc(title) + '</p>' +
			(detail ? '<p class="lp-err-detail">' + detail + '</p>' : '') +
			'<a href="/app/lms_dashboard" class="lp-btn lp-btn-p">&larr; Dashboardga qaytish</a>' +
			'</div></div>';
	}
}
