"""
pro_lms/lms_for_dbr/bot/bot.py

Telegram bot command & reply keyboard handlers.
Used by runner.py for polling mode.

Commands:
  /start   — Register admin, show persistent reply keyboard
  /digest  — Send daily digest report now

Reply Keyboard (persistent menu at bottom):
  [📊 Kunlik hisobot]  — Same as /digest

All notification transport is in notifications.py.
All session lifecycle logic is in session_tracker.py.
"""

import frappe
from frappe.utils import now_datetime
from telegram import Update, KeyboardButton, ReplyKeyboardMarkup
from telegram.ext import ContextTypes


def get_settings():
    return frappe.get_single("LMS Bot Settings")


def _reply_keyboard():
    """
    Persistent Reply Keyboard — doim pastda menu kabi turadi.
    resize_keyboard=True: tugma kichikroq ko'rinadi (telefonda qulay)
    is_persistent=True: klaviatura doim ko'rinib turadi, yashirilmaydi
    """
    return ReplyKeyboardMarkup(
        [
            [KeyboardButton("📊 Kunlik hisobot")],
        ],
        resize_keyboard=True,
        is_persistent=True,
    )


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Admin /start bosganida chat_id avtomatik saqlanadi"""
    user = update.effective_user
    chat_id = str(update.effective_chat.id)
    full_name = user.full_name or ""
    username = user.username or ""

    settings = frappe.get_single("LMS Bot Settings")

    existing = None
    for admin in settings.admins:
        if admin.chat_id == chat_id:
            existing = admin
            break

    if existing:
        existing.full_name = full_name
        existing.telegram_username = username
        existing.is_active = 1
        settings.save(ignore_permissions=True)

        await update.message.reply_text(
            f"Salom, {full_name}!\n"
            f"Siz allaqachon ro'yxatdan o'tgansiz.\n"
            f"Bildirishnomalar faol.",
            reply_markup=_reply_keyboard(),
        )
    else:
        settings.append("admins", {
            "full_name": full_name,
            "telegram_username": username,
            "chat_id": chat_id,
            "is_active": 1,
            "registered_on": now_datetime()
        })
        settings.save(ignore_permissions=True)

        await update.message.reply_text(
            f"Xush kelibsiz, {full_name}!\n\n"
            f"Siz Pro LMS admin paneliga ulandingiz.\n"
            f"Endi barcha bildirishnomalar sizga keladi.",
            reply_markup=_reply_keyboard(),
        )

    frappe.db.commit()


async def digest_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """/digest komandasi — kunlik hisobotni darhol yuboradi"""
    chat_id = str(update.effective_chat.id)

    settings = frappe.get_single("LMS Bot Settings")
    is_admin = any(
        a.chat_id == chat_id and a.is_active
        for a in settings.admins
    )
    if not is_admin:
        await update.message.reply_text(
            "Siz admin sifatida ro'yxatdan o'tmagansiz.\n"
            "Avval /start bosing.",
            reply_markup=_reply_keyboard(),
        )
        return

    await update.message.reply_text("📊 Kunlik hisobot tayyorlanmoqda...")

    from pro_lms.lms_for_dbr.bot.notifications import send_daily_digest
    send_daily_digest()

    await update.message.reply_text(
        "✅ Kunlik hisobot yuborildi!",
        reply_markup=_reply_keyboard(),
    )


async def handle_reply_button(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Reply keyboard tugmalari bosilganda ishlaydigan handler"""
    text = (update.message.text or "").strip()

    if text == "📊 Kunlik hisobot":
        # digest_command bilan bir xil logika
        chat_id = str(update.effective_chat.id)

        settings = frappe.get_single("LMS Bot Settings")
        is_admin = any(
            a.chat_id == chat_id and a.is_active
            for a in settings.admins
        )
        if not is_admin:
            await update.message.reply_text(
                "Siz admin sifatida ro'yxatdan o'tmagansiz.\n"
                "Avval /start bosing.",
                reply_markup=_reply_keyboard(),
            )
            return

        await update.message.reply_text("📊 Kunlik hisobot tayyorlanmoqda...")

        from pro_lms.lms_for_dbr.bot.notifications import send_daily_digest
        send_daily_digest()

        await update.message.reply_text(
            "✅ Kunlik hisobot yuborildi!",
            reply_markup=_reply_keyboard(),
        )
