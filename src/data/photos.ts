import { naturalSizes } from './natural-sizes.ts';

export interface Photo {
	id: number;
	width: number;
	height: number;
	author: string;
	alt: string;
	album: number;
}

// Placeholder data. Replace with a real source (API/CMS) when available.
const authors = ['Linh Tran', 'Minh Anh', 'Hoang Nam', 'Thu Ha', 'Quoc Bao', 'Mai Phuong'];
const sizes: Array<[number, number]> = [
	[800, 1100],
	[800, 600],
	[800, 1000],
	[800, 800],
	[800, 1200],
	[800, 650],
];

// picsum.photos has no image for these ids (checked: they return 404).
const missingIds = new Set([86, 97, 105, 138]);
const ids: number[] = [];
for (let id = 10; ids.length < 120; id++) {
	if (!missingIds.has(id)) ids.push(id);
}

// Placeholder albums: every ALBUM_SIZE consecutive photos form one album.
const ALBUM_SIZE = 8;

export const photos: Photo[] = ids.map((id, i) => {
	const [width, height] = sizes[i % sizes.length];
	return {
		id,
		width,
		height,
		author: authors[i % authors.length],
		alt: `Sample photo ${i + 1}`,
		album: Math.floor(i / ALBUM_SIZE) + 1,
	};
});

// Full, uncropped photo at the given width, keeping the image's original aspect ratio.
export const fullPhotoUrl = (p: Photo, w = 1200) => {
	const [nw, nh] = naturalSizes[p.id];
	return `https://picsum.photos/id/${p.id}/${w}/${Math.round((w * nh) / nw)}`;
};

export const photoUrl = (p: Photo, w = 800) =>
	`https://picsum.photos/id/${p.id}/${w}/${Math.round((w * p.height) / p.width)}`;
