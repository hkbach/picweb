// Category service calls (see src/pages/api/admin/categories.ts).
export interface CategoryInput {
	id: string;
	name: string;
}

export type CategoriesResult = { ok: true } | { ok: false; reason: 'not-configured' | 'error'; error?: string };

/** Saves the whole list. The array order is the order shown in the Homepage navigation bar. */
export async function saveCategories(categories: CategoryInput[]): Promise<CategoriesResult> {
	try {
		const response = await fetch('/api/admin/categories', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ categories }),
			credentials: 'same-origin',
		});
		if (response.ok) return { ok: true };
		const data = await response.json().catch(() => ({}));
		return { ok: false, reason: 'error', error: typeof data.error === 'string' ? data.error : undefined };
	} catch {
		return { ok: false, reason: 'error' };
	}
}
