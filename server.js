// Tally — personal finance tracker.
// Zero-dependency server: node:http for the JSON API + static files. Storage and accounts are
// Supabase (store/supabase.js), or an in-memory stand-in (store/memory.js) for tests and offline
// work. Every /api route except /api/auth/* needs `Authorization: Bearer <access token>`.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, SIGN_IN_AGAIN } from './store/errors.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');

// Starting categories as [name, icon]. Copied into a user's categories the first time they use
// the app; after that their own list is the source of truth and they manage it in the UI.
// Icon keys refer to the SVG set in public/icons.js.
export const DEFAULT_CATEGORIES = {
  expense: [['Housing', 'home'], ['Groceries', 'cart'], ['Dining', 'utensils'], ['Transport', 'car'],
    ['Utilities', 'bolt'], ['Health', 'heart'], ['Entertainment', 'ticket'], ['Shopping', 'bag'],
    ['Travel', 'plane'], ['Subscriptions', 'repeat'], ['Other', 'dots']],
  income: [['Salary', 'briefcase'], ['Freelance', 'laptop'], ['Investments', 'trend'], ['Other income', 'wallet']],
};
// One catch-all per type. It can't be renamed or deleted, so there is always somewhere to move
// transactions when their category is removed.
const FALLBACK = { expense: 'Other', income: 'Other income' };
const CURRENCIES = ['USD', 'KHR', 'EUR', 'GBP', 'JPY', 'VND', 'THB', 'AUD', 'CAD', 'SGD', 'INR'];

// ---------- date helpers (all dates are local 'YYYY-MM-DD' strings) ----------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const isMonth = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function lastDay(month) {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${pad(new Date(y, m, 0).getDate())}`;
}

// ---------- categories ----------
// A user with no categories yet (just signed up) gets the starting set.
export async function ensureDefaults(repo) {
  const existing = await repo.categories();
  if (existing.length) return existing;
  const list = ['expense', 'income'].flatMap((type) => DEFAULT_CATEGORIES[type].map(([name, icon]) => ({ name, type, icon })));
  await repo.addCategories(list);
  return repo.categories();
}

// Names are unique across both types (budgets and filters address a category by name alone).
// `counts` adds how many transactions use each one. The catch-all always sorts last.
function categoriesByType(rows, counts = null) {
  const out = { expense: [], income: [] };
  for (const r of rows) {
    const item = { name: r.name, icon: r.icon, locked: r.name === FALLBACK[r.type] };
    if (counts) item.count = counts.get(r.name) ?? 0;
    out[r.type].push(item);
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.locked - b.locked); // stable
  return out;
}

function cleanCategoryName(raw) {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!name) return { error: 'Give the category a name.' };
  if (name.length > 30) return { error: 'Name must be 30 characters or fewer.' };
  if (/[\u0000-\u001f\u007f]/.test(name)) return { error: 'Name contains characters that are not allowed.' };
  return { name };
}
// The client owns the artwork (public/icons.js) and falls back to a generic icon for a key it
// doesn't know, so the server only checks the shape of the key.
const isIconKey = (s) => typeof s === 'string' && /^[a-z0-9-]{1,24}$/.test(s);
const nameTaken = (rows, name, except) => rows.some((r) => r.name !== except && r.name.toLowerCase() === name.toLowerCase());

// Demo data so a new account isn't an empty screen. Does nothing if the user has any transactions.
export async function seedDemo(repo, now = new Date()) {
  await ensureDefaults(repo);
  if ((await repo.recent('9999-12-31', 1)).length) return false;
  let seed = 20261115;
  const rnd = () => { // mulberry32 — deterministic
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const between = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 100);
  const pickOne = (arr) => arr[Math.floor(rnd() * arr.length)];
  const end = ymd(now);
  const thisMonth = end.slice(0, 7);
  const rows = [];

  for (let back = 5; back >= 0; back--) {
    const month = shiftMonth(thisMonth, -back);
    const days = Number(lastDay(month).slice(8));
    const add = (day, type, category, note, amount) => {
      const date = `${month}-${pad(Math.min(day, days))}`;
      if (date <= end) rows.push({ date, type, category, note, amount });
    };
    add(1, 'income', 'Salary', 'Monthly paycheck', 485000);
    add(2, 'expense', 'Housing', 'Rent', 145000);
    add(3, 'expense', 'Transport', 'Transit pass', 6500);
    add(5, 'expense', 'Subscriptions', 'Video streaming', 1599);
    add(6, 'expense', 'Health', 'Gym membership', 3900);
    add(8, 'expense', 'Utilities', 'Electricity', between(58, 96));
    add(9, 'expense', 'Subscriptions', 'Music streaming', 1099);
    add(12, 'expense', 'Utilities', 'Internet', 5500);
    add(18, 'expense', 'Subscriptions', 'Cloud storage', 299);
    add(25, 'income', 'Investments', 'Dividends', between(42, 84));
    if (back % 2 === 0) add(20, 'income', 'Freelance', pickOne(['Logo design project', 'Website audit', 'Consulting session']), between(380, 920));
    for (let day = 2 + Math.floor(rnd() * 3); day <= days; day += 3 + Math.floor(rnd() * 3)) {
      add(day, 'expense', 'Groceries', pickOne(['Weekly groceries', 'Farmers market', 'Corner store', 'Grocery run']), between(32, 112));
    }
    for (let i = 0; i < 6; i++) {
      add(1 + Math.floor(rnd() * days), 'expense', 'Dining', pickOne(['Lunch with team', 'Coffee', 'Dinner out', 'Takeout', 'Brunch', 'Bakery']), between(6, 58));
    }
    for (let i = 0; i < 3; i++) {
      add(1 + Math.floor(rnd() * days), 'expense', 'Transport', pickOne(['Fuel', 'Ride share', 'Parking']), between(9, 42));
    }
    for (let i = 0; i < 2; i++) {
      add(1 + Math.floor(rnd() * days), 'expense', 'Entertainment', pickOne(['Cinema', 'Concert tickets', 'Bookstore', 'Board game night']), between(14, 62));
      add(1 + Math.floor(rnd() * days), 'expense', 'Shopping', pickOne(['Clothing', 'Home goods', 'Electronics accessory', 'Gift']), between(24, 150));
    }
    if (rnd() < 0.5) add(1 + Math.floor(rnd() * days), 'expense', 'Health', 'Pharmacy', between(8, 36));
    if (back === 3) {
      add(14, 'expense', 'Travel', 'Flights — summer trip', 42000);
      add(16, 'expense', 'Travel', 'Hotel, 3 nights', 31000);
    }
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  await repo.addTxns(rows);
  for (const [cat, dollars] of [['Housing', 1500], ['Groceries', 550], ['Dining', 200], ['Transport', 150],
    ['Utilities', 180], ['Entertainment', 100], ['Shopping', 200], ['Subscriptions', 40], ['Health', 80]]) {
    await repo.setBudget(cat, dollars * 100);
  }
  await repo.saveSettings({ openingBalance: 850000 });
  return true;
}

// ---------- validation ----------
function parseTxn(categories, body) {
  if (!body || typeof body !== 'object') return { error: 'Request body must be a JSON object.' };
  const { date, type, category } = body;
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  const amount = Number(body.amount);
  if (!isDate(date)) return { error: 'Date must be a valid YYYY-MM-DD date.' };
  if (type !== 'income' && type !== 'expense') return { error: 'Type must be "income" or "expense".' };
  if (categories.find((c) => c.name === String(category))?.type !== type) return { error: `"${category}" is not a valid ${type} category.` };
  if (!Number.isInteger(amount) || amount <= 0 || amount > 1e13) return { error: 'Amount must be greater than zero.' };
  if (note.length > 200) return { error: 'Description must be 200 characters or fewer.' };
  return { value: { date, type, category, note, amount } };
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
function parseCredentials(body, { signUp = false } = {}) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'Enter a valid email address.');
  if (!password) throw new HttpError(400, 'Enter your password.');
  if (signUp && password.length < 8) throw new HttpError(400, 'Choose a stronger password (at least 8 characters).');
  if (password.length > 72) throw new HttpError(400, 'Password must be 72 characters or fewer.');
  return { email, password };
}

// ---------- queries ----------
const signedAmount = (t) => (t.type === 'income' ? t.amount : -t.amount);

async function summary(repo, month, categories) {
  const prev = shiftMonth(month, -1);
  const now = today();
  // The trend ends today when looking at the current month, otherwise at month end.
  const end = month === now.slice(0, 7) ? now : lastDay(month);
  const start = `${shiftMonth(month, -5)}-01`;

  const [settings, limits, netBefore, rows, recent] = await Promise.all([
    repo.settings(), repo.budgets(), repo.netBefore(start), repo.range(start, lastDay(month)), repo.recent(end, 7),
  ]);
  const before = settings.openingBalance + netBefore;
  const balanceAt = (date) => rows.reduce((sum, t) => (t.date <= date ? sum + signedAmount(t) : sum), before);

  const totals = new Map();
  for (const t of rows) {
    const m = t.date.slice(0, 7);
    if (!totals.has(m)) totals.set(m, { income: 0, expense: 0 });
    totals.get(m)[t.type] += t.amount;
  }
  const monthTotals = (m) => ({ ...(totals.get(m) ?? { income: 0, expense: 0 }) });
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const m = shiftMonth(month, -i);
    months.push({ month: m, ...monthTotals(m) });
  }

  // Daily closing balance across the six-month window.
  const daily = new Map();
  for (const t of rows) if (t.date <= end) daily.set(t.date, (daily.get(t.date) ?? 0) + signedAmount(t));
  const trend = [];
  let running = before;
  const [sy, sm] = start.split('-').map(Number);
  for (let d = new Date(sy, sm - 1, 1); ymd(d) <= end; d.setDate(d.getDate() + 1)) {
    const key = ymd(d);
    running += daily.get(key) ?? 0;
    trend.push({ date: key, balance: running });
  }

  const spent = new Map();
  for (const t of rows) {
    if (t.type === 'expense' && t.date.slice(0, 7) === month) spent.set(t.category, (spent.get(t.category) ?? 0) + t.amount);
  }
  const byCategory = [...spent].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);
  const budgets = categoriesByType(categories).expense.map(({ name: category }) => ({
    category, limit: limits.get(category) ?? 0, spent: spent.get(category) ?? 0,
  }));

  return {
    month, asOf: end,
    current: monthTotals(month),
    previous: monthTotals(prev),
    balance: balanceAt(end),
    balancePrev: balanceAt(lastDay(prev)),
    months, trend, byCategory, budgets, recent,
  };
}

async function listTransactions(repo, q) {
  const filter = {
    month: isMonth(q.get('month')) ? q.get('month') : '',
    type: ['income', 'expense'].includes(q.get('type')) ? q.get('type') : '',
    category: q.get('category') ?? '',
    q: (q.get('q') ?? '').trim().slice(0, 100),
  };
  const limit = 500;
  const [items, rows] = await Promise.all([repo.find(filter, limit), repo.findTotals(filter)]);
  const totals = { income: 0, expense: 0, count: 0 };
  for (const r of rows) { totals[r.type] = r.total; totals.count += r.n; }
  return { items, totals, truncated: totals.count > items.length };
}

function toCsv(rows) {
  const cell = (v) => {
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formulas
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const lines = ['date,type,category,description,amount'];
  for (const r of rows) {
    lines.push([r.date, r.type, cell(r.category), cell(r.note), (r.amount / 100).toFixed(2)].join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

// ---------- http ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(new HttpError(413, 'Request body is too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new HttpError(400, 'Request body is not valid JSON.')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  const isText = typeof body === 'string' || Buffer.isBuffer(body);
  const payload = isText ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

async function handleAuth(store, req, res, path) {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  if (path === '/api/auth/signin') {
    const { email, password } = parseCredentials(await readJson(req));
    return send(res, 200, await store.auth.signIn(email, password));
  }
  if (path === '/api/auth/signup') {
    const { email, password } = parseCredentials(await readJson(req), { signUp: true });
    const { session } = await store.auth.signUp(email, password);
    // No session means the project requires email confirmation first.
    return send(res, 201, session ? { session } : { confirm: true });
  }
  if (path === '/api/auth/refresh') {
    const token = (await readJson(req)).refreshToken;
    if (typeof token !== 'string' || !token || token.length > 4096) throw new HttpError(401, SIGN_IN_AGAIN);
    return send(res, 200, await store.auth.refresh(token));
  }
  if (path === '/api/auth/signout') {
    const token = bearer(req);
    if (token) await store.auth.signOut(token);
    return send(res, 200, { ok: true });
  }
  throw new HttpError(404, 'Not found.');
}

const bearer = (req) => /^Bearer ([\w.~+/=-]{10,4096})$/.exec(req.headers.authorization ?? '')?.[1] ?? null;

async function handleApi(store, ready, req, res, url) {
  const { method } = req;
  const path = url.pathname;
  if (path.startsWith('/api/auth/')) return handleAuth(store, req, res, path);

  const token = bearer(req);
  const user = token && store.auth.verify(token);
  if (!user) throw new HttpError(401, SIGN_IN_AGAIN);
  const repo = store.forToken(token);
  // First request from this user since the server started: make sure they have categories.
  let categories;
  if (!ready.has(user.userId)) {
    categories = await ensureDefaults(repo);
    ready.add(user.userId);
  }
  const cats = async () => (categories ??= await repo.categories());
  const findCategory = async (name) => (await cats()).find((c) => c.name === name);

  const txnId = path.match(/^\/api\/transactions\/(\d{1,15})$/);
  const budgetCat = path.match(/^\/api\/budgets\/([^/]+)$/);
  const categoryName = path.match(/^\/api\/categories\/([^/]+)$/);
  const param = (m) => { try { return decodeURIComponent(m[1]); } catch { throw new HttpError(400, 'Bad path.'); } };

  if (path === '/api/meta' && method === 'GET') {
    const [rows, settings, months] = await Promise.all([cats(), repo.settings(), repo.months()]);
    return send(res, 200, {
      categories: categoriesByType(rows), currencies: CURRENCIES, settings,
      months, currentMonth: today().slice(0, 7), today: today(), user: { email: user.email },
    });
  }
  if (path === '/api/summary' && method === 'GET') {
    const month = url.searchParams.get('month') ?? today().slice(0, 7);
    if (!isMonth(month)) throw new HttpError(400, 'Month must be in YYYY-MM format.');
    return send(res, 200, await summary(repo, month, await cats()));
  }
  if (path === '/api/transactions' && method === 'GET') {
    return send(res, 200, await listTransactions(repo, url.searchParams));
  }
  if (path === '/api/categories' && method === 'GET') {
    const [rows, counts] = await Promise.all([cats(), repo.categoryCounts()]);
    return send(res, 200, categoriesByType(rows, counts));
  }
  if (path === '/api/categories' && method === 'POST') {
    const body = await readJson(req);
    const { error, name } = cleanCategoryName(body.name);
    if (error) throw new HttpError(400, error);
    if (body.type !== 'income' && body.type !== 'expense') throw new HttpError(400, 'Type must be "income" or "expense".');
    if (!isIconKey(body.icon)) throw new HttpError(400, 'Choose an icon.');
    if (nameTaken(await cats(), name)) throw new HttpError(409, `A category named "${name}" already exists.`);
    await repo.addCategory({ name, type: body.type, icon: body.icon });
    return send(res, 201, { name, type: body.type, icon: body.icon, locked: false, count: 0 });
  }
  if (categoryName && method === 'PUT') {
    const current = await findCategory(param(categoryName));
    if (!current) throw new HttpError(404, 'That category no longer exists.');
    const body = await readJson(req);
    let { name, icon } = current;
    if (body.name !== undefined) {
      const cleaned = cleanCategoryName(body.name);
      if (cleaned.error) throw new HttpError(400, cleaned.error);
      if (cleaned.name !== current.name) {
        if (current.name === FALLBACK[current.type]) throw new HttpError(400, `"${current.name}" is built in and can't be renamed.`);
        if (nameTaken(await cats(), cleaned.name, current.name)) throw new HttpError(409, `A category named "${cleaned.name}" already exists.`);
        name = cleaned.name;
      }
    }
    if (body.icon !== undefined) {
      if (!isIconKey(body.icon)) throw new HttpError(400, 'Choose an icon.');
      icon = body.icon;
    }
    // Transactions and budgets reference categories by name; the store carries them along.
    if (!await repo.updateCategory(current.name, { name, icon })) throw new HttpError(404, 'That category no longer exists.');
    return send(res, 200, { name, type: current.type, icon, locked: name === FALLBACK[current.type] });
  }
  if (categoryName && method === 'DELETE') {
    const current = await findCategory(param(categoryName));
    if (!current) throw new HttpError(404, 'That category no longer exists.');
    if (current.name === FALLBACK[current.type]) throw new HttpError(400, `"${current.name}" is built in and can't be deleted.`);
    const used = (await repo.categoryCounts()).get(current.name) ?? 0;
    const moveTo = url.searchParams.get('moveTo');
    if (used > 0) {
      if (!moveTo) throw new HttpError(409, `${used} ${used === 1 ? 'transaction uses' : 'transactions use'} "${current.name}". Choose a category to move them to.`);
      const target = await findCategory(moveTo);
      if (!target || target.type !== current.type || target.name === current.name) {
        throw new HttpError(400, `Move them to a different ${current.type} category.`);
      }
    }
    const moved = await repo.deleteCategory(current.name, used > 0 ? moveTo : null);
    return send(res, 200, { name: current.name, moved });
  }
  if (path === '/api/transactions' && method === 'POST') {
    const { error, value } = parseTxn(await cats(), await readJson(req));
    if (error) throw new HttpError(400, error);
    return send(res, 201, await repo.addTxn(value));
  }
  if (txnId && method === 'PUT') {
    const { error, value } = parseTxn(await cats(), await readJson(req));
    if (error) throw new HttpError(400, error);
    const row = await repo.updateTxn(Number(txnId[1]), value);
    if (!row) throw new HttpError(404, 'That transaction no longer exists.');
    return send(res, 200, row);
  }
  if (txnId && method === 'DELETE') {
    const row = await repo.deleteTxn(Number(txnId[1]));
    if (!row) throw new HttpError(404, 'That transaction no longer exists.');
    return send(res, 200, row); // returned so the client can offer undo
  }
  if (budgetCat && method === 'PUT') {
    const category = param(budgetCat);
    if ((await findCategory(category))?.type !== 'expense') throw new HttpError(400, 'Unknown expense category.');
    const limit = Number((await readJson(req)).limit);
    if (!Number.isInteger(limit) || limit < 0 || limit > 1e13) throw new HttpError(400, 'Budget must be zero or a positive amount.');
    await repo.setBudget(category, limit);
    return send(res, 200, { category, limit });
  }
  if (path === '/api/settings' && method === 'PUT') {
    const body = await readJson(req);
    const change = {};
    if (body.currency !== undefined) {
      if (!CURRENCIES.includes(body.currency)) throw new HttpError(400, 'Unsupported currency.');
      change.currency = body.currency;
    }
    if (body.openingBalance !== undefined) {
      const n = Number(body.openingBalance);
      if (!Number.isInteger(n) || Math.abs(n) > 1e13) throw new HttpError(400, 'Opening balance must be a number.');
      change.openingBalance = n;
    }
    if (Object.keys(change).length) await repo.saveSettings(change);
    return send(res, 200, await repo.settings());
  }
  if (path === '/api/export.csv' && method === 'GET') {
    return send(res, 200, toCsv(await repo.allTransactions()), {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tally-transactions-${today()}.csv"`,
    });
  }
  throw new HttpError(404, 'Not found.');
}

async function handleStatic(res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'Bad path.'); }
  if (rel === '/') rel = '/index.html';
  const file = normalize(join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + sep)) throw new HttpError(403, 'Forbidden.');
  let data;
  try { data = await readFile(file); } catch { throw new HttpError(404, 'Not found.'); }
  send(res, 200, data, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
}

export function createApp(store) {
  const ready = new Set(); // users whose default categories are known to exist
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) await handleApi(store, ready, req, res, url);
      else if (req.method === 'GET' || req.method === 'HEAD') await handleStatic(res, url.pathname);
      else throw new HttpError(405, 'Method not allowed.');
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'Something went wrong on the server.' : err.message });
      else res.end();
    }
  });
}

// Picks the store from the environment: Supabase by default, memory with TALLY_STORE=memory.
export async function storeFromEnv(env = process.env) {
  if (env.TALLY_STORE === 'memory') {
    const { createMemoryStore } = await import('./store/memory.js');
    return createMemoryStore();
  }
  const { createSupabaseStore } = await import('./store/supabase.js');
  return createSupabaseStore({ url: env.SUPABASE_URL, key: env.SUPABASE_ANON_KEY });
}

export function loadEnv() {
  try { process.loadEnvFile(join(ROOT, '.env')); } catch { /* no .env: use the real environment */ }
}

// ---------- entry point ----------
if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  loadEnv();
  const port = Number(process.env.PORT) || 4310;
  const host = process.env.HOST || '127.0.0.1';
  let store;
  try { store = await storeFromEnv(); } catch (err) {
    console.error(`${err.message}\nCopy .env.example to .env and fill it in, or run with TALLY_STORE=memory to try Tally offline.`);
    process.exit(1);
  }
  if (store.kind === 'memory' && process.env.TALLY_NO_SEED !== '1') {
    // Offline mode starts with a demo account so there is something to look at.
    const email = 'demo@tally.app';
    const password = process.env.TALLY_DEMO_PASSWORD || 'tally-demo-offline';
    const { session } = await store.auth.signUp(email, password);
    await seedDemo(store.forToken(session.accessToken));
    console.log(`In-memory store (nothing is saved). Demo account: ${email} / ${password}`);
  }
  createApp(store).listen(port, host, () => console.log(`Tally is running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`));
}
