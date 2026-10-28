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

**Cashing out credits.** **100 credits = 1 USD** (the rate is the fifth amount in Admin → User management → Referral credits, 1–100,000 credits per USD). On **Account → Referrals** the **Claim** button is always shown, but read-only (with the reason) until the balance is worth at least 1 USD; then it reads "Claim $N". It opens a popup that asks for the user's **PayPal email address**; submitting creates a claim for as many WHOLE dollars as the balance allows (250 credits at 100 per USD: a claim of 200 credits = $2.00, and 50 stay), takes those credits out of the balance at once (a `claim` row in the ledger) and lists the claim under "Your claims" with the status **Processing**. The amount is worked out on the server, the rate is stored with the claim, and two simultaneous requests cannot spend the same credits. At most 5 claims per user per hour. **Admin → Credit claims** lists every claim (newest first, with a status filter and totals): user, PayPal address, credits, amount and a status dropdown: **Processing** (new), **Paid** (the administrator sent the money by hand) and **Rejected**. Rejecting asks first, returns the claim's credits to the user once (`claim_refund`) and is final; Paid can be set back to Processing. A claim keeps the user's name and email, and survives if the account is deleted (rejecting it then refunds nobody). Money is **not** sent by this site: an administrator pays through PayPal by hand. The PayPal address is shown only to its owner and to administrators and is never written to the audit log; treat the claims table as personal data (decide how long to keep paid claims). The database upgrades itself to schema 10 when the server starts.

**Referrals and credits.** Every user has an invitation link, `https://<site>/?ref=<code>`, shown on their **Account → Referrals** page with their credit balance, how far each invited friend has got (friends are not named) and the history of credits. The page the friend lands on remembers the code in the browser (`localStorage`, key `picweb_ref`) and removes it from the address; it is sent with the sign-up (`POST /api/auth/register`, field `ref`) and then forgotten. A code that matches nobody is ignored and never blocks a sign-up. Three events give credits, and **Admin → User management → Referral credits** sets what each is worth (defaults in brackets): the user registers (**10** credits); a friend registers through the user's link (**0** for the inviter); and every **5** different albums the invited friend opens to look at the photos (**1** credit for the inviter, both numbers configurable, whole numbers, 0–1000 and 1–100). An album counts once per friend, only while the friend is signed in, and only active albums count; "opened" means the album popup showed one of its photos (the same signal as a photo view). Credits are rows in `credit_ledger`, a balance is their sum, and a change of amounts only affects what happens afterwards (a batch of albums reached while it paid 0 stays recorded, so raising the amount later does not pay it back). Accounts that already existed got a code and no sign-up credits, and an account an administrator creates gets no sign-up credits (only a self-registration does). The database upgrades itself to schema 9 when the server starts, so back up `data/` before updating. Known limit: nothing here stops one person from registering several accounts and opening albums with them to earn credits (there is no email verification yet); the 10 sign-ups per hour per address limit slows it only.

Admin → **Photo stats** is a table of every photo with its **views**, **likes** and **favorites** ("add to collection"), sorted by likes by default; the Views, Likes and Favorites headers sort the table (a new column starts with the most, the same column again reverses it; a tie always keeps the photo with more likes, then views, then favorites first). It shows the totals above the table, the album each photo belongs to (a link to its Edit page, marked Deactivated when it is), and draws 100 rows at a time. **A view** is counted when the album popup shows the photo (when it opens, and when the visitor moves to that photo), once per photo for each browser tab session, by `POST /api/photos/:id/view`; visitors who are not signed in count too. Only a counter per photo is kept in `photo_views` (no visitor, address or time), photos of a deactivated album are not counted, and one address may send 120 per minute. Views are a popularity figure, not a security record: a script can inflate them within that limit, and views before this feature existed are not known (they start at 0). Likes and favorites are exact counts, one per user and photo. The database upgrades itself to schema 8 when the server starts.

Admin → **Cloud photos** lists every picture the site stored in the photo storage (Cloudflare R2, or the local folder in development) as a grid like the Crawling page: a thumbnail with the file size and the size in pixels under it, when it was stored, and how many albums use it. The default order is newest upload first; a selector sorts by upload date or file size, both directions. The list is read from the bucket (at most 10,000 pictures, 60 drawn at a time with "Show more"; objects whose names this site did not give are counted but never listed or deleted). Select pictures and press Delete: for each one Cloudflare deletes the object FIRST, and only then are the album photos that use it removed (with their likes and favorites; a removed cover is replaced by the album's first photo). If Cloudflare does not delete it, the album photo stays and the page lists the picture with the reason. A picture that is the only photo of an album is kept and reported, because an album with no photo cannot be shown; the check is repeated for each picture, so a batch never empties an album. Deleting is sent 25 pictures per request, and every delete is written to the audit log. A picture a crawled album links to is not in the storage and is not listed.

Admin → Albums has a search bar above the table: **Search title** (ignores case and accents, so "ao dai" finds "Áo Dài"), **Type**, **Status** and **Created from / to** (inclusive, by the date the viewer sees in their own time zone; the same day in both boxes means that day). The filters combine, the count reads "2 of 7 albums", and "Clear filters" resets them. The **Photos** header sorts by the number of photos (click: most first, again: fewest first, again: original order). This is done in the page from the albums already loaded, with no extra request, so it suits a list of hundreds of albums rather than tens of thousands.

Admin → Albums shows each album's **status** and when it was created (in the viewer's own time zone). An album can be **deactivated** and activated again with one click: a deactivated album disappears from the whole public site (Homepage, album popup, sitemap, and the Liked and Favorites pages of visitors; its photos cannot be liked) but keeps all its data, and the administrator still sees and edits it. Pictures kept on Cloudflare stay reachable at their own addresses for anyone who already has them; deactivating hides the album, it does not protect those addresses. The **Delete** button works only on a deactivated album (the server refuses otherwise). Deleting asks first, then removes the album for good: its photos, categories, crawl history and every like and favorite of its photos, and also the pictures it kept on Cloudflare R2, except any that another album still uses. If Cloudflare cannot be reached or refuses, the album is still deleted and the page lists the picture names that remain in the bucket so they can be removed by hand.

Every album made from a crawl keeps its **crawl history**: each address that was crawled for it, exactly as typed in the Crawling page, where it led (a Facebook share link becomes the post), its title and when. It is shown at the top of the album's Edit page as a record (editing the album does not change it) and is stored in the `album_sources` table for later tracking. The database upgrades itself when the server starts, so back up `data/` before updating.

The Edit page of a **Crawling** album has a **Convert to Uploaded** button (disabled when photo storage is not configured). After a confirmation it downloads every picture from its link (same safety checks as the Crawling download: private addresses refused, size and time limits, content checked), stores it in the photo storage and creates a **new Uploaded album** that copies the old one: title, categories, cover, order, descriptions, sizes, crawl history, creation date (so it keeps its place on the Homepage) and active/deactivated state. Only when the copy is complete is the old album **deactivated** (not deleted); the two remember each other in `albums.converted_from` / `converted_to`, and an album can be converted once. It is all or nothing: if any picture fails, or the page is closed or Cancel is pressed, nothing is created, nothing stays in storage and the old album is unchanged. Likes and favorites stay with the old album and are not copied. Progress is streamed to the page (`POST /api/admin/albums/:id/convert`, newline-delimited JSON); a proxy that buffers responses may delay the progress bar but not the result. At most 50 pictures, three at a time, 15 minutes overall.

Admin → Crawling takes **up to 10 addresses at once**, one per line in the Target URLs box (blank lines are ignored, an address typed twice is crawled once; Ctrl+Enter crawls, Enter starts a new line). The same choice, Web or Facebook, applies to every line, and a wrong line is reported by its line number before anything is crawled. The page crawls them one after the other (the server still crawls one page at a time), shows "Crawling 2 of 5…", and keeps going when one address fails; afterwards it states how many were crawled and lists, under the status line, each address that could not be crawled with the reason. The limit of 10 is applied by the page, not by the server: `POST /api/admin/crawl` still takes one address per request. Reloading the page stops the remaining addresses (the one being crawled finishes on the server).

Admin → Crawling keeps the list of images between crawls: a new crawl **adds** its images to the list (an image already listed, by address or, for Facebook, by picture file, is skipped) and "Clear list" empties it. The album made from the list is named after the first page crawled into it.

Admin → Crawling can crawl **Web** (any page) or **Facebook** (one public post, pasted as a link such as `https://www.facebook.com/share/p/...`). For Facebook the crawler closes the "Log in" suggestion, clicks a photo to open Facebook's photo viewer and presses "Next photo" through the post's photos (at most 50, one at a time with a short pause); the viewer shows each at a much larger size (about 1500 px) than the post page (about 590 px). A picture seen more than once is kept once. It never signs in and sends no cookie or account detail, so private posts and groups cannot be read, and it stops, keeping what it has, if Facebook asks for a login. The browser asks for English because the viewer is found by its English button names. Both ways of making an album work for Facebook pictures: "Create album from these images" keeps only the links (no download), but Facebook's picture addresses are signed and stop working at a time written in the address itself (a few days after crawling); the Crawling page shows that date, asks before creating, and Admin → Albums marks the album with it ("Facebook links expire 1 Nov 2026", or "expired"), after which its pictures show as broken. "Download and create new album" keeps copies and does not expire. Facebook's terms limit automated collection and the pictures belong to their authors: only use posts you have the right to use. Command line: `npm run crawl -- <url> --facebook`.

The crawler's browser sends all its traffic through a local proxy (`crawler/egress-proxy.ts`). The proxy refuses connections to private and reserved addresses.

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
