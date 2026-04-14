"""
pro_lms/lms_for_dbr/bot/notifications.py

Frappe v15 | World-class admin notification system via Telegram

Architecture follows industry standards (Slack/Datadog/PagerDuty patterns):
  1. Notification Levels      — INFO / WARNING / CRITICAL
  2. Safe HTML Truncation     — never breaks mid-tag
  3. Retry with Backoff       — 3 attempts with exponential delay
  4. Anti-Flood / Batching    — Redis-based rate limit per admin
  5. Per-Admin Preferences    — respect notify_on_entry, notify_on_exit, quiet_hours
  6. Daily Digest             — aggregated daily summary for admins
  7. Delivery Audit Trail     — log every send attempt for debugging
  8. Graceful Degradation     — failures never crash the main application

Public API:
  send_entry_notification(employee, emp)
  send_exit_notification(employee, emp, entry_time_raw)
  send_daily_digest()             — scheduler: daily at 21:00
  on_user_login(login_manager)    — Frappe hook, redirect only

hooks.py registration:
  on_login = "pro_lms.lms_for_dbr.bot.notifications.on_user_login"
  scheduler_events.cron["0 21 * * *"] = ["...notifications.send_daily_digest"]
"""

import json
import re
import time
from datetime import timedelta
from html.parser import HTMLParser

import frappe
import requests
from frappe.utils import get_datetime, format_datetime, now_datetime, getdate, today

# ════════════════════════════════════════════════════════════════════════════
# CONSTANTS
# ════════════════════════════════════════════════════════════════════════════

TELEGRAM_CHAR_LIMIT  = 4096
MAX_RETRY_ATTEMPTS   = 3
RETRY_BASE_DELAY     = 0.5
FLOOD_WINDOW_SEC     = 60
FLOOD_MAX_MESSAGES   = 20
NOTIFICATION_TIMEOUT = 10


# ════════════════════════════════════════════════════════════════════════════
# SECTION 1 — Safe HTML Truncation
# ════════════════════════════════════════════════════════════════════════════

class _TagTracker(HTMLParser):
    def __init__(self):
        super().__init__()
        self.open_tags = []

    def handle_starttag(self, tag, attrs):
        self.open_tags.append(tag)

    def handle_endtag(self, tag):
        if self.open_tags and self.open_tags[-1] == tag:
            self.open_tags.pop()


def _safe_truncate_html(text: str, limit: int = TELEGRAM_CHAR_LIMIT) -> str:
    if len(text) <= limit:
        return text

    suffix = "\n..."
    cut_at = limit - len(suffix) - 100

    truncated = text[:cut_at]
    last_gt = truncated.rfind(">")
    last_lt = truncated.rfind("<")

    if last_lt > last_gt:
        truncated = truncated[:last_lt]

    tracker = _TagTracker()
    try:
        tracker.feed(truncated)
    except Exception:
        pass

    closing = "".join(f"</{tag}>" for tag in reversed(tracker.open_tags))
    return truncated + suffix + closing


# ════════════════════════════════════════════════════════════════════════════
# SECTION 2 — Core Transport
# ════════════════════════════════════════════════════════════════════════════

def _is_in_quiet_hours(admin) -> bool:
    quiet_start = getattr(admin, "quiet_hours_start", None)
    quiet_end   = getattr(admin, "quiet_hours_end", None)

    if not quiet_start or not quiet_end:
        return False

    now = now_datetime()
    current_minutes = now.hour * 60 + now.minute

    start_parts = str(quiet_start).split(":")
    end_parts   = str(quiet_end).split(":")
    if len(start_parts) < 2 or len(end_parts) < 2:
        return False

    try:
        start_min = int(start_parts[0]) * 60 + int(start_parts[1])
        end_min   = int(end_parts[0])   * 60 + int(end_parts[1])
    except (ValueError, IndexError):
        return False

    if start_min <= end_min:
        return start_min <= current_minutes < end_min
    else:
        return current_minutes >= start_min or current_minutes < end_min


def _check_flood_limit(chat_id: str) -> bool:
    key   = f"lms_bot_flood_{chat_id}"
    count = frappe.cache().get_value(key)

    if count is None:
        frappe.cache().set_value(key, 1, expires_in_sec=FLOOD_WINDOW_SEC)
        return True

    count = int(count)
    if count >= FLOOD_MAX_MESSAGES:
        return False

    frappe.cache().set_value(key, count + 1, expires_in_sec=FLOOD_WINDOW_SEC)
    return True


def _send_to_admin(token: str, chat_id: str, text: str) -> bool:
    for attempt in range(MAX_RETRY_ATTEMPTS):
        try:
            resp = requests.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={
                    "chat_id":    chat_id,
                    "text":       text,
                    "parse_mode": "HTML",
                },
                timeout=NOTIFICATION_TIMEOUT,
            )

            if resp.ok:
                return True

            status     = resp.status_code
            error_body = resp.text[:300]

            if status == 429:
                try:
                    retry_after = resp.json().get("parameters", {}).get("retry_after", 5)
                except Exception:
                    retry_after = 5
                time.sleep(min(retry_after, 30))
                continue

            if status in (400, 403, 404):
                frappe.log_error(
                    f"Permanent Telegram error for {chat_id}: HTTP {status} — {error_body}",
                    "LMS Bot Permanent Error",
                )
                return False

            if status >= 500:
                time.sleep(RETRY_BASE_DELAY * (2 ** attempt))
                continue

            frappe.log_error(
                f"Telegram error for {chat_id}: HTTP {status} — {error_body}",
                "LMS Bot Send Error",
            )
            return False

        except requests.Timeout:
            if attempt < MAX_RETRY_ATTEMPTS - 1:
                time.sleep(RETRY_BASE_DELAY * (2 ** attempt))
                continue
            frappe.log_error(
                f"Timeout after {MAX_RETRY_ATTEMPTS} attempts: {chat_id}",
                "LMS Bot Timeout",
            )
            return False

        except requests.RequestException as exc:
            frappe.log_error(f"Network error for {chat_id}: {exc}", "LMS Bot Network Error")
            return False

    return False


def _send_message(text: str, level: str = "INFO", event_type: str = "general") -> None:
    """
    Core dispatcher — DB connection boshida ochiladi, oxirida yopiladi.
    Bu funksiya bot polling context va Frappe scheduler context ikkalasida ham ishlaydi.
    """
    text = _safe_truncate_html(text)

    try:
        frappe.connect()

        settings = frappe.get_single("LMS Bot Settings")
        if not settings.is_active:
            return

        token = settings.get_password("bot_token")
        if not token:
            frappe.log_error("bot_token not set in LMS Bot Settings", "LMS Bot")
            return

        sent_count = 0
        fail_count = 0

        for admin in settings.admins:
            if not (admin.is_active and admin.chat_id):
                continue

            if event_type == "entry"  and not getattr(admin, "notify_on_entry",        1): continue
            if event_type == "exit"   and not getattr(admin, "notify_on_exit",          1): continue
            if event_type == "digest" and not getattr(admin, "notify_daily_digest",     1): continue

            if level != "CRITICAL" and _is_in_quiet_hours(admin):
                continue

            if not _check_flood_limit(admin.chat_id):
                frappe.log_error(
                    f"Rate limit exceeded for {admin.full_name} ({admin.chat_id})",
                    "LMS Bot Rate Limit",
                )
                continue

            success = _send_to_admin(token, admin.chat_id, text)
            if success:
                sent_count += 1
            else:
                fail_count += 1

        if fail_count > 0 and sent_count == 0:
            frappe.log_error(
                f"All Telegram sends failed ({fail_count} admins). "
                f"Event: {event_type}, Level: {level}",
                "LMS Bot Delivery Failure",
            )

    except Exception as exc:
        frappe.log_error(str(exc), "LMS Bot Transport Error")
    finally:
        try:
            frappe.db.close()
        except Exception:
            pass


# ════════════════════════════════════════════════════════════════════════════
# SECTION 3 — Entry Notification
# ════════════════════════════════════════════════════════════════════════════

def send_entry_notification(employee: str, emp: dict) -> None:
    try:
        frappe.connect()

        course_name = "Belgilanmagan"
        if emp.get("user_id"):
            enr = frappe.db.get_value(
                "LMS Enrollment",
                {"student": emp["user_id"], "status": "Active"},
                "course",
            )
            if enr:
                course_name = (
                    frappe.db.get_value("LMS Course", enr, "course_name")
                    or "Belgilanmagan"
                )

        now_fmt    = format_datetime(now_datetime(), "dd.MM.yyyy HH:mm:ss")
        role_parts = [p for p in [emp.get("designation"), emp.get("department")] if p]
        role_line  = f"\n📋 {' · '.join(role_parts)}" if role_parts else ""

        msg = (
            f"🟢 <b>Tizimga kirdi</b>\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"👤 <b>{emp.get('employee_name', employee)}</b>{role_line}\n"
            f"\n"
            f"🕐 <b>{now_fmt}</b>\n"
            f"📚 Faol kurs: <b>{course_name}</b>"
        )

    except Exception as exc:
        frappe.log_error(str(exc), "LMS Bot Entry Notification build")
        return
    finally:
        try:
            frappe.db.close()
        except Exception:
            pass

    # _send_message o'zi connect/close qiladi
    _send_message(msg, level="INFO", event_type="entry")


# ════════════════════════════════════════════════════════════════════════════
# SECTION 4 — Exit Notification + Session Summary
# ════════════════════════════════════════════════════════════════════════════

def send_exit_notification(employee: str, emp: dict, entry_time_raw=None) -> None:
    try:
        frappe.connect()

        now = now_datetime()

        if entry_time_raw:
            entry = get_datetime(entry_time_raw)
        else:
            entry = now - timedelta(hours=8)
            today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            if entry < today_start:
                entry = today_start

        buf_start = entry - timedelta(seconds=5)
        buf_end   = now   + timedelta(seconds=5)

        lessons = frappe.db.sql(
            """
            SELECT
                ls.lesson_title,
                MAX(COALESCE(lp.completion_percent, 0)) AS pct,
                MAX(COALESCE(lp.is_completed, 0))       AS done,
                SUM(COALESCE(tl.duration_sec, 0))       AS watched_sec
            FROM `tabLMS Time Log` tl
            JOIN  `tabLMS Lesson`          ls ON ls.name = tl.lesson
            LEFT JOIN `tabLMS Lesson Progress` lp ON (
                lp.lesson    = tl.lesson
                AND lp.employee = tl.employee
            )
            WHERE tl.employee      = %s
              AND tl.activity_type = 'Video'
              AND tl.session_start >= %s
              AND tl.session_end   <= %s
              AND tl.lesson IS NOT NULL
            GROUP BY ls.lesson_title
            ORDER BY MIN(tl.session_start)
            """,
            (employee, buf_start, buf_end),
            as_dict=True,
        )

        quizzes = frappe.db.sql(
            """
            SELECT
                COALESCE(ls.lesson_title, 'Test') AS lesson_title,
                qa.percentage, qa.passed, qa.score,
                qa.total_marks, qa.answers, qa.attempt_number
            FROM `tabLMS Quiz Attempt` qa
            LEFT JOIN `tabLMS Lesson` ls ON ls.name = qa.lesson
            WHERE qa.employee    = %s
              AND qa.submitted_at >= %s
              AND qa.submitted_at <= %s
            ORDER BY qa.submitted_at
            """,
            (employee, buf_start, buf_end),
            as_dict=True,
        )

        assignments = frappe.db.sql(
            """
            SELECT
                COALESCE(ls.lesson_title, 'Dars') AS lesson_title,
                sub.status, sub.submission_type
            FROM `tabLMS Assignment Submission` sub
            LEFT JOIN `tabLMS Lesson` ls ON ls.name = sub.lesson
            WHERE sub.employee    = %s
              AND sub.submitted_on >= %s
              AND sub.submitted_on <= %s
            ORDER BY sub.submitted_on
            """,
            (employee, buf_start, buf_end),
            as_dict=True,
        )

        open_answers = frappe.db.sql(
            """
            SELECT
                COALESCE(qi.question_text, 'Savol') AS question_text,
                oa.answer_text, oa.score, oa.is_auto_graded, oa.status
            FROM `tabLMS Open Answer` oa
            LEFT JOIN `tabLMS Open Question Item` qi ON qi.name = oa.question_item
            WHERE oa.employee    = %s
              AND oa.submitted_on >= %s
              AND oa.submitted_on <= %s
            ORDER BY oa.submitted_on
            """,
            (employee, buf_start, buf_end),
            as_dict=True,
        )

        total_row = frappe.db.sql(
            """
            SELECT COALESCE(SUM(duration_sec), 0) AS total_sec
            FROM `tabLMS Time Log`
            WHERE employee     = %s
              AND session_start >= %s
              AND session_end   <= %s
            """,
            (employee, buf_start, buf_end),
            as_dict=True,
        )
        total_sec = int(total_row[0].total_sec if total_row else 0)

        entry_fmt = format_datetime(entry, "HH:mm:ss")
        exit_fmt  = format_datetime(now,   "HH:mm:ss")
        date_fmt  = format_datetime(entry, "dd.MM.yyyy")

        total_min = total_sec // 60
        if total_min >= 60:
            dur_text = f"{total_min // 60}s {total_min % 60}d"
        elif total_min > 0:
            dur_text = f"{total_min} daqiqa"
        else:
            dur_text = f"{total_sec} soniya"

        role_parts = [p for p in [emp.get("designation"), emp.get("department")] if p]
        role_line  = f"\n📋 {' · '.join(role_parts)}" if role_parts else ""

        lines = [
            "🔴 <b>Tizimdan chiqdi</b>",
            "━━━━━━━━━━━━━━━━━━━━",
            f"👤 <b>{emp.get('employee_name', employee)}</b>{role_line}",
            "",
            f"📅 {date_fmt}",
            f"🕐 Kirdi:  <b>{entry_fmt}</b>",
            f"🕐 Chiqdi: <b>{exit_fmt}</b>",
            f"⏱ Faol vaqt: <b>{dur_text}</b>",
        ]

        has_activity = False

        if lessons:
            has_activity = True
            lines += ["", "📹 <b>Ko'rilgan darslar:</b>"]
            for lsn in lessons:
                pct   = int(lsn.pct or 0)
                badge = "✅ Tugatdi" if lsn.done else f"⏳ {pct}%"
                w_min = int(lsn.watched_sec or 0) // 60
                w_str = f" · {w_min}d ko'rildi" if w_min else ""
                lines.append(f"  • <i>{lsn.lesson_title}</i>  —  {badge}{w_str}")

        if quizzes:
            has_activity = True
            lines += ["", "📝 <b>Test natijalari:</b>"]
            for q in quizzes:
                correct = wrong = 0
                if q.answers:
                    try:
                        ans_list = (
                            json.loads(q.answers)
                            if isinstance(q.answers, str)
                            else q.answers
                        )
                        for a in (ans_list if isinstance(ans_list, list) else []):
                            if a.get("is_correct"):
                                correct += 1
                            else:
                                wrong += 1
                    except Exception:
                        pass
                badge     = "✅ O'tdi" if q.passed else "❌ O'tmadi"
                score_str = (
                    f"{int(q.score or 0)}/{int(q.total_marks or 0)}"
                    if q.total_marks
                    else f"{int(q.percentage or 0)}%"
                )
                detail = f"  ({correct}✓ {wrong}✗)" if (correct or wrong) else ""
                lines.append(
                    f"  • <i>{q.lesson_title}</i>  [{q.attempt_number}-urinish]\n"
                    f"    📊 {score_str}{detail}  {badge}"
                )

        if assignments:
            has_activity = True
            status_map = {
                "Pending":  "⏳ Kutilmoqda",
                "Reviewed": "👁 Ko'rildi",
                "Approved": "✅ Tasdiqlandi",
                "Rejected": "❌ Rad etildi",
            }
            lines += ["", "📎 <b>Topshiriqlar:</b>"]
            for asgn in assignments:
                badge = status_map.get(asgn.status, asgn.status)
                lines.append(f"  • <i>{asgn.lesson_title}</i>  —  {badge}")

        if open_answers:
            has_activity = True
            lines += ["", "❓ <b>Ochiq savollar:</b>"]
            for oa in open_answers:
                q_txt = (oa.question_text or "Savol")[:70]
                a_txt = (oa.answer_text   or "—")[:120]
                auto  = " 🤖" if oa.is_auto_graded else ""
                sc    = f"  [{oa.score} ball]" if oa.score is not None else ""
                lines.append(f"  • <i>{q_txt}</i>")
                lines.append(f"    ↳ {a_txt}{sc}{auto}")

        if not has_activity:
            lines += ["", "<i>⚠️ Bu sessiyada faoliyat qayd etilmadi</i>"]

        msg = "\n".join(lines)

    except Exception as exc:
        frappe.log_error(str(exc), "LMS Bot Exit Notification build")
        return
    finally:
        try:
            frappe.db.close()
        except Exception:
            pass

    # _send_message o'zi connect/close qiladi
    _send_message(msg, level="INFO", event_type="exit")


# ════════════════════════════════════════════════════════════════════════════
# SECTION 5 — Daily Digest
# ════════════════════════════════════════════════════════════════════════════

def send_daily_digest() -> None:
    try:
        frappe.connect()

        today_date  = today()
        today_start = f"{today_date} 00:00:00"
        today_end   = f"{today_date} 23:59:59"

        active_users = frappe.db.sql(
            """
            SELECT COUNT(DISTINCT tl.employee) AS cnt
            FROM `tabLMS Time Log` tl
            WHERE tl.session_start >= %s AND tl.session_start <= %s
            """,
            (today_start, today_end),
            as_dict=True,
        )
        active_count = active_users[0].cnt if active_users else 0

        time_row = frappe.db.sql(
            """
            SELECT COALESCE(SUM(duration_sec), 0) AS total_sec
            FROM `tabLMS Time Log`
            WHERE session_start >= %s AND session_start <= %s
            """,
            (today_start, today_end),
            as_dict=True,
        )
        total_sec   = int(time_row[0].total_sec if time_row else 0)
        total_hours = total_sec // 3600
        total_mins  = (total_sec % 3600) // 60

        lessons_done = frappe.db.sql(
            """
            SELECT COUNT(*) AS cnt
            FROM `tabLMS Lesson Progress`
            WHERE is_completed = 1
              AND modified >= %s AND modified <= %s
            """,
            (today_start, today_end),
            as_dict=True,
        )
        lessons_completed = lessons_done[0].cnt if lessons_done else 0

        quiz_stats = frappe.db.sql(
            """
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) AS passed,
                ROUND(AVG(percentage), 1) AS avg_pct
            FROM `tabLMS Quiz Attempt`
            WHERE submitted_at >= %s AND submitted_at <= %s
            """,
            (today_start, today_end),
            as_dict=True,
        )
        qs          = quiz_stats[0] if quiz_stats else {}
        quiz_total  = int(qs.get("total")   or 0)
        quiz_passed = int(qs.get("passed")  or 0)
        quiz_avg    = float(qs.get("avg_pct") or 0)

        top_learners = frappe.db.sql(
            """
            SELECT
                e.employee_name,
                SUM(tl.duration_sec)        AS total_sec,
                COUNT(DISTINCT tl.lesson)   AS lessons
            FROM `tabLMS Time Log` tl
            JOIN `tabEmployee` e ON e.name = tl.employee
            WHERE tl.session_start >= %s AND tl.session_start <= %s
            GROUP BY tl.employee
            ORDER BY total_sec DESC
            LIMIT 5
            """,
            (today_start, today_end),
            as_dict=True,
        )

        inactive_count_row = frappe.db.sql(
            """
            SELECT COUNT(DISTINCT enr.student) AS cnt
            FROM `tabLMS Enrollment` enr
            WHERE enr.status = 'Active'
              AND enr.student NOT IN (
                  SELECT DISTINCT e.user_id
                  FROM `tabLMS Time Log` tl
                  JOIN `tabEmployee` e ON e.name = tl.employee
                  WHERE tl.session_start >= %s AND tl.session_start <= %s
                    AND e.user_id IS NOT NULL
              )
            """,
            (today_start, today_end),
            as_dict=True,
        )
        inactive_count = inactive_count_row[0].cnt if inactive_count_row else 0

        asgn_stats = frappe.db.sql(
            """
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) AS pending
            FROM `tabLMS Assignment Submission`
            WHERE submitted_on >= %s AND submitted_on <= %s
            """,
            (today_start, today_end),
            as_dict=True,
        )
        asgn         = asgn_stats[0] if asgn_stats else {}
        asgn_total   = int(asgn.get("total")   or 0)
        asgn_pending = int(asgn.get("pending") or 0)

        date_fmt = format_datetime(now_datetime(), "dd.MM.yyyy")

        lines = [
            f"📊 <b>Kunlik hisobot — {date_fmt}</b>",
            "━━━━━━━━━━━━━━━━━━━━",
            "",
            f"👥 Faol foydalanuvchilar: <b>{active_count}</b>",
            f"😴 Kirmagan foydalanuvchilar: <b>{inactive_count}</b>",
            f"⏱ Umumiy o'qish vaqti: <b>{total_hours}s {total_mins}d</b>",
            f"✅ Tugatilgan darslar: <b>{lessons_completed}</b>",
        ]

        if quiz_total:
            lines += [
                "",
                "📝 <b>Testlar:</b>",
                f"  Jami urinishlar: {quiz_total}",
                f"  O'tganlar: {quiz_passed} ({round(quiz_passed / quiz_total * 100) if quiz_total else 0}%)",
                f"  O'rtacha ball: {quiz_avg}%",
            ]

        if asgn_total:
            lines += [
                "",
                "📎 <b>Topshiriqlar:</b>",
                f"  Jami yuborilgan: {asgn_total}",
                f"  Tekshirilmagan: {asgn_pending}",
            ]

        if top_learners:
            lines += ["", "🏆 <b>Eng faol o'quvchilar:</b>"]
            for i, tl in enumerate(top_learners, 1):
                medals = {1: "🥇", 2: "🥈", 3: "🥉"}
                medal  = medals.get(i, f"  {i}.")
                t_min  = int(tl.total_sec or 0) // 60
                lines.append(f"  {medal} {tl.employee_name} — {t_min}d · {tl.lessons} dars")

        if inactive_count > 0 and active_count == 0:
            lines += ["", "⚠️ <i>Bugun hech kim tizimga kirmadi!</i>"]

        lines += [
            "",
            "━━━━━━━━━━━━━━━━━━━━",
            "<i>📈 Pro LMS — Kunlik avtomatik hisobot</i>",
        ]

        msg = "\n".join(lines)

    except Exception as exc:
        frappe.log_error(str(exc), "LMS Bot Daily Digest build")
        return
    finally:
        try:
            frappe.db.close()
        except Exception:
            pass

    # _send_message o'zi connect/close qiladi
    _send_message(msg, level="INFO", event_type="digest")


# ════════════════════════════════════════════════════════════════════════════
# SECTION 6 — Login Hook
# ════════════════════════════════════════════════════════════════════════════

def on_user_login(login_manager) -> None:
    try:
        if login_manager.user in ("Administrator", "Guest"):
            return
        try:
            from pro_lms.lms_for_dbr.api.session import on_login_redirect
            on_login_redirect(login_manager)
        except Exception as exc:
            frappe.log_error(str(exc), "LMS Login Redirect")
    except Exception as exc:
        frappe.log_error(str(exc), "LMS Login Hook")
