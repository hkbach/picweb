export interface Category {
	id: string;
	name: string;
}

// Placeholder data: the categories shown in the Homepage navigation bar, in display order.
// Replace with a real source (API/CMS) when available; the Admin > Categories page edits this list.
const names = [
	'Editorial',
	'Wallpapers',
	'3D Renders',
	'Nature',
	'Textures & Patterns',
	'Architecture & Interiors',
	'Film',
	'Street Photography',
	'Experimental',
	'Travel',
	'People',
	'Animals',
	'Food & Drink',
	'Fashion & Beauty',
];

export const categories: Category[] = names.map((name) => ({
	id: name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, ''),
	name,
}));
