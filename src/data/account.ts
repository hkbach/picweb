import { photos } from './photos';

// Placeholder account data. Replace with the signed-in user's real profile and lists (API) when available.
export const user = {
	firstName: 'Demo',
	lastName: 'User',
	email: 'demo@example.com',
};

export const fullName = `${user.firstName} ${user.lastName}`;

export const likedPhotos = photos.filter((_, i) => i % 5 === 0).slice(0, 14);
export const favoritePhotos = photos.filter((_, i) => i % 7 === 3).slice(0, 10);
