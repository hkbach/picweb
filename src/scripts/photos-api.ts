// Calls to the server's downloaded-photos folder (see src/pages/api/admin/photos).

export interface StoredPhoto {
	name: string;
	bytes: number;
	type: string;
	/** When the file was written, as an ISO date. */
	modified: string;
}

export interface PhotoListing {
	folder: string;
	/** The most photos the folder may hold. */
	maxFiles: number;
	/** Files in the folder that this site did not put there; they are never listed or deleted. */
	others: number;
	photos: StoredPhoto[];
}

/** Everything the folder holds, newest first. Throws an Error with a message fit to show. */
export async function listDownloadedPhotos(): Promise<PhotoListing> {
	let response: Response;
	try {
		response = await fetch('/api/admin/photos', { cache: 'no-store' });
	} catch {
		throw new Error('Could not reach the server.');
	}
	if (!response.ok) {
		const data = await response.json().catch(() => null);
		throw new Error(data?.error ?? `The list could not be loaded (${response.status}).`);
	}
	return response.json();
}

export interface DeleteReport {
	deleted: string[];
	failed: string[];
}

/**
 * Deletes photos the Crawling page downloaded, a few at a time. A photo that is already gone counts as
 * deleted. Only the names given are touched: there is deliberately no "delete everything" request.
 */
export async function deleteDownloadedPhotos(names: string[], concurrency = 6): Promise<DeleteReport> {
	const report: DeleteReport = { deleted: [], failed: [] };
	let next = 0;
	const worker = async () => {
		while (next < names.length) {
			const name = names[next++];
			try {
				const response = await fetch(`/api/admin/photos/${encodeURIComponent(name)}`, { method: 'DELETE' });
				(response.ok ? report.deleted : report.failed).push(name);
			} catch {
				report.failed.push(name);
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, names.length) }, worker));
	return report;
}
