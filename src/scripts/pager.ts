import '../styles/pager.css';

// One pagination bar for every list in the admin and account pages: "Rows per page" (5, 10 or 20), "Showing 1–10 of 57",
// Previous / Next and "Page 2 of 6". The choice of rows per page is remembered in this browser and shared by all lists.
// The lists are loaded whole and cut into pages here in the page, which suits the sizes they have (hundreds, not millions).

export const PAGE_SIZES = [5, 10, 20] as const;
export const DEFAULT_PAGE_SIZE = 10;
const KEY = 'picweb_page_size';

export const readPageSize = (): number => {
	try {
		const n = Number(localStorage.getItem(KEY));
		return (PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
	} catch {
		return DEFAULT_PAGE_SIZE;
	}
};

export const savePageSize = (size: number) => {
	try {
		localStorage.setItem(KEY, String(size));
	} catch {
		// storage blocked: the choice simply is not remembered
	}
};

export interface Pager {
	readonly page: number;
	readonly size: number;
	readonly total: number;
	readonly pages: number;
	/** Index of the first item of this page, and of the first item after it (for `slice`). */
	readonly start: number;
	readonly end: number;
	/** Set how many items there are in all. The current page is kept, or moved back if it no longer exists. */
	setTotal(total: number): void;
	goTo(page: number): void;
	/** Show the page that contains the item at this index. */
	goToIndex(index: number): void;
	slice<T>(items: T[]): T[];
	/** Show only this page of `eligible` (items a filter lets through); `all` also clears the others. */
	applyTo(eligible: HTMLElement[], all?: HTMLElement[]): void;
}

let counter = 0;

/**
 * Builds the bar inside `mount`. `onChange` runs when the person changes the page or the rows per page (not when the code
 * calls setTotal or goTo): draw the page again there. `label` names the list for screen readers ("Albums").
 */
export function createPager(mount: HTMLElement, onChange: () => void, label: string): Pager {
	const id = `pager-size-${++counter}`;
	let size = readPageSize();
	let page = 1;
	let total = 0;

	mount.classList.add('pg-mount');
	mount.innerHTML = '';
	const nav = document.createElement('nav');
	nav.className = 'pg';
	nav.setAttribute('aria-label', `${label} pagination`);

	const sizeBox = document.createElement('div');
	sizeBox.className = 'pg-size';
	const sizeLabel = document.createElement('label');
	sizeLabel.htmlFor = id;
	sizeLabel.textContent = 'Rows per page';
	const select = document.createElement('select');
	select.id = id;
	for (const n of PAGE_SIZES) {
		const option = document.createElement('option');
		option.value = String(n);
		option.textContent = String(n);
		select.append(option);
	}
	sizeBox.append(sizeLabel, select);

	const info = document.createElement('p');
	info.className = 'pg-info';
	info.setAttribute('aria-live', 'polite');

	const controls = document.createElement('div');
	controls.className = 'pg-nav';
	const prev = document.createElement('button');
	prev.type = 'button';
	prev.className = 'pg-btn';
	prev.textContent = 'Previous';
	const pageLabel = document.createElement('span');
	pageLabel.className = 'pg-label';
	const next = document.createElement('button');
	next.type = 'button';
	next.className = 'pg-btn';
	next.textContent = 'Next';
	controls.append(prev, pageLabel, next);
	nav.append(sizeBox, info, controls);
	mount.append(nav);

	const pages = () => Math.max(1, Math.ceil(total / size));
	const draw = () => {
		page = Math.min(Math.max(page, 1), pages());
		select.value = String(size);
		const start = (page - 1) * size;
		info.textContent = total === 0 ? '' : `Showing ${start + 1}–${Math.min(start + size, total)} of ${total}`;
		pageLabel.textContent = `Page ${page} of ${pages()}`;
		prev.disabled = page <= 1;
		next.disabled = page >= pages();
		mount.hidden = total === 0;
	};

	// A disabled button cannot keep keyboard focus: pass it to the other one.
	const changed = (clicked: HTMLButtonElement, other: HTMLButtonElement) => {
		draw();
		onChange();
		if (clicked.disabled) other.focus();
	};
	prev.addEventListener('click', () => {
		page--;
		changed(prev, next);
	});
	next.addEventListener('click', () => {
		page++;
		changed(next, prev);
	});
	select.addEventListener('change', () => {
		const first = (page - 1) * size; // stay on the page that holds the same first item
		size = Number(select.value);
		savePageSize(size);
		page = Math.floor(first / size) + 1;
		draw();
		onChange();
	});

	draw();
	return {
		get page() {
			return page;
		},
		get size() {
			return size;
		},
		get total() {
			return total;
		},
		get pages() {
			return pages();
		},
		get start() {
			return (page - 1) * size;
		},
		get end() {
			return Math.min(page * size, total);
		},
		setTotal(n) {
			total = n;
			draw();
		},
		goTo(n) {
			page = n;
			draw();
		},
		goToIndex(index) {
			page = Math.floor(Math.max(0, index) / size) + 1;
			draw();
		},
		slice: (items) => items.slice((page - 1) * size, page * size),
		applyTo(eligible, all) {
			for (const el of all ?? eligible) el.toggleAttribute('data-off-page', false);
			const start = (page - 1) * size;
			eligible.forEach((el, i) => el.toggleAttribute('data-off-page', i < start || i >= start + size));
		},
	};
}

/**
 * Paginates elements that are already in the page (table rows, list items). `getAll` returns them all in display order;
 * those a filter hid with the `hidden` attribute are left out of the pages. Call `refresh()` whenever the elements, their
 * order or a filter changed (`refresh(true)` also goes back to the first page).
 */
export function paginateElements(mount: HTMLElement, getAll: () => HTMLElement[], label: string) {
	const apply = () => {
		const all = getAll();
		const eligible = all.filter((el) => !el.hidden);
		pager.setTotal(eligible.length);
		pager.applyTo(eligible, all);
	};
	const pager = createPager(mount, apply, label);
	apply();
	return {
		pager,
		refresh(first = false) {
			if (first) pager.goTo(1);
			apply();
		},
	};
}
