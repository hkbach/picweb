# Astro Starter Kit: Minimal

```sh
npm create astro@latest -- --template minimal
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
├── src/
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## Accounts, data and settings

Everything the site stores is in one SQLite file, `data/picweb.db` (folder set by `DATA_DIR`, default `./data` next to where the server starts). It holds the accounts, so **back that folder up** and keep it out of git (it is in `.gitignore`).

Set up a new database:

```sh
npm run create-admin -- admin@example.com "First" "Last"   # asks for the password at a hidden prompt
npm run seed:demo                                          # development only: made-up albums, users, categories
```

| Variable | Effect |
| :--- | :--- |
| `DATA_DIR` | Where the database (and, with the local storage driver, `uploads/`) live. |
| `ADMIN_PASSWORD` | Lets `create-admin` run without a prompt (automated setups only). |
| `CRAWL_API_ENABLED=true` | Turns on the Crawling / Download / Downloaded-photos endpoints outside `astro dev` (off by default). |
| `ADMIN_ALLOWED_HOSTS` | Comma-separated host names the admin endpoints answer to, for example `admin.example.com`. Outside `astro dev`, every admin endpoint refuses requests while this is unset. |
| `SITE_URL` | The public address of the site, for example `https://picweb.example.com`. Used for canonical links, Open Graph addresses, `robots.txt` and `sitemap.xml`. **Set it in production**: it is deliberately not taken from the request there (a Host header can be forged), so without it those pages carry no canonical address and `/sitemap.xml` answers 404. Under `astro dev` the request's own address is used. |
| `STORAGE_DRIVER` | Where uploaded pictures are kept. Unset = nothing is stored and the upload endpoints answer 501. `r2` = Cloudflare R2 (also needs `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`; step by step in [docs/HUONG-DAN-CLOUDFLARE.md](docs/HUONG-DAN-CLOUDFLARE.md), and `npm run check-storage` tests it in plain words). `local` = `DATA_DIR/uploads`, served from `/api/media/` (development, or a single server). Another cloud is added in `src/server/storage.ts`. |
| `.env` file | Every setting in this table can be written in a file named `.env` in the folder the server starts from (`NAME=value`, one per line) instead of being set by hand. A value set in the real environment wins. The file holds secrets (the Cloudflare keys): it is in `.gitignore`, never commit it or send it anywhere. |
| `CRAWLER_CHROMIUM_SANDBOX=false` | Runs the crawler's browser without the Chromium sandbox, for hosts that cannot run it. A known risk: leave it unset everywhere else. |

How access works:

- Visitors can register and sign in (email and password; passwords are stored as scrypt hashes). Sessions are random tokens in an HttpOnly cookie, kept server-side only as a SHA-256, and last 7 days.
- `/account/*` needs a signed-in user. `/admin/*` and every `/api/admin/*` endpoint need an administrator. An administrator is only made with `create-admin`.
- Login attempts and sign-ups are rate limited **in memory, per server process**. Behind a reverse proxy every visitor can look like one address: configure the proxy to pass the real client address, or move the limiter to a shared store.
- Use HTTPS in production (the session cookie is `Secure` there).
- Not done yet: Google / X / Facebook login (the buttons are display only), an email telling a user that an administrator changed their password, and a cloud storage driver.

The Homepage lists one cover per album, **the most recently created album first** (inside a category too). On touch screens, pressing and holding a public picture does not offer "Save image" for anyone, signed in or not (the browser's menu event is cancelled, the picture ignores touches so the press lands on its link, and iOS's callout and dragging are switched off); this only stops casual saving, not screenshots. Visitors who are not signed in also lose the right-click menu on desktop.

Admin → Albums shows each album's **status** and when it was created (in the viewer's own time zone). An album can be **deactivated** and activated again with one click: a deactivated album disappears from the whole public site (Homepage, album popup, sitemap, and the Liked and Favorites pages of visitors; its photos cannot be liked) but keeps all its data, and the administrator still sees and edits it. Pictures kept on Cloudflare stay reachable at their own addresses for anyone who already has them; deactivating hides the album, it does not protect those addresses. The **Delete** button works only on a deactivated album (the server refuses otherwise). Deleting asks first, then removes the album for good: its photos, categories, crawl history and every like and favorite of its photos, and also the pictures it kept on Cloudflare R2, except any that another album still uses. If Cloudflare cannot be reached or refuses, the album is still deleted and the page lists the picture names that remain in the bucket so they can be removed by hand.

Every album made from a crawl keeps its **crawl history**: each address that was crawled for it, exactly as typed in the Crawling page, where it led (a Facebook share link becomes the post), its title and when. It is shown at the top of the album's Edit page as a record (editing the album does not change it) and is stored in the `album_sources` table for later tracking. The database upgrades itself when the server starts, so back up `data/` before updating.

The Edit page of a **Crawling** album has a **Convert to Uploaded** button (disabled when photo storage is not configured). After a confirmation it downloads every picture from its link (same safety checks as the Crawling download: private addresses refused, size and time limits, content checked), stores it in the photo storage and creates a **new Uploaded album** that copies the old one: title, categories, cover, order, descriptions, sizes, crawl history, creation date (so it keeps its place on the Homepage) and active/deactivated state. Only when the copy is complete is the old album **deactivated** (not deleted); the two remember each other in `albums.converted_from` / `converted_to`, and an album can be converted once. It is all or nothing: if any picture fails, or the page is closed or Cancel is pressed, nothing is created, nothing stays in storage and the old album is unchanged. Likes and favorites stay with the old album and are not copied. Progress is streamed to the page (`POST /api/admin/albums/:id/convert`, newline-delimited JSON); a proxy that buffers responses may delay the progress bar but not the result. At most 50 pictures, three at a time, 15 minutes overall.

Admin → Crawling keeps the list of images between crawls: a new crawl **adds** its images to the list (an image already listed, by address or, for Facebook, by picture file, is skipped) and "Clear list" empties it. The album made from the list is named after the first page crawled into it.

Admin → Crawling can crawl **Web** (any page) or **Facebook** (one public post, pasted as a link such as `https://www.facebook.com/share/p/...`). For Facebook the crawler closes the "Log in" suggestion, clicks a photo to open Facebook's photo viewer and presses "Next photo" through the post's photos (at most 50, one at a time with a short pause); the viewer shows each at a much larger size (about 1500 px) than the post page (about 590 px). A picture seen more than once is kept once. It never signs in and sends no cookie or account detail, so private posts and groups cannot be read, and it stops, keeping what it has, if Facebook asks for a login. The browser asks for English because the viewer is found by its English button names. Both ways of making an album work for Facebook pictures: "Create album from these images" keeps only the links (no download), but Facebook's picture addresses are signed and stop working at a time written in the address itself (a few days after crawling); the Crawling page shows that date, asks before creating, and Admin → Albums marks the album with it ("Facebook links expire 1 Nov 2026", or "expired"), after which its pictures show as broken. "Download and create new album" keeps copies and does not expire. Facebook's terms limit automated collection and the pictures belong to their authors: only use posts you have the right to use. Command line: `npm run crawl -- <url> --facebook`.

The crawler's browser sends all its traffic through a local proxy (`crawler/egress-proxy.ts`). The proxy refuses connections to private and reserved addresses.

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
