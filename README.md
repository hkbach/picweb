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

## Admin API settings (crawl, download, downloaded photos)

These endpoints have **no authentication yet**. Do not expose them to the internet until admin login exists.

| Variable | Effect |
| :--- | :--- |
| `CRAWL_API_ENABLED=true` | Turns the admin endpoints on outside `astro dev` (off by default). |
| `ADMIN_ALLOWED_HOSTS` | Comma-separated host names the admin endpoints answer to, for example `admin.example.com`. Outside `astro dev`, every request is refused while this is unset. Under `astro dev` only `localhost`, `127.0.0.1` and `[::1]` are accepted. |
| `CRAWLER_CHROMIUM_SANDBOX=false` | Runs the crawler's browser without the Chromium sandbox, for hosts that cannot run it (some containers). This is a known risk. Leave it unset everywhere else. |

The crawler's browser sends all its traffic through a local proxy (`crawler/egress-proxy.ts`). The proxy refuses connections to private and reserved addresses.

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
