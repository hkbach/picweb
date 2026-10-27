// The album being edited, embedded in the page by AlbumForms.astro (absent when creating).
export interface InitialAlbumData {
	id: number;
	type: 'crawling' | 'uploaded';
	title: string;
	categoryIds: string[];
	coverIndex: number;
	photos: Array<{ url: string; alt: string }>;
}

export function readInitialAlbum(): InitialAlbumData | null {
	try {
		const raw = document.querySelector('#album-initial')?.textContent;
		return raw ? (JSON.parse(raw) as InitialAlbumData) : null;
	} catch {
		return null;
	}
}
