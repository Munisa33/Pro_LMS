# Copyright (c) 2026, Munisa and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class LMSSection(Document):
	def before_insert(self):
		if not self.order_index:
			self.order_index = self._next_order_index()

	def _next_order_index(self):
		if not self.course:
			return 1
		result = frappe.db.sql(
			"SELECT COALESCE(MAX(order_index), 0) FROM `tabLMS Section` WHERE course = %s",
			self.course,
		)
		return (result[0][0] or 0) + 1
