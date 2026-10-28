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
| `STORAGE_DRIVER` | Where uploaded pictures are kept. Unset = nothing is stored and the upload endpoints answer 501. `local` = `DATA_DIR/uploads`, served from `/api/media/` (development, or a single server). A cloud driver (S3, Azure Blob, ...) is added in `src/server/storage.ts`. |
| `CRAWLER_CHROMIUM_SANDBOX=false` | Runs the crawler's browser without the Chromium sandbox, for hosts that cannot run it. A known risk: leave it unset everywhere else. |

How access works:

- Visitors can register and sign in (email and password; passwords are stored as scrypt hashes). Sessions are random tokens in an HttpOnly cookie, kept server-side only as a SHA-256, and last 7 days.
- `/account/*` needs a signed-in user. `/admin/*` and every `/api/admin/*` endpoint need an administrator. An administrator is only made with `create-admin`.
- Login attempts and sign-ups are rate limited **in memory, per server process**. Behind a reverse proxy every visitor can look like one address: configure the proxy to pass the real client address, or move the limiter to a shared store.
- Use HTTPS in production (the session cookie is `Secure` there).
- Not done yet: Google / X / Facebook login (the buttons are display only), an email telling a user that an administrator changed their password, and a cloud storage driver.

The crawler's browser sends all its traffic through a local proxy (`crawler/egress-proxy.ts`). The proxy refuses connections to private and reserved addresses.

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
