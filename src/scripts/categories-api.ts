// Category service calls. No backend or database exists yet, so nothing here can really store the
// list. Replace the body of saveCategories with a request to the real service; the Categories admin
// page already handles each result below.
export interface CategoryInput {
	id: string;
	name: string;
}

export type CategoriesResult = { ok: true } | { ok: false; reason: 'not-configured' | 'error' };

/** Saves the whole list. The array order is the order shown in the Homepage navigation bar. */
export async function saveCategories(_categories: CategoryInput[]): Promise<CategoriesResult> {
	return { ok: false, reason: 'not-configured' };
}
