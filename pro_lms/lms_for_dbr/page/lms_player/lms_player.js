// ═══════════════════════════════════════════════════════════════
// SECTION 1: Page Initialization
// ═══════════════════════════════════════════════════════════════

frappe.pages["lms-player"].on_page_load = function (wrapper) {
    frappe.ui.make_app_page({
        parent: wrapper,
        title: "LMS Player",
        single_column: true,
    });
    localStorage.removeItem("_page:lms-player");
};

frappe.pages["lms-player"].on_page_hide = function (wrapper) {
    localStorage.removeItem("lms_player_active");
    if (wrapper.lms_player_instance) {
        wrapper.lms_player_instance.destroy();
        wrapper.lms_player_instance = null;
    }
};

frappe.pages["lms-player"].on_page_show = function (wrapper) {
    const TAB_KEY = "lms_player_active";
    localStorage.setItem(TAB_KEY, "1");

    const params = _parseUrlParams();

    if (!params.lesson || !params.enrollment) {
        $(wrapper).find(".layout-main-section").html(
            '<div class="lms-player-error">URL parametrlari yetishmayapti. <a href="/app/lms-dashboard">Dashboard</a></div>'
        );
        return;
    }

    wrapper.lms_player_instance = new LMSPlayer(wrapper, params);
};

function _parseUrlParams() {
    const stored = window._lms_player_params;
    if (stored && stored.lesson && stored.enrollment) {
        window._lms_player_params = null;
        return { lesson: stored.lesson, enrollment: stored.enrollment };
    }
    const opts = frappe.route_options || {};
    if (opts.lesson && opts.enrollment) {
        frappe.route_options = null;
        return { lesson: opts.lesson, enrollment: opts.enrollment };
    }
    const q = new URLSearchParams(window.location.search);
    return {
        lesson: q.get("lesson") || "",
        enrollment: q.get("enrollment") || "",
    };
}

// ═══════════════════════════════════════════════════════════════
// MAIN CLASS
// ═══════════════════════════════════════════════════════════════

class LMSPlayer {
    constructor(wrapper, params) {
        this.wrapper = wrapper;
        this.$main = $(wrapper).find(".layout-main-section");
        this.params = params;
        this.data = null;
        this.videoEngine = null;
        this.quizEngine = null;
        this.inactivityManager = null;
        this.timeLogger = null;
        this.currentActivity = "Video";
        this._destroyed = false;
        this._progressInterval = null;
        this._allIntervals = [];
        this._allListeners = [];

        this._render_skeleton();
        this._load_data();
    }

    _render_skeleton() {
        this.$main.html(`
            <div class="lms-player-wrapper" id="lms-player-root">
                <div class="lms-player-sidebar" id="lms-sidebar">
                    <div class="lms-sidebar-header">
                        <button class="lms-sidebar-close" id="lms-sidebar-close">✕</button>
                        <div class="lms-sidebar-title">Kurs tuzilmasi</div>
                    </div>
                    <div class="lms-sidebar-body" id="lms-sidebar-body">
                        <div class="lms-loading-spin"></div>
                    </div>
                </div>
                <div class="lms-player-main" id="lms-player-main">
                    <div class="lms-player-topbar">
                        <button class="lms-hamburger" id="lms-hamburger">☰</button>
                        <span class="lms-topbar-title" id="lms-topbar-title">Yuklanmoqda...</span>
                        <span class="lms-enrollment-badge" id="lms-enr-badge"></span>
                        <!-- FIX 3: Dashboard button in topbar -->
                        <button class="lms-btn lms-btn-secondary lms-dash-back-btn" id="lms-dash-btn" title="Dashboardga qaytish">
                            ← Dashboard
                        </button>
                    </div>
                    <div class="lms-player-video-wrap" id="lms-video-wrap">
                        <div class="lms-video-loading"><div class="lms-loading-spin"></div></div>
                    </div>
                    <!-- FIX 2: min-height, overflow-y:auto added inline for content area -->
                    <div class="lms-player-content" id="lms-player-content" style="min-height:420px; overflow-y:auto;"></div>
                    <div class="lms-player-nav" id="lms-player-nav"></div>
                </div>
                <div class="lms-mobile-bottom-nav" id="lms-mobile-nav"></div>
            </div>
            <div class="lms-sidebar-overlay" id="lms-sidebar-overlay"></div>
            <div class="lms-inactivity-overlay" id="lms-inactivity-overlay" style="display:none">
                <div class="lms-inactivity-box">
                    <div class="lms-inactivity-icon">⚠️</div>
                    <h3>Siz faol emassiz!</h3>
                    <p>Sessiya <strong id="lms-inactivity-countdown">30</strong> soniyadan keyin tugatiladi.</p>
                    <div class="lms-inactivity-actions">
                        <button class="lms-btn lms-btn-primary" id="lms-inactivity-continue">✅ Davom etish</button>
                        <button class="lms-btn lms-btn-danger" id="lms-inactivity-exit">🚪 Chiqish</button>
                    </div>
                </div>
            </div>
        `);
    }

    _load_data() {
        frappe
            .xcall("pro_lms.lms_for_dbr.api.player.get_player_data", {
                lesson_name: this.params.lesson,
                enrollment_name: this.params.enrollment,
            })
            .then((data) => {
                if (this._destroyed) return;
                this.data = data;
                this._render_all();
            })
            .catch((err) => {
                this.$main.find("#lms-player-root").html(`
                    <div class="lms-player-error">
                        ⚠️ Ma'lumotlarni yuklashda xato yuz berdi.
                        <a href="/app/lms-dashboard">Dashboardga qaytish</a>
                    </div>
                `);
            });
    }

    _render_all() {
        const d = this.data;
        this.$main.find("#lms-topbar-title").text(d.current_lesson.lesson_title);
        if (d.enrollment.status === "Completed") {
            this.$main.find("#lms-enr-badge").html('<span class="lms-badge lms-badge-green">Kurs tugatilgan ✓</span>');
        }

        this._render_sidebar();
        this._render_video();
        this._render_tabs();
        this._render_nav();
        this._render_mobile_nav();
        this._bind_global_events();

        this.inactivityManager = new InactivityManager(
            150, 30,
            () => this._show_inactivity_warning(),
            () => this._end_session("inactivity")
        );

        this.timeLogger = new TimeLogger(
            d.time_log_name,
            this.params.lesson,
            this.params.enrollment,
            "Video"
        );

        this._progressInterval = setInterval(() => {
            this._save_progress();
        }, 10000);
        this._allIntervals.push(this._progressInterval);

        this._beforeUnloadHandler = () => {
            localStorage.removeItem("lms_player_active");
            const ve = this.videoEngine;
            const fd = new FormData();
            fd.append("cmd", "pro_lms.lms_for_dbr.api.player.save_on_unload");
            fd.append("lesson_name", this.params.lesson);
            fd.append("enrollment_name", this.params.enrollment);
            fd.append("time_log_name", this.timeLogger ? this.timeLogger.currentLogName : "");
            fd.append("watch_time_sec", ve ? ve.watchTimeSec : 0);
            fd.append("last_position_sec", ve ? ve.maxWatchedPosition : 0);
            fd.append("completion_percent", ve ? ve.completionPercent : 0);
            fd.append("csrf_token", frappe.csrf_token);
            navigator.sendBeacon("/api/method/pro_lms.lms_for_dbr.api.player.save_on_unload", fd);
        };
        window.addEventListener("beforeunload", this._beforeUnloadHandler);
    }

    // ═══════════════════════════════════════════════════════════════
    // SECTION 2: Video Player Engine
    // ═══════════════════════════════════════════════════════════════

    _render_video() {
        const lesson = this.data.current_lesson;
        const progress = this.data.progress;
        const $wrap = this.$main.find("#lms-video-wrap");

        if (!lesson.video_url) {
            $wrap.html(`
                <div class="lms-no-video">
                    <div class="lms-no-video-icon">🎬</div>
                    <p>Bu dars uchun video mavjud emas</p>
                </div>
            `);
            return;
        }

        $wrap.html(`
            <div class="lms-video-container" id="lms-video-container">
                <div class="lms-video-embed" id="lms-video-embed"></div>
                <div class="lms-video-click-overlay" id="lms-video-click-overlay"></div>
                <div class="lms-video-error" id="lms-video-error" style="display:none">
                    <p>⚠️ Video yuklanmadi. Quiz va topshiriqlarga o'tishingiz mumkin.</p>
                </div>
            </div>
            <div class="lms-video-controls-wrap" id="lms-video-controls-wrap">
                <div class="lms-seekbar-container" id="lms-seekbar-container">
                    <div class="lms-seekbar-track" id="lms-seekbar-track">
                        <div class="lms-seekbar-watched" id="lms-seekbar-watched"></div>
                        <div class="lms-seekbar-current" id="lms-seekbar-current"></div>
                        <div class="lms-seekbar-thumb" id="lms-seekbar-thumb"></div>
                    </div>
                </div>
                <div class="lms-controls-bar" id="lms-controls-bar">
                    <button class="lms-ctrl-btn" id="lms-ctrl-playpause" title="Ijro (Space)">▶</button>
                    <button class="lms-ctrl-btn lms-ctrl-sm" id="lms-ctrl-back5" title="-5s">⏪</button>
                    <button class="lms-ctrl-btn lms-ctrl-sm" id="lms-ctrl-fwd5" title="+5s">⏩</button>
                    <span class="lms-ctrl-time" id="lms-ctrl-time">0:00 / 0:00</span>
                    <div class="lms-ctrl-spacer"></div>
                    <div class="lms-volume-wrap">
                        <button class="lms-ctrl-btn lms-ctrl-sm" id="lms-ctrl-mute">🔊</button>
                        <input type="range" class="lms-volume-slider" id="lms-volume-slider"
                               min="0" max="1" step="0.05" value="1">
                    </div>
                    <div class="lms-speed-wrap">
                        <button class="lms-ctrl-btn lms-ctrl-sm" id="lms-ctrl-speed">1x</button>
                        <div class="lms-speed-menu" id="lms-speed-menu" style="display:none">
                            ${["0.5", "0.75", "1", "1.25", "1.5", "2"]
                                .map(s => `<div class="lms-speed-opt" data-speed="${s}">${s}x</div>`)
                                .join("")}
                        </div>
                    </div>
                    <button class="lms-ctrl-btn lms-ctrl-sm" id="lms-ctrl-fullscreen">⛶</button>
                </div>
            </div>
        `);

        this.videoEngine = new VideoEngine(
            this.$main.find("#lms-video-embed")[0],
            lesson.video_url,
            lesson.video_duration_sec,
            progress.last_position_sec,
            progress.max_watched_position,
            {
                onTimeUpdate: (pos, maxWatched, watchTimeSec) =>
                    this._on_video_time_update(pos, maxWatched, watchTimeSec),
                onPlay: () => {
                    this.$main.find("#lms-ctrl-playpause").text("⏸");
                },
                onPause: () => {
                    this.$main.find("#lms-ctrl-playpause").text("▶");
                },
                onError: () => {
                    this.$main.find("#lms-video-error").show();
                },
            }
        );

        this._bind_video_controls();
    }

    _on_video_time_update(pos, maxWatched, watchTimeSec) {
        const dur = this.data.current_lesson.video_duration_sec || 1;
        const pct = Math.min(100, (maxWatched / dur) * 100);

        this.$main.find("#lms-seekbar-watched").css("width", pct + "%");
        this.$main.find("#lms-seekbar-current").css("width", Math.min(100, (pos / dur) * 100) + "%");
        this.$main.find("#lms-seekbar-thumb").css("left", Math.min(100, (pos / dur) * 100) + "%");
        this.$main.find("#lms-ctrl-time").text(_fmtTime(pos) + " / " + _fmtTime(dur));

        if (this.videoEngine) {
            this.videoEngine.watchTimeSec = watchTimeSec;
            this.videoEngine.completionPercent = pct;
            this.videoEngine.maxWatchedPosition = maxWatched;
        }

        const minWatch = this.data.current_lesson.minimum_watch_percent || 80;
        if (pct >= minWatch && !this._videoWatchMet) {
            this._videoWatchMet = true;
            this._refresh_nav();
        }
    }

    _bind_video_controls() {
        const ve = () => this.videoEngine;
        const $root = this.$main;

        $root.on("click", "#lms-ctrl-playpause", () => ve() && ve().togglePlay());
        $root.on("click", "#lms-ctrl-back5", () => ve() && ve().seek(-5));
        $root.on("click", "#lms-ctrl-fwd5", () => ve() && ve().seek(5));
        $root.on("click", "#lms-video-click-overlay", () => ve() && ve().togglePlay());

        $root.on("input", "#lms-volume-slider", (e) => {
            const vol = parseFloat(e.target.value);
            ve() && ve().setVolume(vol);
            $root.find("#lms-ctrl-mute").text(vol === 0 ? "🔇" : "🔊");
        });

        $root.on("click", "#lms-ctrl-mute", () => {
            if (!ve()) return;
            const muted = ve().toggleMute();
            $root.find("#lms-ctrl-mute").text(muted ? "🔇" : "🔊");
            $root.find("#lms-volume-slider").val(muted ? 0 : ve().volume);
        });

        $root.on("click", "#lms-ctrl-speed", () => {
            const $menu = $root.find("#lms-speed-menu");
            $menu.toggle();
        });

        $root.on("click", ".lms-speed-opt", (e) => {
            const speed = parseFloat($(e.currentTarget).data("speed"));
            ve() && ve().setPlaybackRate(speed);
            $root.find("#lms-ctrl-speed").text(speed + "x");
            $root.find("#lms-speed-menu").hide();
        });

        $root.on("click", "#lms-ctrl-fullscreen", () => {
            const container = document.getElementById("lms-video-container");
            if (container) {
                if (!document.fullscreenElement) {
                    container.requestFullscreen && container.requestFullscreen();
                } else {
                    document.exitFullscreen && document.exitFullscreen();
                }
            }
        });

        const $track = $root.find("#lms-seekbar-track");
        $track.on("click", (e) => {
            if (!ve()) return;
            const rect = $track[0].getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const targetSec = ratio * (this.data.current_lesson.video_duration_sec || 0);
            ve().seekToAbs(targetSec);
        });

        const kbHandler = (e) => {
            const tag = document.activeElement.tagName.toLowerCase();
            if (tag === "input" || tag === "textarea") return;
            if (e.code === "Space") { e.preventDefault(); ve() && ve().togglePlay(); }
            if (e.code === "ArrowLeft") { e.preventDefault(); ve() && ve().seek(-5); }
            if (e.code === "ArrowRight") { e.preventDefault(); ve() && ve().seek(5); }
            if (e.code === "KeyM") { ve() && ve().toggleMute(); }
            if (e.code === "KeyF") { $root.find("#lms-ctrl-fullscreen").trigger("click"); }
        };
        document.addEventListener("keydown", kbHandler);
        this._allListeners.push(() => document.removeEventListener("keydown", kbHandler));

        $root.find("#lms-video-embed, #lms-video-click-overlay").on("contextmenu", (e) => e.preventDefault());
    }

    _save_progress() {
        if (!this.videoEngine || !this.data) return;
        const ve = this.videoEngine;
        frappe.xcall("pro_lms.lms_for_dbr.api.player.save_video_progress", {
            lesson_name: this.params.lesson,
            enrollment_name: this.params.enrollment,
            watch_time_sec: ve.watchTimeSec,
            last_position_sec: ve.maxWatchedPosition,
            completion_percent: ve.completionPercent,
        }).then((res) => {
            if (res.is_completed && !this._lessonVideoComplete) {
                this._lessonVideoComplete = true;
                this._refresh_nav();
            }
        }).catch(() => {});
    }

    // ═══════════════════════════════════════════════════════════════
    // SECTION 3: Sidebar Tree
    // ═══════════════════════════════════════════════════════════════

    _render_sidebar() {
        const sidebar = this.data.sidebar;
        const $body = this.$main.find("#lms-sidebar-body");
        const course = this.data.course;

        let html = `
            <div class="lms-sidebar-course-title">${_esc(course.course_name)}</div>
            <div class="lms-sidebar-progress">
                ${_progressBar(this._calc_course_progress())}
            </div>
        `;

        for (const sec of sidebar.sections) {
            const done = sec.completion.done;
            const total = sec.completion.total;
            const secLocked = sec.is_locked;
            const uid = _uid();

            html += `
                <div class="lms-sidebar-section${secLocked ? " lms-section-locked" : ""}">
                    <div class="lms-sidebar-sec-header" data-toggle="${uid}">
                        <span class="lms-sidebar-sec-icon">${secLocked ? "🔒" : "📁"}</span>
                        <span class="lms-sidebar-sec-title">${_esc(sec.section_title)}</span>
                        <span class="lms-sidebar-sec-count">${done}/${total} ✓</span>
                        <span class="lms-sidebar-toggle-icon">▼</span>
                    </div>
                    <div class="lms-sidebar-sec-lessons" id="${uid}">
            `;

            for (const lesson of sec.lessons) {
                html += this._lesson_sidebar_node(lesson);
            }

            html += `</div></div>`;
        }

        $body.html(html);
    }

    _lesson_sidebar_node(lesson) {
        const isCurrent = lesson.is_current;
        const isLocked = lesson.is_locked;
        const isDone = lesson.is_completed;
        const inProgress = !isDone && lesson.completion_percent > 0;

        let icon = "⚪";
        let cls = "";
        if (isLocked) { icon = "🔒"; cls = "lms-lesson-locked"; }
        else if (isCurrent) { icon = "🔵"; cls = "lms-lesson-current"; }
        else if (isDone) { icon = "✅"; cls = "lms-lesson-done"; }
        else if (inProgress) { icon = "🟡"; cls = "lms-lesson-inprogress"; }

        const dur = _fmtDuration(lesson.video_duration_sec);
        const tags = [
            lesson.has_quiz ? "📝" : "",
            lesson.has_open_questions ? "❓" : "",
            lesson.has_assignment ? "📎" : "",
        ].filter(Boolean).join(" ");

        return `
            <div class="lms-sidebar-lesson ${cls}"
                 data-lesson="${_esc(lesson.lesson_name)}"
                 data-locked="${isLocked ? 1 : 0}"
                 title="${isLocked ? "Avvalgi darsni tugating" : _esc(lesson.lesson_title)}">
                <span class="lms-lesson-icon">${icon}</span>
                <span class="lms-lesson-text">${_esc(lesson.lesson_title)}</span>
                <span class="lms-lesson-meta">
                    ${tags ? `<span class="lms-lesson-tags">${tags}</span>` : ""}
                    <span class="lms-lesson-dur">[${dur}]</span>
                </span>
            </div>
        `;
    }

    _calc_course_progress() {
        const sections = this.data.sidebar.sections;
        let total = 0, done = 0;
        for (const sec of sections) {
            for (const l of sec.lessons) {
                total++;
                if (l.is_completed) done++;
            }
        }
        return total > 0 ? Math.round((done / total) * 100) : 0;
    }

    // ═══════════════════════════════════════════════════════════════
    // SECTION 4: Content Tabs
    // ═══════════════════════════════════════════════════════════════

    _render_tabs() {
    const lesson = this.data.current_lesson;
    const $content = this.$main.find("#lms-player-content");

    const tabs = [{ id: "tab-desc", label: "📋 Tavsif", always: true }];
    if (lesson.has_quiz) tabs.push({ id: "tab-quiz", label: "📝 Quiz" });
    if (lesson.has_open_questions) tabs.push({ id: "tab-oq", label: "❓ Ochiq savollar" });
    if (lesson.has_assignment) tabs.push({ id: "tab-assign", label: "📎 Topshiriq" });

    const tabsHtml = tabs
        .map(
            (t, i) =>
                `<button class="lms-tab-btn${i === 0 ? " active" : ""}"
                     data-tab="${t.id}">${t.label}</button>`
        )
        .join("");

    $content.html(`
        <div class="lms-tabs-bar">${tabsHtml}</div>
        <div class="lms-tab-content" id="lms-tab-content"
             style="min-height:380px; padding:20px 24px; overflow-y:auto; box-sizing:border-box;"></div>
    `);

    // Description tab inline, qolganlar floating panel
    this._switch_tab("tab-desc");
}

   _switch_tab(tabId) {
    this.$main.find(".lms-tab-btn").removeClass("active");
    this.$main.find(`.lms-tab-btn[data-tab="${tabId}"]`).addClass("active");

    // tab-desc — inline, boshqalar floating panel
    if (tabId === "tab-desc") {
        this._close_floating_panel();
        const $tc = this.$main.find("#lms-tab-content");
        $tc.html(this._render_description_tab());
        this._switch_time_log_activity("Video");
        return;
    }

    // Floating panel orqali ko'rsat
    const titles = {
        "tab-quiz":   "📝 Quiz",
        "tab-oq":     "❓ Ochiq savollar",
        "tab-assign": "📎 Topshiriq",
    };

    this._open_floating_panel(titles[tabId] || "", tabId);
}

_open_floating_panel(title, tabId) {
    // Avvalgisini yop
    this._close_floating_panel();

    const $playerMain = this.$main.find("#lms-player-main");
    $playerMain.css("position", "relative");

    // Overlay
    $playerMain.append(`<div class="lms-floating-panel-overlay" id="lms-fp-overlay"></div>`);

    // Panel
    $playerMain.append(`
        <div class="lms-floating-panel" id="lms-floating-panel">
            <div class="lms-floating-panel-header">
                <span class="lms-floating-panel-title">${title}</span>
                <button class="lms-floating-panel-close" id="lms-fp-close">✕</button>
            </div>
            <div class="lms-floating-panel-body" id="lms-fp-body">
                <div class="lms-loading-spin"></div>
            </div>
        </div>
    `);

    // Close handlers
    this.$main.on("click", "#lms-fp-close, #lms-fp-overlay", () => {
        this._close_floating_panel();
        // tab-desc ga qaytish
        this.$main.find(".lms-tab-btn").removeClass("active");
        this.$main.find('.lms-tab-btn[data-tab="tab-desc"]').addClass("active");
    });

    const $body = this.$main.find("#lms-fp-body");

    if (tabId === "tab-quiz") {
        if (!this.quizEngine) {
            this.quizEngine = new QuizEngine(
                $body[0],
                this.data.quiz,
                this.data.current_lesson,
                this.params,
                (result) => this._on_quiz_result(result)
            );
        } else {
            this.quizEngine.mount($body[0]);
        }
        this._switch_time_log_activity("Quiz");

    } else if (tabId === "tab-oq") {
        $body.html(this._render_oq_tab());
        this._bind_oq_events_in($body);
        this._switch_time_log_activity("Open Question");

    } else if (tabId === "tab-assign") {
        $body.html(this._render_assignment_tab());
        this._bind_assignment_events_in($body);
        this._switch_time_log_activity("Reading");
    }
}

_close_floating_panel() {
    this.$main.find("#lms-floating-panel").remove();
    this.$main.find("#lms-fp-overlay").remove();
    this.$main.off("click", "#lms-fp-close, #lms-fp-overlay");
}

    _render_description_tab() {
        const lesson = this.data.current_lesson;
        const course = this.data.course;
        const dur = lesson.video_duration_sec || 0;
        const min = Math.floor(dur / 60);
        const sec = dur % 60;
        const durLabel = min > 0 ? `${min} daqiqa ${sec > 0 ? sec + " soniya" : ""}` : `${sec} soniya`;

        return `
            <div class="lms-desc-tab" style="font-size:15px; line-height:1.7;">
                <h2 class="lms-desc-title" style="font-size:20px; margin-bottom:12px;">${_esc(lesson.lesson_title)}</h2>
                <div class="lms-desc-meta" style="display:flex; flex-wrap:wrap; gap:16px; margin-bottom:16px; color:#555;">
                    <span>⏱️ Davomiyligi: ${durLabel}</span>
                    ${course.instructor ? `<span>👤 O'qituvchi: ${_esc(course.instructor)}</span>` : ""}
                    ${this.data.progress.is_completed ? '<span class="lms-badge lms-badge-green">✅ Tugatilgan</span>' : ""}
                </div>
                ${lesson.assignment_instruction
                    ? `<div class="lms-desc-instruction" style="background:#f8f9fa; border-left:4px solid #4a90e2; padding:16px 20px; border-radius:4px; margin-top:12px;">
                           <h4 style="margin-bottom:8px;">Yo'riqnoma</h4>
                           ${lesson.assignment_instruction}
                       </div>`
                    : ""}
            </div>
        `;
    }

    // ═══════════════════════════════════════════════════════════════
    // SECTION 5: Quiz Engine
    // ═══════════════════════════════════════════════════════════════

    _on_quiz_result(result) {
        if (!this.data.quiz) return;
        if (!this.data.quiz.attempts) this.data.quiz.attempts = [];
        this.data.quiz.attempts.push({
            percentage: result.percentage,
            passed: result.passed,
            attempt_number: result.attempt_number,
        });
        this.data.quiz.attempts_used = (this.data.quiz.attempts_used || 0) + 1;
        this.data.quiz.is_passed = result.passed || this.data.quiz.is_passed;
        this.data.quiz.best_percentage = Math.max(
            result.percentage,
            this.data.quiz.best_percentage || 0
        );
        const maxAtt = this.data.quiz.max_attempts || 0;
        this.data.quiz.can_retry =
            maxAtt === 0 || this.data.quiz.attempts_used < maxAtt;
        this._refresh_nav();
    }

    // ═══════════════════════════════════════════════════════════════
    // SECTION 6: Open Questions
    // ═══════════════════════════════════════════════════════════════

    _render_oq_tab() {
        const oq = this.data.open_questions;
        if (!oq) return '<div class="lms-empty">Savollar topilmadi.</div>';

        const questions = oq.questions || [];
        const score_pct =
            oq.total_marks > 0
                ? Math.round((oq.earned_marks / oq.total_marks) * 100)
                : null;

        let html = `
            <div class="lms-oq-tab">
                <div class="lms-oq-header">
                    <h3>${_esc(oq.title)}</h3>
                    <div class="lms-oq-meta">
                        O'tish balli: ${oq.passing_score || 0}%
                        ${score_pct !== null ? `&nbsp;|&nbsp; Natija: <strong>${score_pct}%</strong>` : ""}
                    </div>
                </div>
        `;

        for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            const ans = q.answer;
            const isGraded = ans && ans.status === "Graded";
            const isPending = ans && ans.status === "Pending";
            // Graded lekin ball to'liq emas = admin qayta ishlashni talab qilgan
			const isRejectedGrade = isGraded && (ans.score || 0) < (q.marks || 1);
			const readonly = (isGraded && !isRejectedGrade) || (isPending && !q.answer.is_auto_graded);
            html += `
                <div class="lms-oq-card" data-qidx="${i}" style="margin-bottom:20px; padding:16px; border:1px solid #e0e0e0; border-radius:8px;">
                    <div class="lms-oq-card-header" style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
                        <span class="lms-oq-num">${i + 1}.</span>
                        <span class="lms-oq-type-tag">${q.question_type === "Auto" ? "🤖 Avtomatik" : "✋ Qo'lda"}</span>
                        ${isGraded && !isRejectedGrade
							? `<span class="lms-badge lms-badge-green">✅ Baholandi: ${ans.score || 0}/${q.marks || 0}</span>`
							: isRejectedGrade
							? `<span class="lms-badge lms-badge-red">❌ Qayta ishlang: ${ans.score || 0}/${q.marks || 0}</span>`
							: isPending
							? '<span class="lms-badge lms-badge-yellow">⏳ Kutilmoqda</span>'
							: ""}
                    </div>
                    <p class="lms-oq-text" style="font-size:15px; margin-bottom:10px;">${_esc(q.question_text)}</p>
                    <textarea
                        class="lms-oq-textarea"
                        data-item="${q.item_name}"
                        maxlength="5000"
                        placeholder="Javobingizni yozing (max 5000 belgi)..."
                        style="width:100%; min-height:120px; padding:10px; border:1px solid #ccc; border-radius:6px; font-size:14px; resize:vertical; box-sizing:border-box;"
                        ${readonly ? "readonly" : ""}
                    >${_esc(ans ? ans.answer_text || "" : "")}</textarea>
                    ${isGraded && ans.admin_feedback
                        ? `<div class="lms-oq-feedback" style="margin-top:10px; background:#e8f5e9; padding:10px; border-radius:6px;"><strong>Admin fikri:</strong> ${_esc(ans.admin_feedback)}</div>`
                        : ""}
                </div>
            `;
        }

        html += `
            <div class="lms-oq-actions" style="display:flex; gap:12px; margin-top:16px;">
                <button class="lms-btn lms-btn-secondary" id="lms-oq-save">💾 Saqlash (qoralama)</button>
                <button class="lms-btn lms-btn-primary" id="lms-oq-submit">📤 Topshirish</button>
            </div>
            </div>
        `;
        return html;
    }

    _bind_oq_events() {
        const $tc = this.$main.find("#lms-tab-content");

        $tc.off("click", "#lms-oq-save").on("click", "#lms-oq-save", () => {
            this._save_oq_answers(false);
        });
        $tc.off("click", "#lms-oq-submit").on("click", "#lms-oq-submit", () => {
            frappe.confirm(
                "Javoblarni topshirishni tasdiqlaysizmi? Topshirilgandan keyin o'zgartirib bo'lmaydi.",
                () => this._save_oq_answers(true)
            );
        });
    }
    _bind_oq_events_in($container) {
    $container.off("click", "#lms-oq-save").on("click", "#lms-oq-save", () => {
        this._save_oq_answers(false);
    });
    $container.off("click", "#lms-oq-submit").on("click", "#lms-oq-submit", () => {
        frappe.confirm(
            "Javoblarni topshirishni tasdiqlaysizmi? Topshirilgandan keyin o'zgartirib bo'lmaydi.",
            () => this._save_oq_answers(true)
        );
    });
}

	_bind_assignment_events_in($container) {
		const type = this.data.assignment && this.data.assignment.type;

		$container.off("click", "#lms-assign-submit-file")
			.on("click", "#lms-assign-submit-file", () => {
				const $fileInput = $container.find("#lms-assign-file");
				if (!$fileInput.length || !$fileInput[0].files[0]) {
					frappe.msgprint("Fayl tanlang.");
					return;
				}
				const file = $fileInput[0].files[0];
				const formData = new FormData();
				formData.append("file", file, file.name);
				formData.append("is_private", "1");
				formData.append("csrf_token", frappe.csrf_token);

				$container.find("#lms-assign-submit-file")
					.prop("disabled", true).text("Yuklanmoqda...");

				fetch("/api/method/upload_file", {
					method: "POST",
					headers: {
						"X-Frappe-CSRF-Token": frappe.csrf_token,
					},
					body: formData,
				})
				.then(r => {
					if (!r.ok) throw new Error("HTTP " + r.status);
					return r.json();
				})
				.then(res => {
					const fileUrl = res.message && res.message.file_url;
					if (!fileUrl) {
						frappe.msgprint("Fayl yuklanmadi: server javob bermadi.");
						return;
					}
					const subType = type === "Excel Upload" ? "Excel" : "File";
					this._do_assignment_submit(subType, fileUrl, null);
				})
				.catch(err => {
					frappe.msgprint("Fayl yuklashda xato: " + (err.message || ""));
				})
				.finally(() => {
					$container.find("#lms-assign-submit-file")
						.prop("disabled", false).text("📤 Yuklash");
				});
			});

		$container.off("click", "#lms-assign-submit-url")
			.on("click", "#lms-assign-submit-url", () => {
				const $urlInput = $container.find("#lms-assign-url");
				if (!$urlInput.length) return;
				const url = ($urlInput.val() || "").trim();
				if (!url) { frappe.msgprint("Havola kiriting."); return; }
				this._do_assignment_submit("Google Sheets", null, url);
			});
	}
    _collect_oq_answers(isFinal) {
        const answers = [];
        this.$main.find(".lms-oq-textarea").each((_, el) => {
            answers.push({
                question_item: $(el).data("item"),
                answer_text: el.value,
                is_final: isFinal ? 1 : 0,
            });
        });
        return answers;
    }

    _save_oq_answers(isFinal) {
        const answers = this._collect_oq_answers(isFinal);
        if (answers.some((a) => !a.answer_text.trim())) {
            if (isFinal) {
                frappe.msgprint("Barcha savollarga javob bering.");
                return;
            }
        }

        frappe
            .xcall("pro_lms.lms_for_dbr.api.player.save_open_answers", {
                lesson_name: this.params.lesson,
                answers: JSON.stringify(answers),
            })
            .then((res) => {
                if (res.results && this.data.open_questions) {
                    const oq = this.data.open_questions;
                    for (const r of res.results) {
                        const q = oq.questions.find((q) => q.item_name === r.question_item);
                        if (q) {
                            q.answer = q.answer || {};
                            q.answer.status = r.status;
                            q.answer.score = r.score;
                        }
                    }
                    oq.all_answered = oq.questions.every((q) => q.answer && q.answer.answer_text);
                }
                frappe.msgprint({
                    message: isFinal ? "Javoblar topshirildi!" : "Qoralama saqlandi.",
                    indicator: "green",
                });
                if (isFinal) {
                    const $fpBody = this.$main.find("#lms-fp-body");
                    if ($fpBody.length) {
                        $fpBody.html(this._render_oq_tab());
                        this._bind_oq_events_in($fpBody);
                        this._refresh_nav();
                    }
                }
            })
            .catch(() => frappe.msgprint("Xato yuz berdi."));
    }

    // ═══════════════════════════════════════════════════════════════
    // SECTION 7: Assignment Submission
    // ═══════════════════════════════════════════════════════════════

    _render_assignment_tab() {
        const assign = this.data.assignment;
        if (!assign) return '<div class="lms-empty">Topshiriq topilmadi.</div>';

        const sub = assign.submission;
        const type = assign.type;
        const isApproved = sub && sub.status === "Approved";
        const isRejected = sub && sub.status === "Rejected";
        const canResubmit = !sub || isRejected;

        const statusBadge = sub
            ? {
                  Pending: '<span class="lms-badge lms-badge-yellow">⏳ Tekshirilmoqda</span>',
                  Reviewed: '<span class="lms-badge lms-badge-blue">👁️ Ko\'rib chiqildi</span>',
                  Approved: '<span class="lms-badge lms-badge-green">✅ Tasdiqlandi</span>',
                  Rejected: '<span class="lms-badge lms-badge-red">❌ Rad etildi</span>',
              }[sub.status] || ""
            : "";

        let uploadHtml = "";
        if (canResubmit) {
            if (type === "File Upload") {
                uploadHtml = `
                    <div class="lms-upload-box" id="lms-assign-upload-box" style="margin-top:16px; padding:20px; border:2px dashed #ccc; border-radius:8px; text-align:center;">
                        <p>📁 Faylni tanlang yoki bu yerga tashlang</p>
                        <input type="file" id="lms-assign-file" class="lms-file-input" style="margin:12px auto; display:block;">
                        <button class="lms-btn lms-btn-primary" id="lms-assign-submit-file">📤 Yuklash</button>
                    </div>`;
            } else if (type === "Google Sheets Link") {
                uploadHtml = `
                    <div class="lms-url-input-wrap" style="margin-top:16px;">
                        <label style="display:block; margin-bottom:8px; font-weight:600;">Google Sheets havolasi:</label>
                        <input type="url" id="lms-assign-url"
                               class="lms-text-input" placeholder="https://docs.google.com/spreadsheets/..."
                               style="width:100%; padding:10px; border:1px solid #ccc; border-radius:6px; font-size:14px; box-sizing:border-box; margin-bottom:12px;">
                        <button class="lms-btn lms-btn-primary" id="lms-assign-submit-url">📤 Topshirish</button>
                    </div>`;
            } else if (type === "Excel Upload") {
                uploadHtml = `
                    <div class="lms-upload-box" style="margin-top:16px; padding:20px; border:2px dashed #ccc; border-radius:8px; text-align:center;">
                        <p>📊 Excel faylini yuklang (.xlsx, .xls)</p>
                        <input type="file" id="lms-assign-file" accept=".xlsx,.xls" class="lms-file-input" style="margin:12px auto; display:block;">
                        <button class="lms-btn lms-btn-primary" id="lms-assign-submit-file">📤 Yuklash</button>
                    </div>`;
            }
        }

        return `
            <div class="lms-assign-tab" style="font-size:15px; line-height:1.7;">
                <h3 style="margin-bottom:12px;">📎 Topshiriq — ${_esc(type)}</h3>
                ${assign.instruction
                    ? `<div class="lms-assign-instruction" style="background:#f8f9fa; border-left:4px solid #f0ad4e; padding:16px 20px; border-radius:4px; margin-bottom:16px;">${assign.instruction}</div>`
                    : ""}
                ${sub
                    ? `<div class="lms-assign-status-block" style="background:#fff; border:1px solid #e0e0e0; border-radius:8px; padding:16px; margin-bottom:16px;">
                        <div style="margin-bottom:8px;">Holat: ${statusBadge}</div>
                        ${sub.admin_score !== null && sub.admin_score !== undefined
                            ? `<div>Ball: <strong>${sub.admin_score}</strong></div>`
                            : ""}
                        ${sub.admin_feedback
                            ? `<div style="margin-top:8px;">Admin fikri: <em>${_esc(sub.admin_feedback)}</em></div>`
                            : ""}
                        ${sub.submitted_on ? `<div style="margin-top:8px; color:#888;">Yuborildi: ${sub.submitted_on.slice(0, 16)}</div>` : ""}
						${sub.attached_file
							? `<div style="margin-top:8px;">
								   📎 Yuklangan fayl:
								   <a href="${sub.attached_file}" target="_blank" style="color:var(--primary);">
									   ${sub.attached_file.split("/").pop()}
								   </a>
							   </div>`
							: ""}
						${sub.google_sheets_url
							? `<div style="margin-top:8px;">
								   🔗 Havola:
								   <a href="${sub.google_sheets_url}" target="_blank" style="color:var(--primary);">
									   Ko'rish
								   </a>
							   </div>`
							: ""}
                    </div>`
                    : ""}
                ${isApproved
                    ? '<div class="lms-assign-approved-msg" style="color:green; font-weight:600;">✅ Bu topshiriq tasdiqlangan. Qayta yuklash imkoni yo\'q.</div>'
                    : uploadHtml}
            </div>
        `;
    }

    _bind_assignment_events() {
        const $tc = this.$main.find("#lms-tab-content");
        const type = this.data.assignment && this.data.assignment.type;

        $tc.off("click", "#lms-assign-submit-file").on("click", "#lms-assign-submit-file", async () => {
            const $file = $tc.find("#lms-assign-file");
            const file = $file[0].files[0];
            if (!file) { frappe.msgprint("Fayl tanlang."); return; }

			frappe.call({
				method: "frappe.client.attach_file",
				args: {
					filename: file.name,
					filedata: btoa(
						new Uint8Array(await file.arrayBuffer())
							.reduce((d, b) => d + String.fromCharCode(b), "")
					),
					doctype: "LMS Assignment Submission",
					is_private: 1,
				},
				callback: (r) => {
					if (r.message && r.message.file_url) {
						this._do_assignment_submit(
							type === "Excel Upload" ? "Excel" : "File",
							r.message.file_url, null
						);
					} else {
						frappe.msgprint("Fayl yuklanmadi.");
					}
				},
				error: () => frappe.msgprint("Fayl yuklashda xato."),
			});
        });

        $tc.off("click", "#lms-assign-submit-url").on("click", "#lms-assign-submit-url", () => {
            const url = $tc.find("#lms-assign-url").val().trim();
            if (!url) { frappe.msgprint("Havola kiriting."); return; }
            this._do_assignment_submit("Google Sheets", null, url);
        });
    }

    _do_assignment_submit(submission_type, file_url, google_sheets_url) {
        frappe
            .xcall("pro_lms.lms_for_dbr.api.player.submit_assignment", {
                lesson_name: this.params.lesson,
                submission_type,
                file_url: file_url || "",
                google_sheets_url: google_sheets_url || "",
            })
            .then((res) => {
                if (!this.data.assignment) return;
                this.data.assignment.submission = {
                    name: res.submission_name,
                    status: res.status,
                    submitted_on: res.submitted_on,
                };
                frappe.msgprint({ message: "Topshiriq yuborildi!", indicator: "green" });
                const $fpBody = this.$main.find("#lms-fp-body");
				if ($fpBody.length) {
					$fpBody.html(this._render_assignment_tab());
					this._bind_assignment_events_in($fpBody);
				}
                this._refresh_nav();
            })
            .catch(() => frappe.msgprint("Topshirishda xato yuz berdi."));
    }

    // ═══════════════════════════════════════════════════════════════
    // SECTION 8: Inactivity Detection
    // ═══════════════════════════════════════════════════════════════

    _show_inactivity_warning() {
        const $overlay = this.$main.find("#lms-inactivity-overlay");
        $overlay.show();
        if (this.videoEngine) this.videoEngine.pause();

        let remaining = 30;
        const $cd = this.$main.find("#lms-inactivity-countdown");
        $cd.text(remaining);

        const countdownInterval = setInterval(() => {
            remaining--;
            $cd.text(remaining);
            if (remaining <= 0) {
                clearInterval(countdownInterval);
                this._end_session("inactivity");
            }
        }, 1000);
        this._allIntervals.push(countdownInterval);

        this.$main.find("#lms-inactivity-continue").off("click").on("click", () => {
            clearInterval(countdownInterval);
            $overlay.hide();
            this.inactivityManager && this.inactivityManager.reset();
            if (this.videoEngine) this.videoEngine.play();
        });

        this.$main.find("#lms-inactivity-exit").off("click").on("click", () => {
            clearInterval(countdownInterval);
            this._end_session("normal");
        });
    }

    _end_session(reason) {
        this._save_progress();
        if (this.timeLogger) {
            this.timeLogger.close(reason, () => {
                frappe.set_route("lms-dashboard");
            });
        } else {
            frappe.set_route("lms-dashboard");
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // SECTION 9: Time Logging
    // ═══════════════════════════════════════════════════════════════

    _switch_time_log_activity(newActivity) {
        if (newActivity === this.currentActivity) return;
        if (this.timeLogger) {
            this.timeLogger.switchActivity(newActivity, this.params);
        }
        this.currentActivity = newActivity;
    }

    // ═══════════════════════════════════════════════════════════════
    // SECTION 10: Navigation & Progression
    // ═══════════════════════════════════════════════════════════════

    _render_nav() {
        const nav = this.data.navigation;
        const $navEl = this.$main.find("#lms-player-nav");

        const prevBtn = nav.is_first
            ? ""
            : `<button class="lms-btn lms-btn-secondary lms-nav-prev" id="lms-nav-prev">◀ Oldingi dars</button>`;

        const nextLabel = nav.is_last ? "Kursni tugatish 🎓" : "Keyingi dars ▶";
        const nextCls = nav.can_go_next ? "lms-btn-primary" : "lms-btn-disabled";
        const nextTitle = nav.can_go_next ? "" : this._block_reason_label(nav.next_blocked_reason);

        const nextBtn = `
            <button class="lms-btn ${nextCls} lms-nav-next" id="lms-nav-next"
                    title="${nextTitle}"
                    ${nav.can_go_next ? "" : "disabled"}>
                ${nextLabel}
            </button>`;

        $navEl.html(`<div class="lms-nav-inner">${prevBtn}${nextBtn}</div>`);
    }

    _refresh_nav() {
        frappe
            .xcall("pro_lms.lms_for_dbr.api.player.check_completion_status", {
                lesson_name: this.params.lesson,
                enrollment_name: this.params.enrollment,
            })
            .then((res) => {
                if (!this.data) return;
                this.data.navigation.can_go_next = res.can_proceed;
                this.data.navigation.next_blocked_reason =
                    (res.blocked_reasons || [])[0] || null;
                if (res.lesson_completed) {
                    this.data.progress.is_completed = true;
                    this._update_sidebar_lesson_status();
                }
                this._render_nav();
            })
            .catch(() => {});
    }

    _update_sidebar_lesson_status() {
        this.$main.find(`.lms-sidebar-lesson[data-lesson="${this.params.lesson}"]`)
            .removeClass("lms-lesson-current lms-lesson-inprogress")
            .addClass("lms-lesson-done")
            .find(".lms-lesson-icon").text("✅");
    }

    _block_reason_label(reason) {
        const map = {
            video_incomplete: "Videoni ko'ring",
            quiz_not_passed: "Quizdan o'ting",
            open_questions_incomplete: "Savollarni topshiring",
            assignment_missing: "Topshiriqni bajaring",
        };
        return map[reason] || "Barcha vazifalarni bajaring";
    }

    _render_mobile_nav() {
        const nav = this.data.navigation;
        this.$main.find("#lms-mobile-nav").html(`
            <button class="lms-mob-btn${nav.is_first ? " lms-mob-disabled" : ""}"
                    id="lms-mob-prev" ${nav.is_first ? "disabled" : ""}>◀ Oldingi</button>
            <button class="lms-mob-btn" id="lms-mob-lessons">📚 Darslar</button>
            <button class="lms-mob-btn${nav.can_go_next ? "" : " lms-mob-disabled"}"
                    id="lms-mob-next" ${nav.can_go_next ? "" : "disabled"}>Keyingi ▶</button>
        `);
    }

    _navigate_to_lesson(lessonName) {
        this._save_progress();
        if (this.timeLogger) {
            this.timeLogger.close("navigation", () => {
                frappe.set_route("lms-player", {
                    lesson: lessonName,
                    enrollment: this.params.enrollment,
                });
            });
        } else {
            frappe.set_route("lms-player", {
                lesson: lessonName,
                enrollment: this.params.enrollment,
            });
        }
    }

    _complete_course() {
        frappe.msgprint({
            title: "🎓 Tabriklaymiz!",
            message: "Siz kursni muvaffaqiyatli tugatdingiz!",
            indicator: "green",
        });
        setTimeout(() => frappe.set_route("lms-dashboard"), 2500);
    }

    // ═══════════════════════════════════════════════════════════════
    // SECTION 11: Utilities & Cleanup
    // ═══════════════════════════════════════════════════════════════

    _bind_global_events() {
        const $root = this.$main;

        // Sidebar toggle
        $root.on("click", "#lms-hamburger", () => {
            $root.find("#lms-sidebar").addClass("lms-sidebar-open");
            $root.find("#lms-sidebar-overlay").show();
        });
        $root.on("click", "#lms-sidebar-close, #lms-sidebar-overlay", () => {
            $root.find("#lms-sidebar").removeClass("lms-sidebar-open");
            $root.find("#lms-sidebar-overlay").hide();
        });

        // FIX 3: Dashboard button handler
        $root.on("click", "#lms-dash-btn", () => {
            this._end_session("normal");
        });

        // Sidebar section collapse
        $root.on("click", ".lms-sidebar-sec-header", (e) => {
            const id = $(e.currentTarget).data("toggle");
            const $lessons = $root.find(`#${id}`);
            $lessons.toggleClass("lms-collapsed");
            $(e.currentTarget).find(".lms-sidebar-toggle-icon")
                .text($lessons.hasClass("lms-collapsed") ? "▶" : "▼");
        });

        // Sidebar lesson click
        $root.on("click", ".lms-sidebar-lesson", (e) => {
            const $el = $(e.currentTarget);
            if ($el.data("locked") == 1) {
                frappe.show_alert({ message: $el.attr("title"), indicator: "orange" }, 3);
                return;
            }
            const lesson = $el.data("lesson");
            if (lesson && lesson !== this.params.lesson) {
                this._navigate_to_lesson(lesson);
            }
        });

        // Tab buttons
        $root.on("click", ".lms-tab-btn", (e) => {
            const tab = $(e.currentTarget).data("tab");
            this._switch_tab(tab);
        });

        // Navigation buttons
        $root.on("click", "#lms-nav-prev, #lms-mob-prev", () => {
            const prev = this.data.navigation.previous_lesson;
            if (prev) this._navigate_to_lesson(prev);
        });

        $root.on("click", "#lms-nav-next, #lms-mob-next", () => {
            if (!this.data.navigation.can_go_next) return;
            if (this.data.navigation.is_last) {
                this._complete_course();
            } else {
                const next = this.data.navigation.next_lesson;
                if (next) this._navigate_to_lesson(next);
            }
        });

        $root.on("click", "#lms-mob-lessons", () => {
            $root.find("#lms-sidebar").addClass("lms-sidebar-open");
            $root.find("#lms-sidebar-overlay").show();
        });

        // Page visibility
        const visHandler = () => {
            if (document.hidden) {
                this.videoEngine && this.videoEngine.pause();
                this.inactivityManager && this.inactivityManager.pause();
            } else {
                this.inactivityManager && this.inactivityManager.resume();
            }
        };
        document.addEventListener("visibilitychange", visHandler);
        this._allListeners.push(() =>
            document.removeEventListener("visibilitychange", visHandler)
        );

        // Speed menu outside click
        $root.on("click", (e) => {
            if (!$(e.target).closest("#lms-ctrl-speed").length) {
                $root.find("#lms-speed-menu").hide();
            }
        });
    }

    destroy() {
        this._destroyed = true;
        localStorage.removeItem("lms_player_active");
        this._allIntervals.forEach((id) => clearInterval(id));
        this._allListeners.forEach((fn) => fn());
        this.videoEngine && this.videoEngine.destroy();
        this.inactivityManager && this.inactivityManager.destroy();
        if (this._beforeUnloadHandler) {
            window.removeEventListener("beforeunload", this._beforeUnloadHandler);
        }
        this.$main.off();
    }
}

// ═══════════════════════════════════════════════════════════════
// VIDEO ENGINE CLASS
// ═══════════════════════════════════════════════════════════════

class VideoEngine {
    constructor(embedEl, videoUrl, duration, lastPosition, maxWatched, callbacks) {
        this.embedEl = embedEl;
        this.videoUrl = videoUrl;
        this.duration = duration || 1;
        this.currentPosition = lastPosition || 0;
        this.maxWatchedPosition = maxWatched || 0;
        this.watchTimeSec = 0;
        this.completionPercent = maxWatched > 0 ? Math.min(100, (maxWatched / this.duration) * 100) : 0;
        this.volume = 1;
        this.isMuted = false;
        this.playbackRate = 1;
        this.callbacks = callbacks || {};

        this.playerType = null;
        this.ytPlayer = null;
        this.vimeoPlayer = null;
        this.htmlVideo = null;
        this._pollInterval = null;
        this._playStartTime = null;
        this._playStartPos = null;

        this._init();
    }

    _init() {
        const url = this.videoUrl || "";
        if (url.includes("youtube.com") || url.includes("youtu.be")) {
            this.playerType = "youtube";
            this._init_youtube();
        } else if (url.includes("vimeo.com")) {
            this.playerType = "vimeo";
            this._init_vimeo();
        } else {
            this.playerType = "html5";
            this._init_html5();
        }
    }

    // ── YouTube ──────────────────────────────────────────────────────────
    _init_youtube() {
        const videoId = this._extract_youtube_id(this.videoUrl);
        if (!videoId) {
            this.callbacks.onError && this.callbacks.onError();
            return;
        }

        const container = document.createElement("div");
        container.id = "lms-yt-player-" + _uid();
        this.embedEl.appendChild(container);

        _ensureYouTubeAPI().then(() => {
            this.ytPlayer = new YT.Player(container.id, {
                videoId,
                playerVars: {
                    controls: 0,
                    rel: 0,
                    modestbranding: 1,
                    disablekb: 1,
                    fs: 0,
                    playsinline: 1,
                    start: Math.floor(this.currentPosition),
                },
                events: {
                    onReady: (e) => {
                        // FIX 1a: Explicitly unMute before setVolume.
                        // Chrome autoplay policy silently mutes the player
                        // when controls:0 is used. unMute() must come first.
                        e.target.unMute();
                        e.target.setVolume(100);
                        e.target.setPlaybackRate(this.playbackRate);
                    },
                    onStateChange: (e) => {
                        if (e.data === YT.PlayerState.PLAYING) {
                            this._onPlay();
                        } else if (
                            e.data === YT.PlayerState.PAUSED ||
                            e.data === YT.PlayerState.ENDED
                        ) {
                            this._onPause();
                        }
                    },
                    onError: () => {
                        this.callbacks.onError && this.callbacks.onError();
                    },
                },
            });

            this._pollInterval = setInterval(() => {
                if (
                    this.ytPlayer &&
                    this.ytPlayer.getPlayerState &&
                    this.ytPlayer.getPlayerState() === YT.PlayerState.PLAYING
                ) {
                    const pos = this.ytPlayer.getCurrentTime();
                    this._checkAntiSkip(pos);
                    this._tick(pos);
                }
            }, 500);
        });
    }

    _extract_youtube_id(url) {
        const match = url.match(
            /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/
        );
        return match ? match[1] : null;
    }

    // ── Vimeo ─────────────────────────────────────────────────────────────
    _init_vimeo() {
        const vimeoId = this._extract_vimeo_id(this.videoUrl);
        if (!vimeoId) {
            this.callbacks.onError && this.callbacks.onError();
            return;
        }

        const iframe = document.createElement("iframe");
        iframe.src = `https://player.vimeo.com/video/${vimeoId}?controls=0&playsinline=1`;
        iframe.style.cssText = "width:100%;height:100%;border:none;";
        iframe.allow = "autoplay; fullscreen";
        this.embedEl.appendChild(iframe);

        _ensureVimeoAPI().then(() => {
            this.vimeoPlayer = new Vimeo.Player(iframe);

            // FIX 1b: Set volume explicitly after Vimeo player init
            this.vimeoPlayer.setVolume(1).catch(() => {});
            this.vimeoPlayer.setCurrentTime(this.currentPosition).catch(() => {});

            this.vimeoPlayer.on("timeupdate", (data) => {
                const pos = data.seconds;
                this._checkAntiSkip(pos);
                this._tick(pos);
            });

            this.vimeoPlayer.on("play", () => this._onPlay());
            this.vimeoPlayer.on("pause", () => this._onPause());
            this.vimeoPlayer.on("ended", () => this._onPause());
            this.vimeoPlayer.on("error", () => {
                this.callbacks.onError && this.callbacks.onError();
            });
        });
    }

    _extract_vimeo_id(url) {
        const match = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
        return match ? match[1] : null;
    }

    // ── HTML5 ─────────────────────────────────────────────────────────────
    _init_html5() {
        const video = document.createElement("video");
        video.style.cssText = "width:100%;height:100%;";
        video.src = this.videoUrl;
        video.preload = "metadata";
        video.disablePictureInPicture = true;
        video.controlsList = "nodownload";

        // FIX 1c: Explicitly set volume and muted state.
        // Browser may inherit a muted state from a previous session or
        // apply autoplay-mute policy. Force unmuted at init.
        video.volume = 1;
        video.muted = false;

        this.htmlVideo = video;
        this.embedEl.appendChild(video);

        video.addEventListener("loadedmetadata", () => {
            video.currentTime = this.currentPosition;
        });

        video.addEventListener("seeking", () => {
            const pos = video.currentTime;
            if (pos > this.maxWatchedPosition + 5) {
                video.currentTime = this.maxWatchedPosition;
            }
        });

        video.addEventListener("timeupdate", () => {
            const pos = video.currentTime;
            this._tick(pos);
        });

        video.addEventListener("play", () => this._onPlay());
        video.addEventListener("pause", () => this._onPause());
        video.addEventListener("ended", () => this._onPause());
        video.addEventListener("error", () => {
            this.callbacks.onError && this.callbacks.onError();
        });
    }

    // ── Shared logic ──────────────────────────────────────────────────────
    _checkAntiSkip(pos) {
        if (pos > this.maxWatchedPosition + 5) {
            this._setPositionInternal(this.maxWatchedPosition);
        }
    }

    _tick(pos) {
        this.currentPosition = pos;
        if (pos > this.maxWatchedPosition) {
            this.maxWatchedPosition = pos;
        }
        if (this._playStartTime && this._playStartPos !== null) {
            const elapsed = (Date.now() - this._playStartTime) / 1000;
            this.watchTimeSec = Math.floor(elapsed);
        }
        this.completionPercent = Math.min(100, (this.maxWatchedPosition / this.duration) * 100);
        const newSec = Math.floor(pos);
		if (newSec !== this._lastDisplayedSec) {
			this._lastDisplayedSec = newSec;
			this.callbacks.onTimeUpdate &&
				this.callbacks.onTimeUpdate(pos, this.maxWatchedPosition, this.watchTimeSec);
		}
	}

    _onPlay() {
        this._playStartTime = Date.now();
        this._playStartPos = this.currentPosition;
        this.callbacks.onPlay && this.callbacks.onPlay();
    }

    _onPause() {
        if (this._playStartTime) {
            this.watchTimeSec += Math.floor((Date.now() - this._playStartTime) / 1000);
            this._playStartTime = null;
        }
        this.callbacks.onPause && this.callbacks.onPause();
    }

    _setPositionInternal(sec) {
        const clamped = Math.max(0, Math.min(sec, this.maxWatchedPosition));
        if (this.playerType === "youtube" && this.ytPlayer && this.ytPlayer.seekTo) {
            this.ytPlayer.seekTo(clamped, true);
        } else if (this.playerType === "vimeo" && this.vimeoPlayer) {
            this.vimeoPlayer.setCurrentTime(clamped).catch(() => {});
        } else if (this.playerType === "html5" && this.htmlVideo) {
            this.htmlVideo.currentTime = clamped;
        }
    }

    // ── Public API ────────────────────────────────────────────────────────
    togglePlay() {
        if (this.playerType === "youtube" && this.ytPlayer) {
            const state = this.ytPlayer.getPlayerState();
            if (state === YT.PlayerState.PLAYING) {
                this.ytPlayer.pauseVideo();
            } else {
                this.ytPlayer.playVideo();
            }
        } else if (this.playerType === "vimeo" && this.vimeoPlayer) {
            this.vimeoPlayer.getPaused().then((paused) => {
                if (paused) this.vimeoPlayer.play();
                else this.vimeoPlayer.pause();
            });
        } else if (this.htmlVideo) {
            if (this.htmlVideo.paused) this.htmlVideo.play();
            else this.htmlVideo.pause();
        }
    }

    play() {
        if (this.playerType === "youtube" && this.ytPlayer) {
            this.ytPlayer.playVideo();
        } else if (this.playerType === "vimeo" && this.vimeoPlayer) {
            this.vimeoPlayer.play();
        } else if (this.htmlVideo) {
            // FIX 1d: Handle play() Promise rejection (browser autoplay policy)
            const p = this.htmlVideo.play();
            if (p !== undefined) {
                p.catch(() => {
                    // Browser blocked autoplay — user must interact first.
                    // Do not throw; UI will stay paused.
                });
            }
        }
    }

    pause() {
        if (this.playerType === "youtube" && this.ytPlayer) this.ytPlayer.pauseVideo();
        else if (this.playerType === "vimeo" && this.vimeoPlayer) this.vimeoPlayer.pause();
        else if (this.htmlVideo) this.htmlVideo.pause();
    }

    seek(deltaSec) {
        const newPos = this.currentPosition + deltaSec;
        const clamped = Math.max(0, Math.min(newPos, this.maxWatchedPosition));
        this._setPositionInternal(clamped);
    }

    seekToAbs(sec) {
        const clamped = Math.max(0, Math.min(sec, this.maxWatchedPosition));
        this._setPositionInternal(clamped);
    }

    setVolume(vol) {
        this.volume = vol;
        if (this.playerType === "youtube" && this.ytPlayer) {
            this.ytPlayer.setVolume(vol * 100);
        } else if (this.playerType === "vimeo" && this.vimeoPlayer) {
            this.vimeoPlayer.setVolume(vol);
        } else if (this.htmlVideo) {
            this.htmlVideo.volume = vol;
        }
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        if (this.playerType === "youtube" && this.ytPlayer) {
            if (this.isMuted) this.ytPlayer.mute();
            else this.ytPlayer.unMute();
        } else if (this.playerType === "vimeo" && this.vimeoPlayer) {
            this.vimeoPlayer.setVolume(this.isMuted ? 0 : this.volume);
        } else if (this.htmlVideo) {
            this.htmlVideo.muted = this.isMuted;
        }
        return this.isMuted;
    }

    setPlaybackRate(rate) {
        this.playbackRate = rate;
        if (this.playerType === "youtube" && this.ytPlayer) {
            this.ytPlayer.setPlaybackRate(rate);
        } else if (this.playerType === "vimeo" && this.vimeoPlayer) {
            this.vimeoPlayer.setPlaybackRate(rate).catch(() => {});
        } else if (this.htmlVideo) {
            this.htmlVideo.playbackRate = rate;
        }
    }

    destroy() {
        if (this._pollInterval) clearInterval(this._pollInterval);
        if (this.ytPlayer && this.ytPlayer.destroy) this.ytPlayer.destroy();
        if (this.vimeoPlayer && this.vimeoPlayer.destroy) this.vimeoPlayer.destroy();
        if (this.htmlVideo) {
            this.htmlVideo.pause();
            this.htmlVideo.src = "";
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// QUIZ ENGINE CLASS
// ═══════════════════════════════════════════════════════════════

class QuizEngine {
    constructor(container, quizData, lessonData, params, onResult) {
        this.container = container;
        this.quizData = quizData;
        this.lessonData = lessonData;
        this.params = params;
        this.onResult = onResult;
        this.state = "idle";
        this.attemptName = null;
        this.questions = [];
        this.answers = {};
        this.currentQ = 0;
        this.timerInterval = null;
        this.remainingSec = 0;
        this._draftInterval = null;

        this.mount(container);
    }

    mount(container) {
        this.container = container;
        if (this.state === "active") {
            this._render_active();
        } else if (this.state === "result") {
            this._render_result(this._lastResult);
        } else {
            this._render_idle();
        }
    }

    _render_idle() {
        const q = this.quizData;
        if (!q) { this.container.innerHTML = '<div class="lms-empty">Quiz topilmadi.</div>'; return; }

        const attemptsStr = q.max_attempts
            ? `${q.attempts_used || 0} / ${q.max_attempts}`
            : `${q.attempts_used || 0} / ∞`;

        const hasIncomplete = q.incomplete_attempt_name;
        const canStart = q.can_retry !== false;

        let resultSummary = "";
        if (q.best_percentage !== null && q.best_percentage !== undefined) {
            const passed = q.is_passed;
            resultSummary = `
                <div class="lms-quiz-prev-result">
                    Eng yaxshi natija: <strong>${q.best_percentage}%</strong>
                    <span class="lms-badge ${passed ? "lms-badge-green" : "lms-badge-red"}">
                        ${passed ? "✅ O'tdi" : "❌ O'tmadi"}
                    </span>
                </div>`;
        }

        if (!canStart && !hasIncomplete) {
            this.container.innerHTML = `
                <div class="lms-quiz-card lms-quiz-failed-card">
                    <h3>❌ Siz quizdan o'ta olmadingiz</h3>
                    ${resultSummary}
                    <p>Urinishlar tugadi: ${attemptsStr}</p>
                    <p>Administrator bilan bog'laning.</p>
                </div>`;
            return;
        }

        this.container.innerHTML = `
            <div class="lms-quiz-card lms-quiz-idle-card">
                <h3>📝 ${_esc(q.quiz_title || "Quiz")}</h3>
                <div class="lms-quiz-meta">
                    ${q.questions_to_show ? `<div>Savollar: ${q.questions_to_show}</div>` : ""}
                    ${q.time_limit_min ? `<div>⏱️ Vaqt: ${q.time_limit_min} daqiqa</div>` : ""}
                    <div>O'tish balli: ${q.passing_score || 0}%</div>
                    <div>Urinishlar: ${attemptsStr}</div>
                </div>
                ${resultSummary}
                ${hasIncomplete
                    ? '<div class="lms-quiz-resume-notice">⚡ Yakunlanmagan urinish aniqlandi.</div>'
                    : ""}
                <button class="lms-btn lms-btn-primary lms-quiz-start-btn" id="lms-quiz-start">
                    ${hasIncomplete ? "⏯️ Davom ettirish" : "▶ Quizni boshlash"}
                </button>
            </div>`;

        $(this.container).on("click", "#lms-quiz-start", () => this._start());
    }

    _start() {
        this.state = "loading";
        this.container.innerHTML = '<div class="lms-loading-spin"></div>';

        frappe
            .xcall("pro_lms.lms_for_dbr.api.player.start_quiz", {
                quiz_name: this.quizData.quiz_name,
                lesson_name: this.params.lesson,
            })
            .then((res) => {
                this.attemptName = res.attempt_name;
                this.questions = res.questions || [];
                this.answers = res.saved_answers || {};
                this.currentQ = 0;
                this.remainingSec = res.remaining_sec || 0;
                this.state = "active";

                this._draftInterval = setInterval(() => this._save_draft(), 30000);

                this._render_active();

                if (res.time_limit_sec > 0) {
                    this._start_timer();
                }
            })
            .catch((e) => {
                frappe.msgprint(e.message || "Quizni boshlashda xato.");
                this._render_idle();
            });
    }

    _render_active() {
        if (!this.questions.length) {
            this.container.innerHTML = '<div class="lms-empty">Savollar topilmadi.</div>';
            return;
        }

        const q = this.questions[this.currentQ];
        const total = this.questions.length;
        const answered = Object.keys(this.answers).length;

        const dots = this.questions
            .map((_, i) => {
                const isCur = i === this.currentQ;
                const isAns = !!this.answers[this.questions[i].question_name];
                return `<span class="lms-quiz-dot${isCur ? " lms-dot-current" : ""}${isAns ? " lms-dot-answered" : ""}"
                              data-qidx="${i}"></span>`;
            })
            .join("");

        const timerHtml = this.remainingSec > 0
            ? `<div class="lms-quiz-timer" id="lms-quiz-timer">⏱️ ${_fmtTime(this.remainingSec)}</div>`
            : "";

        const options = (q.options || [])
            .map((opt) => {
                const isSelected = this.answers[q.question_name] === opt.name;
                return `
                    <label class="lms-quiz-option${isSelected ? " lms-opt-selected" : ""}">
                        <input type="radio" name="lms-quiz-opt"
                               value="${_esc(opt.name)}"
                               ${isSelected ? "checked" : ""}>
                        <span>${_esc(opt.option_text)}</span>
                    </label>`;
            })
            .join("");

        this.container.innerHTML = `
            <div class="lms-quiz-card lms-quiz-active-card">
                <div class="lms-quiz-active-header">
                    ${timerHtml}
                    <span class="lms-quiz-progress">Savol ${this.currentQ + 1} / ${total}</span>
                    <span class="lms-quiz-answered-count">${answered} ta javob berildi</span>
                </div>
                <div class="lms-quiz-question-card">
                    <p class="lms-quiz-question-text">${this.currentQ + 1}. ${_esc(q.question)}</p>
                    <div class="lms-quiz-options">${options}</div>
                </div>
                <div class="lms-quiz-dots">${dots}</div>
                <div class="lms-quiz-nav-row">
                    <button class="lms-btn lms-btn-secondary" id="lms-quiz-prev"
                            ${this.currentQ === 0 ? "disabled" : ""}>◀ Oldingi</button>
                    ${this.currentQ < total - 1
                        ? `<button class="lms-btn lms-btn-primary" id="lms-quiz-next">Keyingi ▶</button>`
                        : `<button class="lms-btn lms-btn-danger" id="lms-quiz-submit-btn">📤 Topshirish</button>`}
                </div>
            </div>`;

        const $c = $(this.container);
        $c.off("change", 'input[name="lms-quiz-opt"]')
          .on("change", 'input[name="lms-quiz-opt"]', (e) => {
              this.answers[q.question_name] = e.target.value;
              $(e.target).closest(".lms-quiz-options")
                  .find(".lms-quiz-option").removeClass("lms-opt-selected");
              $(e.target).closest(".lms-quiz-option").addClass("lms-opt-selected");
              this._render_dots();
          });

        $c.off("click", "#lms-quiz-prev").on("click", "#lms-quiz-prev", () => {
            if (this.currentQ > 0) { this.currentQ--; this._render_active(); }
        });
        $c.off("click", "#lms-quiz-next").on("click", "#lms-quiz-next", () => {
            if (this.currentQ < this.questions.length - 1) { this.currentQ++; this._render_active(); }
        });
        $c.off("click", "#lms-quiz-submit-btn").on("click", "#lms-quiz-submit-btn", () => {
            frappe.confirm(
                "Quizni topshirishni tasdiqlaysizmi?",
                () => this._submit()
            );
        });
        $c.off("click", ".lms-quiz-dot").on("click", ".lms-quiz-dot", (e) => {
            this.currentQ = parseInt($(e.currentTarget).data("qidx"));
            this._render_active();
        });
    }

    _render_dots() {
        const $dots = $(this.container).find(".lms-quiz-dots");
        if (!$dots.length) return;
        $dots.html(
            this.questions
                .map((_, i) => {
                    const isCur = i === this.currentQ;
                    const isAns = !!this.answers[this.questions[i].question_name];
                    return `<span class="lms-quiz-dot${isCur ? " lms-dot-current" : ""}${isAns ? " lms-dot-answered" : ""}"
                                  data-qidx="${i}"></span>`;
                })
                .join("")
        );
    }

    _start_timer() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerInterval = setInterval(() => {
            this.remainingSec--;
            const $t = $(this.container).find("#lms-quiz-timer");
            if ($t.length) $t.text("⏱️ " + _fmtTime(this.remainingSec));
            if (this.remainingSec <= 0) {
                clearInterval(this.timerInterval);
                this._submit(true);
            }
        }, 1000);
    }

    _save_draft() {
        if (!this.attemptName || !Object.keys(this.answers).length) return;
        frappe.xcall("pro_lms.lms_for_dbr.api.player.save_quiz_draft", {
            attempt_name: this.attemptName,
            answers: JSON.stringify(this.answers),
        }).catch(() => {});
    }

    _submit(autoSubmit = false) {
        if (this.timerInterval) clearInterval(this.timerInterval);
        if (this._draftInterval) clearInterval(this._draftInterval);

        this.container.innerHTML = '<div class="lms-loading-spin"></div>';

        frappe
            .xcall("pro_lms.lms_for_dbr.api.player.submit_quiz", {
                attempt_name: this.attemptName,
                answers: JSON.stringify(this.answers),
            })
            .then((res) => {
                this._lastResult = res;
                this.state = "result";
                this._render_result(res);
                this.onResult && this.onResult(res);
            })
            .catch(() => {
                frappe.msgprint("Topshirishda xato yuz berdi.");
                this._render_active();
            });
    }

    _render_result(res) {
        if (!res) return;
        const passedCls = res.passed ? "lms-result-pass" : "lms-result-fail";
        const passedLabel = res.passed ? "✅ O'tdingiz!" : "❌ O'ta olmadingiz";
        const q = this.quizData;
        const maxAtt = q.max_attempts || 0;
        const used = (q.attempts_used || 0);
        const canRetry = maxAtt === 0 || used < maxAtt;

        const perQHtml = res.per_question
            ? Object.entries(res.per_question)
                  .map(
                      ([, correct]) =>
                          `<span class="lms-result-dot ${correct ? "lms-dot-correct" : "lms-dot-wrong"}">${correct ? "✅" : "❌"}</span>`
                  )
                  .join("")
            : "";

        this.container.innerHTML = `
            <div class="lms-quiz-card lms-quiz-result-card ${passedCls}">
                <h3>📊 Natija</h3>
                <div class="lms-result-score">
                    <strong>${Math.round(res.percentage || 0)}%</strong>
                    <span class="lms-badge ${res.passed ? "lms-badge-green" : "lms-badge-red"}">${passedLabel}</span>
                </div>
                <div class="lms-quiz-meta">
                    <div>Ball: ${Math.round(res.score || 0)} / ${Math.round(res.total_marks || 0)}</div>
                    <div>O'tish balli: ${q.passing_score || 0}%</div>
                    <div>Vaqt: ${_fmtTime(res.time_taken_sec || 0)}</div>
                    <div>Urinish: ${res.attempt_number} / ${maxAtt || "∞"}</div>
                </div>
                <div class="lms-result-dots">${perQHtml}</div>
                ${canRetry && !res.passed
                    ? `<button class="lms-btn lms-btn-secondary" id="lms-quiz-retry">🔄 Qayta urinish</button>`
                    : ""}
            </div>`;

        $(this.container).on("click", "#lms-quiz-retry", () => {
            this.state = "idle";
            q.incomplete_attempt_name = null;
            this._render_idle();
        });
    }

    destroy() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        if (this._draftInterval) clearInterval(this._draftInterval);
    }
}

// ═══════════════════════════════════════════════════════════════
// INACTIVITY MANAGER
// ═══════════════════════════════════════════════════════════════

class InactivityManager {
    constructor(warningAfterSec, logoutAfterSec, onWarn, onLogout) {
        this.warningAfterSec = warningAfterSec;
        this.logoutAfterSec = logoutAfterSec;
        this.onWarn = onWarn;
        this.onLogout = onLogout;
        this._timer = null;
        this._warned = false;
        this._paused = false;

        const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
        this._handler = () => this.reset();
        events.forEach((ev) => document.addEventListener(ev, this._handler, { passive: true }));
        this._eventsToRemove = events;

        this._startTimer();
    }

    _startTimer() {
        if (this._timer) clearTimeout(this._timer);
        this._warned = false;
        this._timer = setTimeout(() => {
            if (!this._paused) {
                this._warned = true;
                this.onWarn && this.onWarn();
                this._timer = setTimeout(() => {
                    if (!this._paused) this.onLogout && this.onLogout();
                }, this.logoutAfterSec * 1000);
            }
        }, this.warningAfterSec * 1000);
    }

    reset() {
        if (!this._warned && !this._paused) {
            this._startTimer();
        }
    }

    pause() { this._paused = true; if (this._timer) clearTimeout(this._timer); }
    resume() { this._paused = false; this._startTimer(); }

    destroy() {
        if (this._timer) clearTimeout(this._timer);
        this._eventsToRemove.forEach((ev) =>
            document.removeEventListener(ev, this._handler)
        );
    }
}

// ═══════════════════════════════════════════════════════════════
// TIME LOGGER
// ═══════════════════════════════════════════════════════════════

class TimeLogger {
    constructor(initialLogName, lessonName, enrollmentName, activityType) {
        this.currentLogName = initialLogName;
        this.lessonName = lessonName;
        this.enrollmentName = enrollmentName;
        this.currentActivity = activityType;
    }

    switchActivity(newActivity, params) {
        this.close("activity_switch", () => {
            frappe
                .xcall("pro_lms.lms_for_dbr.api.player.create_time_log", {
                    lesson_name: params.lesson,
                    enrollment_name: params.enrollment,
                    activity_type: newActivity,
                })
                .then((res) => {
                    this.currentLogName = res.time_log_name;
                    this.currentActivity = newActivity;
                })
                .catch(() => {});
        });
    }

    close(reason, callback) {
        if (!this.currentLogName) {
            callback && callback();
            return;
        }
        frappe
            .xcall("pro_lms.lms_for_dbr.api.player.update_time_log", {
                time_log_name: this.currentLogName,
                end_reason: reason,
            })
            .then(() => { callback && callback(); })
            .catch(() => { callback && callback(); });
    }
}

// ═══════════════════════════════════════════════════════════════
// YOUTUBE API LOADER
// ═══════════════════════════════════════════════════════════════

window._lms_yt_callbacks = [];
window._lms_yt_loading = false;

function _ensureYouTubeAPI() {
    return new Promise((resolve) => {
        if (window.YT && window.YT.Player) { resolve(); return; }
        window._lms_yt_callbacks.push(resolve);
        if (!window._lms_yt_loading) {
            window._lms_yt_loading = true;
            window.onYouTubeIframeAPIReady = function () {
                window._lms_yt_callbacks.forEach((cb) => cb());
                window._lms_yt_callbacks = [];
            };
            const s = document.createElement("script");
            s.src = "https://www.youtube.com/iframe_api";
            document.head.appendChild(s);
        }
    });
}

function _ensureVimeoAPI() {
    return new Promise((resolve) => {
        if (window.Vimeo && window.Vimeo.Player) { resolve(); return; }
        const s = document.createElement("script");
        s.src = "https://player.vimeo.com/api/player.js";
        s.onload = resolve;
        document.head.appendChild(s);
    });
}

// ═══════════════════════════════════════════════════════════════
// PURE UTILITIES
// ═══════════════════════════════════════════════════════════════

function _uid() { return "lp" + Math.random().toString(36).slice(2, 9); }
function _esc(s) {
    if (!s) return "";
    return String(s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function _fmtTime(sec) {
    if (!sec || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
}
function _fmtDuration(sec) {
    if (!sec) return "0:00";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}
function _progressBar(pct) {
    const v = Math.max(0, Math.min(100, pct || 0));
    return `
        <div class="lms-prog-wrap">
            <div class="lms-prog-bar">
                <div class="lms-prog-fill" style="width:${v}%"></div>
            </div>
            <span class="lms-prog-label">${v}%</span>
        </div>`;
}
