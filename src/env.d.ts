/// <reference types="astro/client" />

declare namespace App {
	interface Locals {
		/** Set by src/middleware.ts on pages and endpoints that run on the server. */
		user: import('./server/sessions.ts').SessionUser | null;
	}
}
