import frappe


def on_login_redirect(login_manager):
    """Login dan keyin LMS Student ni /app/lms-dashboard ga yo'naltirish."""
    if frappe.session.user == "Guest":
        return

    roles = frappe.get_roles(frappe.session.user)

    if "LMS Student" in roles and "System Manager" not in roles:
        frappe.local.response["home_page"] = "/app/lms-dashboard"


def set_lms_default_route(bootinfo):
    """Desk yuklangandan keyin default route ni o'rnatish (backup)."""
    if frappe.session.user == "Guest":
        return

    roles = frappe.get_roles(frappe.session.user)

    if "LMS Student" in roles and "System Manager" not in roles:
        bootinfo.user.default_route = "lms-dashboard"
