frappe.pages['lms-player'].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({ parent: wrapper, title: 'LMS Player', single_column: true });
	frappe.after_ajax(() => {
		_ensurePhotoSwipeDom();
		_loadYouTubeAPI();
		window.lms_player = new LMSPlayer(wrapper);
	});
};

/**
 * PhotoSwipe / share-modal.js CRASH GUARD  v2
 * ─────────────────────────────────────────────────────────────────────────────
 * photoswipe-ui-default.js calls `.addEventListener()` on
 * `.pswp__share-modal > *` — if that element is null the whole page throws.
 *
 * Two-layer defense:
 *  1. Patch EventTarget.prototype.addEventListener to be null-safe globally.
 *     This is surgical: we only skip the call when `this` is null/undefined.
 *  2. Inject the minimal .pswp DOM skeleton so PhotoSwipe finds real nodes.
 */
function _ensurePhotoSwipeDom() {
	// ── Layer 1: null-safe addEventListener patch ────────────────────────────
	if (!window.__lms_ael_patched) {
		const _orig = EventTarget.prototype.addEventListener;
		EventTarget.prototype.addEventListener = function (type, fn, opts) {
			if (this == null) return; // photoswipe null-ref guard
			return _orig.call(this, type, fn, opts);
		};
		window.__lms_ael_patched = true;
	}

	// ── Layer 2: inject .pswp skeleton if absent ─────────────────────────────
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
			'<div class="pswp__item"></div>',
			'<div class="pswp__item"></div>',
			'<div class="pswp__item"></div>',
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
			'</div>',
			'</div>'
		].join('');
		document.body.appendChild(pswp);
	} catch (e) {
		console.warn('[LMS] PhotoSwipe DOM guard failed silently:', e);
	}
}

/**
 * YouTube IFrame API Loader
 * ─────────────────────────────────────────────────────────────────────────────
 * Injects the YouTube IFrame API script tag once per session.
 * Sets window._ytApiReady promise so LMSPlayer can await it.
 */
function _loadYouTubeAPI() {
	if (window._ytApiReady) return; // already loading / loaded
	window._ytApiReady = new Promise((resolve) => {
		if (window.YT && window.YT.Player) {
			resolve(window.YT);
			return;
		}
		const prev = window.onYouTubeIframeAPIReady;
		window.onYouTubeIframeAPIReady = function () {
			try { if (prev) prev(); } catch (e) {}
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

/**
 * Client-side YouTube URL Normalizer
 * Mirrors the Python backend logic for any URLs stored in video_url field.
 */
function _extractYouTubeId(url) {
	if (!url) return null;
	// Bare 11-char ID
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

class LMSPlayer {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.lesson_name = this._resolveLesson();
		this.data = null;
		this.save_interval = 5000;
		this.video_element = null;   // native <video> reference
		this.ytPlayer    = null;     // YT.Player instance
		this.ytVideoId   = null;     // resolved YouTube video ID
		this._ytLastKnownTime = 0;   // anti-skip: farthest watched position
		this._ytWatchedSec    = 0;   // total seconds watched (YouTube)
		this._ytSaveTimer     = null;
		this._init();
	}

	/**
	 * Resolve lesson ID from multiple possible sources.
	 * Frappe SPA can pass parameters via route_options, query string,
	 * or hash-based query string depending on how the user navigated.
	 */
	_resolveLesson() {
		// Tier 1: frappe.route_options (most reliable inside SPA)
		if (frappe.route_options && frappe.route_options.lesson) {
			const val = frappe.route_options.lesson;
			delete frappe.route_options.lesson;
			return val;
		}
		// Tier 2: real query string (works after hard-reload or direct URL)
		const qs = new URLSearchParams(window.location.search).get('lesson');
		if (qs) return qs;
		// Tier 3: hash-embedded query string (#app/lms-player?lesson=...)
		try {
			const hash = window.location.hash || '';
			const qi = hash.indexOf('?');
			if (qi !== -1) {
				return new URLSearchParams(hash.slice(qi)).get('lesson') || null;
			}
		} catch (e) { }
		return null;
	}

	_init() {
		const $b = this.wrapper.querySelector('.layout-main-section') || this.wrapper;
		this.$b = $b;
		if (!this.lesson_name) {
			$b.innerHTML = this._err(
				"Dars topilmadi",
				"URL da <code>?lesson=Lesson-00001</code> parametri yo'q. " +
				"Iltimos, Dashboard orqali kurs ochib, darsni tanlang."
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
			},
			error: () => { $b.innerHTML = this._err('Server xatosi'); }
		});
	}

	/* ── Render ──────────────────────────────────────────────────── */
	_render() {
		const L = this.data.lesson;
		const P = this.data.progress;
		const isLocked = !!this.data.is_locked;
		const pct = Math.round(P.completion_percent || 0);
		const wm = Math.floor((P.watch_time_sec || 0) / 60);
		const ws = String((P.watch_time_sec || 0) % 60).padStart(2, '0');

		// Seed anti-skip tracker from backend resume point
		this._ytLastKnownTime = P.last_position_sec || 0;
		this._ytWatchedSec    = P.watch_time_sec    || 0;

		// Resolve YouTube ID on client side as fallback
		this.ytVideoId = L.youtube_id || _extractYouTubeId(L.video_url);

		this.$b.innerHTML =
			'<div class="lp-page" id="lp-page">' +

			/* ── topbar ── */
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

			/* ── main ── */
			'<div class="lp-main">' +
			'<div class="lp-left">' +
			this._video(L, pct, isLocked) +
			/* info bar */
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

		const ytId = this.ytVideoId;

		if (ytId) {
			// Render a plain div as mount point — YT.Player replaces it with iframe
			// Anti-skip warning overlay
			const skipWarn = '<div class="lp-lock-overlay" id="lp-skip-warn" style="display:none;">' +
				'<div class="lp-lock-msg" style="background:rgba(245,158,11,0.92)">' +
				'&#9888; Oldinga o\'tkazib bo\'lmaydi<br>' +
				'<small>' + pct + '% ko\'rildi, 90% kerak</small></div></div>';
			return '<div class="lp-video-container">' + lockOverlay + skipWarn +
				'<div id="lp-yt-mount"></div>' +
				'</div>' +
				'<div class="lp-progress-line"><div class="lp-progress-fill" id="lp-pfill" style="width:' + pct + '%"></div></div>';
		}
		if (L.video_url) {
			const skipWarn = '<div class="lp-lock-overlay" id="lp-skip-warn" style="display:none;">' +
				'<div class="lp-lock-msg" style="background:rgba(245,158,11,0.92)">' +
				'&#9888; Oldinga o\'tkazib bo\'lmaydi<br>' +
				'<small>' + pct + '% ko\'rildi, 90% kerak</small></div></div>';
			return '<div class="lp-video-container">' + lockOverlay + skipWarn +
				'<video id="lp-video" controls preload="metadata" playsinline' +
				(isLocked ? ' style="pointer-events:none"' : '') + '>' +
				'<source src="' + this._esc(L.video_url) + '">' +
				'Brauzeringiz video elementni qo\'llab-quvvatlamaydi.' +
				'</video>' +
				'</div>' +
				'<div class="lp-progress-line"><div class="lp-progress-fill" id="lp-pfill" style="width:' + pct + '%"></div></div>';
		}
		// No video at all — show a clear UI alert
		return '<div class="lp-no-video">' +
			'<div class="lp-no-video-inner">' +
			'<span class="lp-no-video-icon">&#127909;</span>' +
			'<p class="lp-no-video-title">Video yuklanmagan</p>' +
			'<p class="lp-no-video-sub">Ushbu darsga video fayl yoki YouTube havolasi biriktirilmagan.<br>' +
			'Administrator bilan bog\'laning.</p>' +
			'</div>' +
			'</div>';
	}

	/* ── Tree Sidebar ────────────────────────────────────────────── */
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
					: 'onclick="window.location.href=\'/app/lms-player?lesson=' + encodeURIComponent(l.lesson_id) + '\'"';
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

	_actions(L) {
		const P = this.data.progress;
		const pct = P.completion_percent || 0;
		const quizUnlocked = pct >= 90 || P.is_completed;
		let h = '<div class="lp-actions" id="lp-actions">';
		if (L.has_quiz) {
			if (quizUnlocked) {
				h += '<button class="lp-btn lp-btn-primary" id="lp-quiz">&#129504; Test boshlash</button>';
			} else {
				h += '<button class="lp-btn lp-btn-primary" id="lp-quiz" disabled ' +
					'title="Testni boshlash uchun videoni 90% ko&#39;ring (' + Math.round(pct) + '% ko&#39;rildi)" ' +
					'style="opacity:.45;cursor:not-allowed">&#129504; Test boshlash (' + Math.round(pct) + '%)</button>';
			}
		}
		if (L.has_assignment)
			h += '<button class="lp-btn lp-btn-secondary" id="lp-assign">&#128203; Vazifa topshirish</button>';
		h += '</div>';
		return h;
	}

	/* ── Events ──────────────────────────────────────────────────── */
	_attachEvents() {
		// lms_dashboard is the page_name (underscore) for the Dashboard page
		document.getElementById('lp-back')?.addEventListener('click', () => {
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

		const vid = this.video_element;
		if (vid) {
			vid.addEventListener('timeupdate', () => this._onTime());
			vid.addEventListener('seeking', (e) => this._onSeek(e));
			vid.addEventListener('ended', () => this._save());
			setInterval(() => this._save(), this.save_interval);
		}

		// ── YouTube IFrame API init ───────────────────────────────────
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
			playerVars: {
				autoplay:       0,
				controls:       1,
				rel:            0,
				modestbranding: 1,
				start:          Math.floor(resumeSec),
			},
			events: {
				onReady:       (e) => this._onYTReady(e),
				onStateChange: (e) => this._onYTState(e),
			}
		});
	}

	_onYTReady(e) {
		// Sync tracker to wherever the player actually starts (resume point)
		// This MUST happen before the poll starts — otherwise first poll sees
		// getCurrentTime() > _ytLastKnownTime and falsely triggers anti-skip.
		try {
			const actualStart = e.target.getCurrentTime() || 0;
			if (actualStart > this._ytLastKnownTime) {
				this._ytLastKnownTime = actualStart;
			}
		} catch (ex) {}
		// Mark player as ready — poll will only enforce anti-skip after this
		this._ytReady = true;
		// Anti-skip: poll every 2 seconds
		this._ytPollTimer = setInterval(() => this._ytPoll(), 2000);
		// Save-to-backend every 5 seconds
		this._ytSaveTimer = setInterval(() => this._ytSave(), this.save_interval);
	}

	_onYTState(e) {
		// YT.PlayerState: -1=unstarted, 0=ended, 1=playing, 2=paused, 3=buffering, 5=cued
		if (e.data === 1) {
			// First real play: sync tracker to actual position to prevent false anti-skip
			if (!this._ytPlayStarted) {
				this._ytPlayStarted = true;
				try {
					const cur = this.ytPlayer.getCurrentTime() || 0;
					if (cur > this._ytLastKnownTime) this._ytLastKnownTime = cur;
				} catch (ex) {}
			}
		}
		if (e.data === 0) {
			clearInterval(this._ytPollTimer);
			clearInterval(this._ytSaveTimer);
			this._ytSave(true);
		}
	}

	_ytPoll() {
		try {
			if (!this.ytPlayer || typeof this.ytPlayer.getCurrentTime !== 'function') return;
			const state    = this.ytPlayer.getPlayerState(); // 1 = playing
			const current  = this.ytPlayer.getCurrentTime();
			const duration = this.ytPlayer.getDuration();
			if (!duration) return;

			// ── Anti-skip logic ──────────────────────────────────────────────────────
			// Rules:
			//  1. Only enforce after user has actually pressed Play (_ytPlayStarted).
			//  2. TOLERANCE: allow up to +5s jump — covers buffering/frame-drops.
			//  3. DISABLED entirely when pct >= 85% — user is near the end, no point.
			if (state === 1 && this._ytPlayStarted) {
				const TOLERANCE_SEC = 5;
				const pctNow = (this._ytLastKnownTime / duration) * 100;
				const skipEnforced = pctNow < 85; // disable anti-skip in last 15%

				if (skipEnforced && current > this._ytLastKnownTime + TOLERANCE_SEC) {
					// User jumped ahead beyond tolerance — snap back, keep playing
					this.ytPlayer.seekTo(this._ytLastKnownTime, true);
					// player continues playing after seekTo — no pause needed
					const ov = document.getElementById('lp-skip-warn');
					if (ov) {
						ov.style.display = 'flex';
						clearTimeout(this._ovt);
						this._ovt = setTimeout(() => { ov.style.display = 'none'; }, 3000);
					}
					return; // don't advance tracker after snap-back
				}
				// Advance the farthest-watched tracker
				if (current > this._ytLastKnownTime) {
					this._ytLastKnownTime = current;
				}
				this._ytWatchedSec += 2;
			}

			// ── Progress bar & badges ────────────────────────────────
			const pct = (this._ytLastKnownTime / duration) * 100;
			const f   = document.getElementById('lp-pfill');
			if (f) f.style.width = pct + '%';
			const b = document.getElementById('lp-pct');
			if (b) b.textContent = Math.round(pct) + '%';
			const s = document.getElementById('lp-stat-pct');
			if (s) s.textContent = Math.round(pct) + '%';

			if (this.data && this.data.progress) {
				this.data.progress.last_position_sec  = Math.round(this._ytLastKnownTime);
				this.data.progress.completion_percent = pct;
			}

			// ── 90% completion trigger ───────────────────────────────
			if (pct >= 90 && !this._ytCompleted) {
				this._ytCompleted = true;
				this._ytSave(true);
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
				lesson_name:        this.lesson_name,
				watch_time_sec:     Math.round(this._ytWatchedSec),
				last_position_sec:  Math.round(this._ytLastKnownTime),
				completion_percent: pct,
			};
			try { localStorage.setItem('lms_progress_' + this.lesson_name, JSON.stringify(payload)); } catch (e) {}
			frappe.call({
				method: 'pro_lms.lms_for_dbr.page.lms_player.lms_player.save_progress',
				args: payload,
				callback: (r) => {
					if (r.message && r.message.is_completed) {
						if (this.data) { this.data.progress.is_completed = true; this.data.progress.completion_percent = 100; }
						const b = document.getElementById('lp-pct');
						if (b) b.textContent = '100%';
						this._showNextLesson();
						try { localStorage.removeItem('lms_progress_' + this.lesson_name); } catch (e) {}
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

	/* ── Quiz Modal ──────────────────────────────────────────────── */
	_openQuiz() {
		const quizName = this.data.lesson.quiz;
		if (!quizName) {
			frappe.msgprint({ title: 'Test topilmadi', message: 'Bu darsga test biriktirilmagan.', indicator: 'orange' });
			return;
		}
		// Pause YouTube player while quiz is open
		try { if (this.ytPlayer) this.ytPlayer.pauseVideo(); } catch (e) {}

		frappe.call({
			method: 'pro_lms.lms_for_dbr.page.lms_player.lms_player.get_quiz',
			args: { quiz_name: quizName, lesson_name: this.lesson_name },
			callback: (r) => {
				if (!r.message || r.message.error) {
					frappe.msgprint({ title: 'Xato', message: (r.message && r.message.message) || 'Test yuklanmadi', indicator: 'red' });
					return;
				}
				this._renderQuizModal(r.message);
			}
		});
	}

	_renderQuizModal(data) {
		const questions  = data.questions;   // [{name, question, marks, options:[{option_text,is_correct}]}]
		const quizMeta   = data.quiz;         // {name, quiz_title, passing_score, time_limit_min, max_attempts}
		const prevResult = data.last_attempt; // null or {score, total_marks, percentage, passed}
		const totalQ     = questions.length;
		if (!totalQ) {
			frappe.msgprint({ title: 'Test bo\'g', message: 'Savollar topilmadi.', indicator: 'orange' });
			return;
		}

		let curIdx   = 0;
		const answers = {}; // { question_name: selected_option_index }
		let timerInterval = null;
		let startTime = Date.now();

		const buildBody = () => {
			const q = questions[curIdx];
			const qNum = curIdx + 1;
			const chosen = answers[q.name];

			let html = `<div class="lms-quiz-wrap">`;

			// ── Progress bar ──
			const donePct = Math.round((Object.keys(answers).length / totalQ) * 100);
			html += `<div class="lms-qz-topbar">
				<span class="lms-qz-counter">${qNum} / ${totalQ}</span>
				<div class="lms-qz-prog"><div class="lms-qz-prog-fill" style="width:${donePct}%"></div></div>
				${quizMeta.time_limit_min ? '<span class="lms-qz-timer" id="lms-qz-timer">⏱ --:--</span>' : ''}
			</div>`;

			// ── Question ──
			html += `<p class="lms-qz-question">${frappe.utils.escape_html(q.question)}</p>`;
			html += `<div class="lms-qz-marks">+${q.marks} ball</div>`;

			// ── Options ──
			html += `<div class="lms-qz-options">`;
			(q.options || []).forEach((opt, i) => {
				const sel = chosen === i ? 'lms-qz-opt--selected' : '';
				html += `<div class="lms-qz-opt ${sel}" data-idx="${i}">
					<span class="lms-qz-opt-radio">${chosen === i ? '&#9679;' : '&#9675;'}</span>
					<span>${frappe.utils.escape_html(opt.option_text)}</span>
				</div>`;
			});
			html += `</div>`;

			// ── Navigation ──
			html += `<div class="lms-qz-nav">`;
			if (curIdx > 0)
				html += `<button class="lp-btn lp-btn-secondary" id="lms-qz-prev">&#8592; Oldingi</button>`;
			if (curIdx < totalQ - 1)
				html += `<button class="lp-btn lp-btn-primary" id="lms-qz-next" ${chosen === undefined ? 'disabled style="opacity:.5"' : ''}>Keyingi &#8594;</button>`;
			else
				html += `<button class="lp-btn lp-btn-primary" id="lms-qz-submit" ${Object.keys(answers).length < totalQ ? 'disabled style="opacity:.5;cursor:not-allowed" title="Barcha savollarga javob bering"' : ''}>&#10003; Testni yakunlash</button>`;
			html += `</div>`;

			html += `</div>`;
			return html;
		};

		const d = new frappe.ui.Dialog({
			title: quizMeta.quiz_title || 'Test',
			size: 'large',
			fields: [{ fieldtype: 'HTML', fieldname: 'quiz_html' }],
			on_hide: () => {
				clearInterval(timerInterval);
			}
		});

		const render = () => {
			d.fields_dict.quiz_html.$wrapper.html(buildBody());

			// Option click
			d.fields_dict.quiz_html.$wrapper.find('.lms-qz-opt').on('click', function () {
				const q = questions[curIdx];
				answers[q.name] = parseInt($(this).data('idx'));
				render();
			});
			// Prev
			d.$wrapper.find('#lms-qz-prev').on('click', () => { curIdx--; render(); });
			// Next
			d.$wrapper.find('#lms-qz-next').on('click', () => { curIdx++; render(); });
			// Submit
			d.$wrapper.find('#lms-qz-submit').on('click', () => {
				clearInterval(timerInterval);
				const timeTaken = Math.round((Date.now() - startTime) / 1000);
				this._submitQuiz(d, quizMeta, questions, answers, timeTaken);
			});
		};

		d.show();
		render();

		// ── Countdown timer ──────────────────────────────────────────
		if (quizMeta.time_limit_min) {
			let remaining = quizMeta.time_limit_min * 60;
			const tick = () => {
				remaining--;
				const m = String(Math.floor(remaining / 60)).padStart(2, '0');
				const s = String(remaining % 60).padStart(2, '0');
				const el = document.getElementById('lms-qz-timer');
				if (el) el.textContent = `⏱ ${m}:${s}`;
				if (remaining <= 0) {
					clearInterval(timerInterval);
					const timeTaken = quizMeta.time_limit_min * 60;
					this._submitQuiz(d, quizMeta, questions, answers, timeTaken);
				}
			};
			timerInterval = setInterval(tick, 1000);
		}
	}

	_submitQuiz(dialog, quizMeta, questions, answers, timeTaken) {
		// Build answers array: [{question, selected_option_idx}]
		const answersArr = questions.map(q => ({
			question: q.name,
			selected_option_idx: answers[q.name] !== undefined ? answers[q.name] : -1
		}));

		frappe.call({
			method: 'pro_lms.lms_for_dbr.page.lms_player.lms_player.submit_quiz',
			args: {
				quiz_name:    quizMeta.name,
				lesson_name:  this.lesson_name,
				answers:      JSON.stringify(answersArr),
				time_taken_sec: timeTaken,
			},
			callback: (r) => {
				if (!r.message || r.message.error) {
					frappe.msgprint({ title: 'Xato', message: (r.message && r.message.message) || 'Test saqlanmadi', indicator: 'red' });
					return;
				}
				const res = r.message;
				const passed = res.passed;
				const icon  = passed ? '&#127881;' : '&#128543;';
				const color = passed ? '#22c55e' : '#ef4444';
				const msg   = passed
					? `Tabriklaymiz! Siz <b>${res.score}/${res.total_marks}</b> ball bilan o'tdingiz!`
					: `Afsus, ${res.score}/${res.total_marks} ball. O'tish bali: ${res.passing_score}. Qayta urinib ko'ring!`;

				dialog.fields_dict.quiz_html.$wrapper.html(`
					<div style="text-align:center;padding:32px 16px">
						<div style="font-size:56px">${icon}</div>
						<h2 style="color:${color};margin:16px 0 8px">${passed ? "O'tdingiz!" : "Muvaffaqiyatsiz"}</h2>
						<p style="font-size:15px">${msg}</p>
						<div style="display:flex;justify-content:center;gap:12px;margin-top:24px">
							${!passed ? '<button class="lp-btn lp-btn-primary" id="lms-qz-retry">&#8635; Qayta urinish</button>' : ''}
							<button class="lp-btn lp-btn-secondary" id="lms-qz-close">&#10005; Yopish</button>
						</div>
						<div style="margin-top:20px">
							${res.answer_review.map((a, i) =>
								`<div style="text-align:left;padding:8px;margin:4px 0;border-radius:6px;background:${a.correct ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)'}">
									<span>${a.correct ? '✓' : '✗'}</span>
									<b>${i+1}.</b> ${frappe.utils.escape_html(a.question)}
									${!a.correct ? `<br><small style="color:#ef4444">To'g'ri javob: ${frappe.utils.escape_html(a.correct_answer)}</small>` : ''}
								</div>`
							).join('')}
						</div>
					</div>`);

				dialog.$wrapper.find('#lms-qz-close').on('click', () => dialog.hide());
				dialog.$wrapper.find('#lms-qz-retry').on('click', () => {
					dialog.hide();
					this._openQuiz();
				});

				// Update quiz button label if passed
				if (passed) {
					const qBtn = document.getElementById('lp-quiz');
					if (qBtn) { qBtn.textContent = '✓ Test o\'tildi'; qBtn.style.background = '#22c55e'; }
				}
			},
			error: () => frappe.msgprint({ title: 'Server xatosi', message: 'Test natijasi saqlanmadi.', indicator: 'red' })
		});
	}

	/* ── Assignment Modal ───────────────────────────────────────── */
	_openAssignment() {
		try { if (this.ytPlayer) this.ytPlayer.pauseVideo(); } catch (e) {}

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
				{
					fieldtype: 'Attach',
					fieldname: 'attached_file',
					label: 'Fayl yuklash',
					reqd: 1,
				}
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
					args: {
						lesson_name: this.lesson_name,
						file_url:    values.attached_file,
					},
					callback: (r) => {
						d.enable_primary_action();
						if (!r.message || r.message.error) {
							frappe.msgprint({
								title: 'Xato',
								message: (r.message && r.message.message) || 'Vazifa saqlanmadi',
								indicator: 'red'
							});
							return;
						}
						d.hide();
						frappe.show_alert({
							message: r.message.updated
								? '✅ Vazifa yangilandi!'
								: '✅ Vazifa muvaffaqiyatli topshirildi!',
							indicator: 'green'
						}, 5);
						// Update button to show submitted state
						const btn = document.getElementById('lp-assign');
						if (btn) {
							btn.textContent = '✓ Vazifa topshirildi';
							btn.style.opacity = '0.7';
						}
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

	/* ── Video logic ─────────────────────────────────────────────── */
	_onTime() {
		// Throttle: har 250ms dan bir marta DOM update (CPU tejash)
		const now = Date.now();
		if (now - (this._lastTimeUpdate || 0) < 250) return;
		this._lastTimeUpdate = now;

		const vid = this.video_element;
		if (!vid || !vid.duration) return;
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
	}

	_onSeek(e) {
		const vid = e.target;
		if (!vid.duration) return;
		// Optional chaining: safe access even if data not yet loaded
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
		// LocalStorage offline fallback — persist before network call
		try { localStorage.setItem('lms_progress_' + this.lesson_name, JSON.stringify(payload)); } catch (e) { }
		frappe.call({
			method: 'pro_lms.lms_for_dbr.page.lms_player.lms_player.save_progress',
			args: payload,
			callback: (r) => {
				if (r.message && r.message.is_completed) {
					if (this.data) this.data.progress.is_completed = true;
					if (this.data) this.data.progress.completion_percent = 100;
					const b = document.getElementById('lp-pct');
					if (b) b.textContent = '100%';
					// Auto-activate "Keyingi dars" button
					this._showNextLesson();
					// Clear offline cache on successful sync
					try { localStorage.removeItem('lms_progress_' + this.lesson_name); } catch (e) { }
				}
			},
			error: () => {
				// Offline: retry in 10s
				clearTimeout(this._retryTimer);
				this._retryTimer = setTimeout(() => this._save(), 10000);
			}
		});
	}

	_showNextLesson() {
		// Find next lesson in hierarchy and render a "Keyingi dars" button
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
