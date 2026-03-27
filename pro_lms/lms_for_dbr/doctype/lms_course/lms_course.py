# Copyright (c) 2026, Munisa and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class LMSCourse(Document):
	def before_insert(self):
		if not self.order_index:
			self.order_index = self._next_order_index()

	def _next_order_index(self):
		if self.program:
			result = frappe.db.sql(
				"SELECT COALESCE(MAX(order_index), 0) FROM `tabLMS Course` WHERE program = %s",
				self.program,
			)
		else:
			result = frappe.db.sql(
				"SELECT COALESCE(MAX(order_index), 0) FROM `tabLMS Course`"
				" WHERE program IS NULL OR program = ''"
			)
		return (result[0][0] or 0) + 1
