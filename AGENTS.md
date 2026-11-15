# AGENTS.md

Guidance for AI agents (and humans) working in this repository.

## What this is

**Tally** is a personal finance tracker web app: record income and expenses, set monthly
budgets per category, and see balance, cash flow and spending on a dashboard. Data lives in
**Supabase Postgres**; every user signs in with email + password and sees only their own data
(Row Level Security). It still has **zero npm dependencies** and no build step: the Node server
talks to Supabase PostgREST and Auth with Node's built-in `fetch`.

## Run, test, verify

| Task | Command |
|---|---|
| Start the app | `npm start` → http://127.0.0.1:4310 |
| Start with auto-restart | `npm run dev` |
| Run the API tests | `npm test` (offline: uses the in-memory store, no network) |
| Add demo data to an account | `npm run seed-demo` (env `DEMO_EMAIL`, `DEMO_PASSWORD`; signs in as that user and adds demo data if the account has no transactions) |

Requires Node.js 22.13 or newer (for `fetch` and `process.loadEnvFile`; `node:sqlite` is no longer used).

Setup: copy `.env.example` to `.env` (git-ignored) and set `SUPABASE_URL` and `SUPABASE_ANON_KEY`
(the publishable key).

Other environment variables: `PORT` (default `4310`), `HOST` (default `127.0.0.1`),
`TALLY_STORE=memory` (run offline with an in-memory store and a seeded demo account
`demo@tally.app`, password from `TALLY_DEMO_PASSWORD` or the default `tally-demo-offline`),
`TALLY_NO_SEED=1` (skip that demo account in memory mode). Memory mode keeps nothing; a restart
starts over.

### Supabase project

Name `tally`, ref `ogmkwoqiwxxcmcytzddj`, URL https://ogmkwoqiwxxcmcytzddj.supabase.co, region
`ap-southeast-1`. The schema lives in `supabase/migrations/` and was applied with the Supabase MCP
`apply_migration` tool. Any schema change = a new migration file + apply it + run the security
advisors. Never put the service-role key in the repo, `.env.example` or the client.

Hosted Supabase requires email confirmation by default: sign-up then returns no session and the UI
shows "check your email". To let new users in immediately, turn off "Confirm email" in the
dashboard (Authentication → Sign In / Providers → Email). Supabase's built-in mailer only delivers
to project team addresses and is heavily rate limited; configure custom SMTP for real users.

## Layout

```
server.js            HTTP server, JSON API, validation, summary math, demo seed (seedDemo),
                     DEFAULT_CATEGORIES + ensureDefaults, static file serving
store/supabase.js    Storage adapter: PostgREST + Auth over fetch, forwards the user's JWT
store/memory.js      Same interface in memory, for tests and offline mode
store/errors.js      HttpError (message safe to show, with HTTP status)
scripts/seed-demo.js Signs in as DEMO_EMAIL and adds demo data to an empty account
supabase/migrations/ SQL schema, RLS policies and functions
.env.example         Template for the git-ignored .env
public/index.html    App shell, login screen, the dialogs (transaction, settings)
public/app.js        Front end: session, routing, views, SVG charts, dialogs (vanilla ES module)
public/icons.js      Category icon set (hand-drawn SVG line icons) and the picker's key list
public/i18n.js       Interface language: English dictionary, t()/tn()/th(), dates, server-error mapping
public/i18n-km.js    Khmer dictionary (same keys as English)
public/fonts/        Kantumruy Pro, Khmer subset (Google Fonts, SIL OFL), served locally
public/styles.css    Design tokens (light + dark) and all styling
test/api.test.js     End-to-end API tests (node:test, in-memory store)
test/i18n.test.js    Every translation has the same keys and {placeholders} as English
docs/screenshots/    Reference screenshots of each page
```

## API

All bodies are JSON. Errors come back as `{ "error": "message" }` with a 4xx/5xx status.
Every `/api` route except `/api/auth/*` needs `Authorization: Bearer <accessToken>` and returns
`401 { error }` without a valid one.

| Method & path | Purpose |
|---|---|
| `POST /api/auth/signup` | `{ email, password }` → `201 { session }`, or `{ confirm: true }` when email confirmation is required |
| `POST /api/auth/signin` | `{ email, password }` → session `{ accessToken, refreshToken, expiresAt (ms), email }` |
| `POST /api/auth/refresh` | `{ refreshToken }` → new session (refresh tokens are single use) |
| `POST /api/auth/signout` | Ends the session (Bearer) |
| `GET /api/meta` | Categories (`{expense:[{name,icon,locked}], income:[…]}`), currencies, settings, months with data, today's date, `user: {email}` |
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
| `GET /api/export.csv` | Download all transactions as CSV (needs the Bearer header; the UI fetches it as a blob) |

## Conventions to keep

- **Money is integer minor units (cents) everywhere** — database, API and front-end state.
  Convert only at the edges: `money()` in `app.js` for display, `Math.round(x * 100)` when
  reading a form input. Never store or send floats.
- **Dates are local `YYYY-MM-DD` strings**, months are `YYYY-MM`. Don't use `toISOString()`
  for dates; it shifts to UTC and produces off-by-one days.
- **Storage goes through the store interface** (`store/supabase.js`, `store/memory.js`). Add a
  method to BOTH stores; the memory store must mimic Postgres semantics (per-user isolation,
  rename cascades, foreign-key refusal) so `npm test` means something.
- **Security model:** the server never holds a key that bypasses RLS. Data requests forward the
  user's access token and the RLS policies (`(select auth.uid()) = user_id`) do the enforcement.
  The server reads JWT claims without verifying the signature only for early 401s and for showing
  the email; PostgREST verifies every token. Tables revoke `anon`; SQL functions are
  `SECURITY INVOKER` with `set search_path = ''`.
- **Categories live in the `categories` table** and users manage them in the UI. The client
  reads them from `/api/meta`; nothing in `app.js` hard-codes a category name. `DEFAULT_CATEGORIES`
  in `server.js` only seeds a user's empty set: `ensureDefaults` does it lazily on that user's first
  request. Transactions and budgets reference a category **by name**; the composite foreign key
  `(user_id, category, type)` → `categories(user_id, name, type)` with `ON UPDATE CASCADE` carries a
  rename along and refuses a delete while rows still use it. Deleting with a move is one SQL function,
  `tally_delete_category`, so it is atomic. `Other` / `Other income` are protected: they can't
  be renamed or deleted, so deleting a category always has somewhere to move its transactions.
- **Category icons are SVG, never emoji.** Add one by adding a key to `ICONS` in `public/icons.js`
  (stroke-only, 24×24 grid, `currentColor`); the picker lists whatever is there. The server stores
  just the key and the client falls back to a generic icon for an unknown key.
- **Validate on the server.** `parseTxn()` is the single gate for transaction input; the
  client-side checks are only for friendlier messages.
- **Front-end session** is kept in localStorage `tally-session`. `api()` refreshes shortly before
  expiry and once on a 401, then returns to the login screen. The login screen has its own language
  switch.
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
- The app now has sign-in, but the Node server still serves **plain HTTP** (bound to `127.0.0.1`
  by default). Put it behind HTTPS before exposing it on a network.

## Before finishing a change

1. `npm test` passes; add a test in `test/api.test.js` for any API behaviour you change.
2. Load the affected page in a browser in both light and dark theme, and at a narrow width
   (the layout collapses below 1020px and again below 760px).
3. If the UI changed visibly, refresh the images in `docs/screenshots/`. Pages now require
   signing in, so take them from a signed-in browser (for example the demo account), at the same
   sizes as before: 1440×1340 for the overview pages, 1440×1000 for transactions, budgets,
   categories and login, 500×1100 for mobile. Files: `overview.png`, `overview-dark.png`,
   `overview-km.png`, `overview-mobile.png`, `transactions.png`, `budgets.png`, `categories.png`,
   `login.png`, `login-mobile-km-dark.png`. Routes: `/`, `/#/transactions`, `/#/budgets`.
4. After a schema change (new file in `supabase/migrations/`, applied to the project), run the
   Supabase security advisors and fix anything they flag.


I might request you either in khmer or english, but you must response and explain me in khmer ensure it's easy to understand and natural as a daily native speaker. You can completely think and work in English, I ask for khmer only for final result that you want me to read or ask my action. Make the response concise no need to overly explain, also if possible screenshot the result to me, so I can open pr faster with less friction.
