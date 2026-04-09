const _original_app_set_route = frappe.Application.prototype.set_route;

frappe.Application.prototype.set_route = function () {
    if (
        frappe.user_roles &&
        frappe.user_roles.includes("LMS Student") &&
        !frappe.user_roles.includes("System Manager") &&
        !frappe.user_roles.includes("Administrator")
    ) {
        // Router hali tayyor emas bo'lishi mumkin — null check
        const route = frappe.get_route ? frappe.get_route() : null;
        const current = route ? route.join("/") : "";

        const is_initial_load =
            !current ||
            current === "" ||
            current === "home" ||
            current === "Workspaces" ||
            current === "pages" ||
            current.startsWith("Workspaces/");

        if (is_initial_load) {
            try {
                Object.keys(localStorage)
                    .filter(
                        (k) =>
                            k.includes("last_route") ||
                            k.includes("last_visited")
                    )
                    .forEach((k) => localStorage.removeItem(k));
            } catch (e) {
                // silent
            }

            frappe.set_route("lms-dashboard");
            return;
        }
    }

    return _original_app_set_route.call(this);
};

$(window).on("beforeunload", function () {
    if (
        frappe.user_roles &&
        frappe.user_roles.includes("LMS Student") &&
        !frappe.user_roles.includes("System Manager")
    ) {
        try {
            Object.keys(localStorage)
                .filter(
                    (k) =>
                        k.includes("last_route") ||
                        k.includes("last_visited")
                )
                .forEach((k) => localStorage.setItem(k, "lms-dashboard"));
        } catch (e) {
            // silent
        }
    }
});
