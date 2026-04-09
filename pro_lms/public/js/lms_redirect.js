// Override desk set_route BEFORE Application starts
const _original_app_set_route = frappe.Application.prototype.set_route;

frappe.Application.prototype.set_route = function () {
    if (
        frappe.user_roles &&
        frappe.user_roles.includes("LMS Student") &&
        !frappe.user_roles.includes("System Manager") &&
        !frappe.user_roles.includes("Administrator")
    ) {
        // Hozirgi route lms-dashboard emasmi — redirect kerak
        const current = frappe.get_route_str();
        const is_initial_load =
            !current ||
            current === "" ||
            current === "home" ||
            current === "Workspaces" ||
            current.startsWith("Workspaces/");

        if (is_initial_load) {
            // Barcha last_route cache larni tozalash
            try {
                const keys_to_clean = Object.keys(localStorage).filter(
                    (k) => k.includes("last_route") || k.includes("last_visited")
                );
                keys_to_clean.forEach((k) => localStorage.removeItem(k));
            } catch (e) {
                // localStorage bloklangan
            }

            frappe.set_route("lms-dashboard");
            return;
        }
    }

    return _original_app_set_route.call(this);
};

// Sahifa yopilganda keyingi ochilish uchun last_route ni lms-dashboard qilish
$(window).on("beforeunload", function () {
    if (
        frappe.user_roles &&
        frappe.user_roles.includes("LMS Student") &&
        !frappe.user_roles.includes("System Manager")
    ) {
        try {
            Object.keys(localStorage)
                .filter((k) => k.includes("last_route") || k.includes("last_visited"))
                .forEach((k) => localStorage.setItem(k, "lms-dashboard"));
        } catch (e) {
            // silent
        }
    }
});
