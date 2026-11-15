# AGENTS.md

Guidance for AI agents (and humans) working in this repository.

## What this is

**Tally** is a personal finance tracker that runs as a local web app: record income and
expenses, set monthly budgets per category, and see balance, cash flow and spending on a
dashboard. It has **zero npm dependencies** and no build step.

## Run, test, verify

| Task | Command |
|---|---|
| Start the app | `npm start` → http://127.0.0.1:4310 |
| Start with auto-restart | `npm run dev` |
| Run the API tests | `npm test` |

Requires Node.js 22.13 or newer (uses the built-in `node:sqlite`).

Environment variables: `PORT` (default `4310`), `HOST` (default `127.0.0.1`), `TALLY_DB`
(database path, default `data/tally.db`), `TALLY_NO_SEED=1` (start empty, without demo data).

To start over with fresh demo data, stop the server and delete the `data/` folder.

## Layout

```
server.js            HTTP server, JSON API, SQLite schema, demo seed, static file serving
public/index.html    App shell, the two dialogs (transaction, settings)
public/app.js        Front end: routing, views, SVG charts, dialogs (vanilla ES module)
public/icons.js      Category icon set (hand-drawn SVG line icons) and the picker's key list
public/i18n.js       Interface language: English dictionary, t()/tn()/th(), dates, server-error mapping
public/i18n-km.js    Khmer dictionary (same keys as English)
public/fonts/        Kantumruy Pro, Khmer subset (Google Fonts, SIL OFL), served locally
public/styles.css    Design tokens (light + dark) and all styling
test/api.test.js     End-to-end API tests (node:test, in-memory database)
test/i18n.test.js    Every translation has the same keys and {placeholders} as English
docs/screenshots/    Reference screenshots of each page
data/                SQLite database, created on first run (git-ignored)
```

## API

All bodies are JSON. Errors come back as `{ "error": "message" }` with a 4xx/5xx status.

| Method & path | Purpose |
|---|---|
| `GET /api/meta` | Categories (`{expense:[{name,icon,locked}], income:[…]}`), currencies, settings, months with data, today's date |
| `GET /api/categories` | Same lists, plus a transaction `count` per category |
| `POST /api/categories` | Create `{ name, type, icon }`; `409` if the name exists (case-insensitive, across both types) |
| `PUT /api/categories/:name` | Change `{ name?, icon? }`; a rename carries its transactions and budget along |
| `DELETE /api/categories/:name?moveTo=` | Delete; if transactions use it, `moveTo` (same type) is required, else `409` |
| `GET /api/summary?month=YYYY-MM` | Everything the Overview and Budgets pages show |
| `GET /api/transactions?month=&type=&category=&q=` | Filtered list (max 500) with totals |
| `POST /api/transactions` | Create `{ date, type, category, note, amount }` |
| `PUT /api/transactions/:id` | Replace a transaction |
| `DELETE /api/transactions/:id` | Delete; returns the deleted row (the UI uses it for undo) |
| `PUT /api/budgets/:category` | Set `{ limit }`; `0` removes the budget |
| `PUT /api/settings` | Set `{ currency, openingBalance }` |
| `GET /api/export.csv` | Download all transactions as CSV |

## Conventions to keep

- **Money is integer minor units (cents) everywhere** — database, API and front-end state.
  Convert only at the edges: `money()` in `app.js` for display, `Math.round(x * 100)` when
  reading a form input. Never store or send floats.
- **Dates are local `YYYY-MM-DD` strings**, months are `YYYY-MM`. Don't use `toISOString()`
  for dates; it shifts to UTC and produces off-by-one days.
- **Categories live in the `categories` table** and users manage them in the UI. The client
  reads them from `/api/meta`; nothing in `app.js` hard-codes a category name. `DEFAULT_CATEGORIES`
  in `server.js` only seeds an empty table (this is also how pre-existing databases upgrade).
  Transactions and budgets reference a category **by name**, so a rename must update them in the
  same DB transaction (the `PUT` handler does). `Other` / `Other income` are protected: they can't
  be renamed or deleted, so deleting a category always has somewhere to move its transactions.
- **Category icons are SVG, never emoji.** Add one by adding a key to `ICONS` in `public/icons.js`
  (stroke-only, 24×24 grid, `currentColor`); the picker lists whatever is there. The server stores
  just the key and the client falls back to a generic icon for an unknown key.
- **Validate on the server.** `parseTxn()` is the single gate for transaction input; the
  client-side checks are only for friendlier messages.
- **No UI text in `app.js` or `index.html`.** Add a key to `EN` in `public/i18n.js` and the same key
  to `public/i18n-km.js` (Khmer must read naturally; `npm test` fails if a key or `{placeholder}` is
  missing). Use `t()` for text, `tn()` for counts, `th()` only when a parameter carries markup;
  static HTML uses `data-i18n` / `data-i18n-attr`. Format dates with `fmtDate()`, never
  `toLocaleDateString`: browsers ship no Khmer locale data. The language is a per-device choice in
  Settings (localStorage `tally-lang`), not a server setting. Built-in category names are translated
  at display time with `catName()`; stored names stay English.
- **Escape everything rendered into HTML** with `esc()` in `app.js`. Views are built from
  template strings, so unescaped user text (descriptions) would be an XSS hole.
- **No dependencies, no build step.** Charts are hand-written SVG in `app.js`. Don't add a
  framework, bundler or chart library without being asked.
- **Colours come from CSS tokens** in `:root` in `styles.css`. Dark values are declared
  twice (OS media query and `[data-theme="dark"]`); change both together. Chart text uses
  ink tokens, never a series colour. `--series-1` is income/balance, `--series-2` is expenses.
- The server binds to `127.0.0.1` and has **no authentication**. It is a single-user local
  app; don't expose it on a network without adding auth first.

## Before finishing a change

1. `npm test` passes; add a test in `test/api.test.js` for any API behaviour you change.
2. Load the affected page in a browser in both light and dark theme, and at a narrow width
   (the layout collapses below 1020px and again below 760px).
3. If the UI changed visibly, refresh the images in `docs/screenshots/`, for example:
   `chrome --headless=new --window-size=1440,1340 --virtual-time-budget=5000 --screenshot=docs/screenshots/overview.png http://127.0.0.1:4310/`
   (routes: `/`, `/#/transactions`, `/#/budgets`; add `--force-dark-mode` for dark).


I might request you either in khmer or english, but you must response and explain me in khmer ensure it's easy to understand and natural as a daily native speaker. You can completely think and work in English, I ask for khmer only for final result that you want me to read or ask my action. Make the response concise no need to overly explain, also if possible screenshot the result to me, so I can open pr faster with less friction.
