import frappe


def set_lms_default_route(bootinfo):
    """Server-side: LMS Student uchun default route ni majburiy qilish."""
    if frappe.session.user == "Guest":
        return

    roles = frappe.get_roles(frappe.session.user)

    if "LMS Student" in roles and "System Manager" not in roles:
        bootinfo.user.default_route = "lms-dashboard"
