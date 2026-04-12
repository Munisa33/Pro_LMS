/**
 * LMS Session Tracker — frontend side
 *
 * Covers ALL exit scenarios:
 *   1. Browser X / tab close       → beforeunload + sendBeacon
 *   2. Tab switch / minimize       → visibilitychange(hidden) + sendBeacon
 *   3. Mobile OS kills browser     → heartbeat expires → scheduler detects ~90s
 *   4. Network drop                → heartbeat expires → scheduler detects ~90s
 *   5. SPA navigation away         → on_page_hide + close()
 *   6. Dashboard ↔ Player switch   → on_page_hide(close) → on_page_show(init)
 */

// Assign to window so page JS files can access it (esbuild wraps in IIFE)
window.LmsSession = (() => {

  const HEARTBEAT_MS = 30000;
  const API = "pro_lms.lms_for_dbr.bot.session_tracker";

  let page       = null;
  let hbTimer    = null;
  let isOpen     = false;
  let closing    = false;
  let bound      = false;

  // ── frappe.call for open/heartbeat ────────────────────────────────────────
  function api(method, data) {
    return frappe.call({ method: API + "." + method, args: data || {} });
  }

  // ── sendBeacon for close (works during page unload) ───────────────────────
  function beacon() {
    if (!page) return;
    var cmd = API + ".on_page_close";
    var body = new URLSearchParams({
      cmd: cmd,
      page: page,
      csrf_token: frappe.csrf_token || ""
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/method/" + cmd, body);
    } else {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/method/" + cmd, false);
      xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
      xhr.send(body.toString());
    }
  }

  // ── Heartbeat ──────────────────────────────────────────────────���──────────
  function startHB() {
    stopHB();
    hbTimer = setInterval(function () {
      if (document.visibilityState === "visible" && isOpen) {
        api("on_heartbeat", { page: page });
      }
    }, HEARTBEAT_MS);
  }

  function stopHB() {
    if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
  }

  // ── Visibility change ─────────────────────────────────────────────────────
  function onVisibility() {
    if (!isOpen) return;
    if (document.visibilityState === "hidden") {
      if (!closing) {
        closing = true;
        stopHB();
        beacon();
        setTimeout(function () { isOpen = false; closing = false; }, 500);
      }
    } else if (document.visibilityState === "visible") {
      if (!isOpen && !closing && page) {
        openSession();
      }
    }
  }

  // ���─ Core lifecycle ────────────────────────────────────────────────────────
  function openSession() {
    if (isOpen || closing) return;
    isOpen = true;
    api("on_page_open", { page: page }).then(startHB);
  }

  function closeSession() {
    if (!isOpen && !closing) return;
    closing = true; isOpen = false;
    stopHB();
    beacon();
    setTimeout(function () { closing = false; }, 200);
  }

  // ── Attach browser events ONCE ────────────────────────────────────────────
  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", function () {
      if (isOpen) { closing = true; stopHB(); beacon(); }
    });
    window.addEventListener("pagehide", function (e) {
      if (isOpen && !e.persisted) { closing = true; stopHB(); beacon(); }
    });
  }

  // ── Public: init (idempotent) ─────────────────────────────────────────────
  function init(p) {
    if (!p) return;
    if (!frappe.session || !frappe.session.user || frappe.session.user === "Guest") return;
    // Already tracking same page — skip
    if (page === p && isOpen && !closing) return;

    page = p;
    closing = false;
    isOpen = false;
    bind();
    if (document.visibilityState === "visible") openSession();
  }

  return { init: init, close: closeSession };
})();
