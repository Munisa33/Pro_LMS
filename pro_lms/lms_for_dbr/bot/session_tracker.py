"""
pro_lms/lms_for_dbr/bot/session_tracker.py

Frappe v15 | Redis-backed session state machine

Session lifecycle:
  OPEN  →  on_page_open()    called from JS on page load
  ALIVE →  on_heartbeat()    called from JS every 30 seconds
  CLOSE →  on_page_close()   called via sendBeacon on visibilitychange(hidden) / beforeunload
  DEAD  →  check_dead_sessions() scheduled every 1 min (catches hard close / crash)

Redis key schema:
  lms_pages_{emp}          → JSON list of currently open page names  (TTL: 24h)
  lms_meta_{emp}           → JSON dict {entry_time, entry_notified}  (TTL: 24h)
  lms_hb_{emp}_{page}      → "1" heartbeat key                       (TTL: 90s auto-expire)
  lms_active_employees     → JSON list of all employees with sessions (TTL: 24h)
  lms_exit_sent_{emp}_{ts} → "1" dedup key for exit notification      (TTL: 1h)

hooks.py registration:
  scheduler_events = {
      "cron": {
          "* * * * *": ["pro_lms.lms_for_dbr.bot.session_tracker.check_dead_sessions"]
      }
  }
"""

import json

import frappe
from frappe.utils import now_datetime, get_datetime

# ── Tuneable constants ────────────────────────────────────────────────────────
HEARTBEAT_TTL_SEC  = 90      # Redis TTL for heartbeat key; JS sends every 30s → 3x margin
SESSION_META_TTL   = 86400   # 24h — max session lifetime in Redis
EXIT_DEDUP_TTL     = 3600    # 1h  — prevent duplicate exit notifications
ACTIVE_EMPLOYEES_KEY = "lms_active_employees"
ALLOWED_PAGES      = {"dashboard", "player"}  # Only these values accepted from JS

# ── Redis helpers ─────────────────────────────────────────────────────────────

def _rget(key: str):
    """Get value from Redis cache, parse JSON if possible."""
    val = frappe.cache().get_value(key)
    if val is None:
        return None
    if isinstance(val, (dict, list)):
        return val
    try:
        return json.loads(val)
    except (TypeError, ValueError):
        return val


def _rset(key: str, value, ttl: int):
    """Set value in Redis cache as JSON string."""
    raw = json.dumps(value) if not isinstance(value, str) else value
    frappe.cache().set_value(key, raw, expires_in_sec=ttl)


def _rdel(key: str):
    frappe.cache().delete_value(key)


# ── Active employee index ─────────────────────────────────────────────────────

def _index_add(employee: str):
    lst = _rget(ACTIVE_EMPLOYEES_KEY) or []
    if employee not in lst:
        lst.append(employee)
    _rset(ACTIVE_EMPLOYEES_KEY, lst, SESSION_META_TTL)


def _index_remove(employee: str):
    lst = _rget(ACTIVE_EMPLOYEES_KEY) or []
    lst = [e for e in lst if e != employee]
    _rset(ACTIVE_EMPLOYEES_KEY, lst, SESSION_META_TTL)


# ── Internal helpers ──────────────────────────────────────────────────────────

def _resolve_employee() -> tuple[str | None, dict | None]:
    """
    Resolve current session user → (employee_id, employee_doc_dict).
    Returns (None, None) if not found or system user.
    """
    user = frappe.session.user
    if not user or user in ("Administrator", "Guest"):
        return None, None

    emp = frappe.db.get_value(
        "Employee",
        {"user_id": user},
        ["name", "employee_name", "designation", "department", "user_id"],
        as_dict=True,
    )
    if not emp:
        return None, None
    return emp.name, emp


def _trigger_exit(employee: str, emp: dict):
    """
    Common exit logic called both from explicit close and dead-session detection.
    Clears Redis state and dispatches session summary notification.
    """
    meta = _rget(f"lms_meta_{employee}") or {}
    entry_time = meta.get("entry_time")

    # Dedup — prevent double notification if sendBeacon AND scheduler both fire
    ts_key = str(entry_time or now_datetime())[:16].replace(" ", "_").replace(":", "-")
    dedup  = f"lms_exit_sent_{employee}_{ts_key}"
    if _rget(dedup):
        return
    _rset(dedup, "1", EXIT_DEDUP_TTL)

    # Clear all Redis state
    _rdel(f"lms_pages_{employee}")
    _rdel(f"lms_meta_{employee}")
    _index_remove(employee)

    # Send notification (import here to avoid circular)
    from pro_lms.lms_for_dbr.bot.notifications import send_exit_notification
    send_exit_notification(employee, emp, entry_time)


# ════════════════════════════════════════════════════════════════════════════
# PUBLIC API ENDPOINTS  (called from JS via fetch / sendBeacon)
# ════════════════════════════════════════════════════════════════════════════

@frappe.whitelist()
def on_page_open(page: str) -> dict:
    """
    Called when LMS Dashboard or LMS Player opens.
    page = "dashboard" | "player"
    """
    if page not in ALLOWED_PAGES:
        return {"status": "error", "msg": "invalid page"}

    employee, emp = _resolve_employee()
    if not employee:
        return {"status": "skip"}

    # Pending exit bekor qilish (dashboard→player internal navigation)
    _rdel(f"lms_pending_exit_{employee}")

    pages_key = f"lms_pages_{employee}"
    meta_key  = f"lms_meta_{employee}"

    active_pages = _rget(pages_key) or []
    is_new_session = len(active_pages) == 0

    if page not in active_pages:
        active_pages.append(page)
    _rset(pages_key, active_pages, SESSION_META_TTL)

    # Refresh heartbeat
    frappe.cache().set_value(
        f"lms_hb_{employee}_{page}", "1", expires_in_sec=HEARTBEAT_TTL_SEC
    )

    if is_new_session:
        # Eski dedup keyni tozalash — yangi sessiya boshlandi
        old_meta = _rget(meta_key)
        if old_meta:
            if isinstance(old_meta, str):
                import json as _json
                old_meta = _json.loads(old_meta)
            old_entry = old_meta.get("entry_time", "")
            if old_entry:
                old_ts = str(old_entry)[:16].replace(" ", "_").replace(":", "-")
                _rdel(f"lms_exit_sent_{employee}_{old_ts}")

        # New session — initialize meta and notify
        meta = {"entry_time": str(now_datetime()), "entry_notified": False}
        _rset(meta_key, meta, SESSION_META_TTL)
        _index_add(employee)

        from pro_lms.lms_for_dbr.bot.notifications import send_entry_notification
        send_entry_notification(employee, emp)

        meta["entry_notified"] = True
        _rset(meta_key, meta, SESSION_META_TTL)

    return {"status": "ok", "new_session": is_new_session}

@frappe.whitelist()
def on_heartbeat(page: str) -> dict:
    """
    Called every 30 seconds while the page is visible.
    Simply refreshes the heartbeat TTL so the scheduler knows the session is alive.
    """
    if page not in ALLOWED_PAGES:
        return {"status": "error", "msg": "invalid page"}

    employee, _ = _resolve_employee()
    if not employee:
        return {"status": "skip"}

    frappe.cache().set_value(
        f"lms_hb_{employee}_{page}", "1", expires_in_sec=HEARTBEAT_TTL_SEC
    )
    return {"status": "ok"}


@frappe.whitelist()
def on_page_close(page: str) -> dict:
    """
    Called via sendBeacon when a page unloads (visibilitychange: hidden / beforeunload).
    page = "dashboard" | "player"
    """
    if page not in ALLOWED_PAGES:
        return {"status": "error", "msg": "invalid page"}

    employee, emp = _resolve_employee()
    if not employee:
        return {"status": "skip"}

    pages_key = f"lms_pages_{employee}"
    active_pages = _rget(pages_key) or []

    # Remove this page
    active_pages = [p for p in active_pages if p != page]
    _rdel(f"lms_hb_{employee}_{page}")

    if len(active_pages) == 0:
        # Last LMS page closed → fire exit
        _trigger_exit(employee, emp)
    else:
        _rset(pages_key, active_pages, SESSION_META_TTL)

    return {"status": "ok"}


# ════════════════════════════════════════════════════════════════════════════
# SCHEDULED JOB — every 1 minute
# Catches hard close / crash / network drop (heartbeat TTL expired naturally)
# ════════════════════════════════════════════════════════════════════════════

def check_dead_sessions() -> None:
    """
    Iterates all employees in the active index.
    For each: checks whether ALL their heartbeat keys have expired.
    If yes → all pages are dead → trigger exit notification.

    This covers:
      - Browser killed via Task Manager
      - Mobile OS killing the tab
      - Network disconnection (page_unload never fired)
      - Any scenario where sendBeacon failed to deliver
    """
    try:
        active_employees = _rget(ACTIVE_EMPLOYEES_KEY) or []
        if not active_employees:
            return

        for employee in list(active_employees):
            pages = _rget(f"lms_pages_{employee}")
            if not pages:
                # Stale index entry — clean up
                _index_remove(employee)
                continue

            # Check if any heartbeat is still alive
            any_alive = any(
                frappe.cache().get_value(f"lms_hb_{employee}_{p}")
                for p in pages
            )

            if not any_alive:
                # All heartbeats expired — session is dead
                emp = frappe.db.get_value(
                    "Employee",
                    employee,
                    ["employee_name", "designation", "department", "user_id"],
                    as_dict=True,
                )
                if emp:
                    _trigger_exit(employee, emp)
                else:
                    # Employee deleted — just clean up
                    _rdel(f"lms_pages_{employee}")
                    _rdel(f"lms_meta_{employee}")
                    _index_remove(employee)

    except Exception as exc:
        frappe.log_error(str(exc), "LMS Bot Dead Session Check")
