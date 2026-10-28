import { photos, type Photo } from './photos.ts';
import { categories } from './categories.ts';

/** How an album was created: from online image links (Crawling) or files from a device (Uploaded). */
export type AlbumType = 'crawling' | 'uploaded';

export const albumTypeLabels: Record<AlbumType, string> = {
	crawling: 'Crawling',
	uploaded: 'Uploaded',
};

export interface Album {
	id: number;
	title: string;
	type: AlbumType;
	categoryIds: string[];
	cover: Photo;
	photos: Photo[];
}

// Placeholder data built from the sample photos (see ALBUM_SIZE in photos.ts). The Type values are
// invented for display only; a real album service must store the type when the album is created.
const groups = new Map<number, Photo[]>();
for (const photo of photos) groups.set(photo.album, [...(groups.get(photo.album) ?? []), photo]);

export const albums: Album[] = Array.from(groups, ([id, items]) => ({
	id,
	title: `Album ${id}`,
	type: id % 3 === 0 ? 'uploaded' : 'crawling',
	// Also invented for display: each album gets one category, cycling through the list.
	categoryIds: [categories[(id - 1) % categories.length].id],
	cover: items[0],
	photos: items,
}));
