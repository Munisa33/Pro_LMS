# pro_lms/lms_for_dbr/bot/runner.py

import frappe
from telegram.ext import Application, CommandHandler, MessageHandler, filters
from .bot import start_command, digest_command, handle_reply_button


def run_bot():
    """Bot ni polling rejimida ishga tushirish"""

    settings = frappe.get_single("LMS Bot Settings")
    token = settings.get_password("bot_token")

    if not token:
        print("XATO: Bot token sozlanmagan. LMS Bot Settings ga token kiriting.")
        return

    app = Application.builder().token(token).build()

    # Commands
    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("digest", digest_command))

    # Reply keyboard button text handler
    app.add_handler(MessageHandler(
        filters.TEXT & ~filters.COMMAND,
        handle_reply_button,
    ))

    print("Bot ishga tushdi... To'xtatish uchun Ctrl+C")
    print("Komandalar: /start, /digest")
    print("Reply tugma: [📊 Kunlik hisobot]")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    run_bot()
