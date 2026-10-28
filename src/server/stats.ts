import { db } from './db.ts';

// Per-photo popularity for the admin "Photo stats" page: how many times the photo was opened, liked, and added to a
// collection (favorites). Counts are totals over all visitors; the tables hold one row per user and photo, so a user
// counts once per photo.

export interface PhotoStat {
	id: number;
	/** A small picture to show in the table. */
	thumb: string;
	alt: string;
	albumId: number;
	albumTitle: string;
	albumStatus: 'active' | 'deactivated';
	views: number;
	likes: number;
	favorites: number;
}

export function listPhotoStats(): PhotoStat[] {
	const rows = db()
		.prepare(
			`SELECT p.id, COALESCE(p.thumb_url, p.url) AS thumb, p.alt, a.id AS album_id, a.title, a.status,
			        COALESCE(v.views, 0) AS views,
			        (SELECT COUNT(*) FROM likes l WHERE l.photo_id = p.id) AS likes,
			        (SELECT COUNT(*) FROM favorites f WHERE f.photo_id = p.id) AS favorites
			 FROM photos p
			 JOIN albums a ON a.id = p.album_id
			 LEFT JOIN photo_views v ON v.photo_id = p.id
			 ORDER BY likes DESC, views DESC, favorites DESC, p.id`,
		)
		.all() as unknown as Array<{ id: number; thumb: string; alt: string; album_id: number; title: string; status: 'active' | 'deactivated'; views: number; likes: number; favorites: number }>;
	return rows.map((r) => ({ id: r.id, thumb: r.thumb, alt: r.alt, albumId: r.album_id, albumTitle: r.title, albumStatus: r.status, views: r.views, likes: r.likes, favorites: r.favorites }));
}
