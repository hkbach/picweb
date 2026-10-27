// Helpers for reading the CategoryPicker component from a form.

/** Ids of the categories ticked in the form's picker, in list order. */
export function selectedCategoryIds(form: HTMLElement): string[] {
	return Array.from(form.querySelectorAll<HTMLInputElement>('[data-picker] input[type="checkbox"]:checked')).map((box) => box.value);
}

/** False when no categories exist yet, in which case none can be required. */
export function hasCategoryOptions(form: HTMLElement): boolean {
	return form.querySelector('[data-picker] input[type="checkbox"]') !== null;
}

/** Moves focus to the picker's button and shows `message` under it. */
export function flagPicker(form: HTMLElement, message: string) {
	const picker = form.querySelector<HTMLElement>('[data-picker]');
	picker?.querySelector<HTMLElement>('[data-error]')!.replaceChildren(document.createTextNode(message));
	picker?.querySelector<HTMLElement>('[data-trigger]')?.focus();
}
