(() => {
  // ../pro_lms/pro_lms/public/js/lms_session.bundle.js
  window.LmsSession = (() => {
    const HEARTBEAT_MS = 3e4;
    const API = "pro_lms.lms_for_dbr.bot.session_tracker";
    let page = null;
    let hbTimer = null;
    let isOpen = false;
    let closing = false;
    let bound = false;
    function api(method, data) {
      return frappe.call({ method: API + "." + method, args: data || {} });
    }
    function beacon() {
      if (!page)
        return;
      var cmd = API + ".on_page_close";
      var body = new URLSearchParams({
        cmd,
        page,
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
    function startHB() {
      stopHB();
      hbTimer = setInterval(function() {
        if (document.visibilityState === "visible" && isOpen) {
          api("on_heartbeat", { page });
        }
      }, HEARTBEAT_MS);
    }
    function stopHB() {
      if (hbTimer) {
        clearInterval(hbTimer);
        hbTimer = null;
      }
    }
    function onVisibility() {
      if (!isOpen)
        return;
      if (document.visibilityState === "hidden") {
        if (!closing) {
          closing = true;
          stopHB();
          beacon();
          setTimeout(function() {
            isOpen = false;
            closing = false;
          }, 500);
        }
      } else if (document.visibilityState === "visible") {
        if (!isOpen && !closing && page) {
          openSession();
        }
      }
    }
    function openSession() {
      if (isOpen || closing)
        return;
      isOpen = true;
      api("on_page_open", { page }).then(startHB);
    }
    function closeSession() {
      if (!isOpen && !closing)
        return;
      closing = true;
      isOpen = false;
      stopHB();
      beacon();
      setTimeout(function() {
        closing = false;
      }, 200);
    }
    function bind() {
      if (bound)
        return;
      bound = true;
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("beforeunload", function() {
        if (isOpen) {
          closing = true;
          stopHB();
          beacon();
        }
      });
      window.addEventListener("pagehide", function(e) {
        if (isOpen && !e.persisted) {
          closing = true;
          stopHB();
          beacon();
        }
      });
    }
    function init(p) {
      if (!p)
        return;
      if (!frappe.session || !frappe.session.user || frappe.session.user === "Guest")
        return;
      if (page === p && isOpen && !closing)
        return;
      page = p;
      closing = false;
      isOpen = false;
      bind();
      if (document.visibilityState === "visible")
        openSession();
    }
    return { init, close: closeSession };
  })();
})();
//# sourceMappingURL=lms_session.bundle.67FOOIHK.js.map
