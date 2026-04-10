// LMS Student'lar uchun: login qilganda yoki Desk'ga birinchi marta
// kirganda avtomatik ravishda LMS Dashboard sahifasini ochish.
//
// MUHIM: refresh'da redirect QILMASLIK kerak. Foydalanuvchi qaysi
// sahifada bo'lsa (player, doctype, list, ...), refresh'dan keyin
// o'sha sahifada qolishi shart.
//
// Buning uchun sessionStorage flag ishlatamiz:
//   - sessionStorage tab ichida refresh'dan omon qoladi → refresh'da
//     flag mavjud → redirect qilinmaydi.
//   - Yangi login / yangi tab / logout-login → flag yo'q → bir martalik
//     redirect ishga tushadi va flag o'rnatiladi.
//   - Flag kalitiga foydalanuvchi nomi qo'shilgan, shu sabab boshqa
//     foydalanuvchi shu tab'ga login qilsa, qaytadan redirect qilinadi.

(function () {
    function _is_lms_student() {
        return (
            frappe.user_roles &&
            frappe.user_roles.includes("LMS Student") &&
            !frappe.user_roles.includes("System Manager") &&
            !frappe.user_roles.includes("Administrator")
        );
    }

    function _flag_key() {
        const user = (frappe.session && frappe.session.user) || "guest";
        return "lms_dashboard_redirected__" + user;
    }

    function _already_redirected_this_session() {
        try {
            return sessionStorage.getItem(_flag_key()) === "1";
        } catch (e) {
            return false;
        }
    }

    function _mark_redirected() {
        try {
            sessionStorage.setItem(_flag_key(), "1");
        } catch (e) {
            // silent
        }
    }

    const _original_app_set_route = frappe.Application.prototype.set_route;

    frappe.Application.prototype.set_route = function () {
        if (!_is_lms_student()) {
            return _original_app_set_route.apply(this, arguments);
        }

        // Shu sessiyada allaqachon redirect qilingan bo'lsa — aralashmaymiz.
        // Foydalanuvchi qaysi sahifani ochgan/refresh qilgan bo'lsa, o'sha
        // sahifaga normal yo'l bilan o'tsin.
        if (_already_redirected_this_session()) {
            return _original_app_set_route.apply(this, arguments);
        }

        const route = frappe.get_route ? frappe.get_route() : null;
        const current = route ? route.join("/") : "";

        // Faqat "bo'sh" / boot vaqti chaqiriqlarda redirect qilamiz.
        // Agar foydalanuvchi allaqachon biror aniq sahifada bo'lsa
        // (player, doctype, list, ...) — uni o'z holiga qoldiramiz va
        // flag'ni o'rnatamiz, ortiq redirect bo'lmasin.
        const is_initial_load =
            !current ||
            current === "" ||
            current === "home" ||
            current === "Workspaces" ||
            current === "pages" ||
            current.startsWith("Workspaces/");

        if (!is_initial_load) {
            _mark_redirected();
            return _original_app_set_route.apply(this, arguments);
        }

        // Birinchi marta — dashboard'ga yo'naltiramiz va flag qo'yamiz.
        _mark_redirected();
        frappe.set_route("lms-dashboard");
    };
})();
