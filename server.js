// Tally — personal finance tracker.
// Zero-dependency server: node:http for the API + static files, node:sqlite for storage.
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');

// Starting categories as [name, icon]. Copied into the `categories` table the first time a
// database is opened; after that the table is the source of truth and users manage it in the UI.
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

// ---------- database ----------
export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('income','expense')),
      category TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      amount INTEGER NOT NULL CHECK (amount > 0)
    );
    CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(date);
    CREATE TABLE IF NOT EXISTS budgets (
      category TEXT PRIMARY KEY,
      monthly_limit INTEGER NOT NULL CHECK (monthly_limit > 0)
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS categories (
      name TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('income','expense')),
      icon TEXT NOT NULL,
      position INTEGER NOT NULL
    );
  `);
  // Brand-new database, or one created before categories were editable: start from the defaults.
  if (!db.prepare('SELECT 1 FROM categories').get()) {
    const insert = db.prepare('INSERT INTO categories(name, type, icon, position) VALUES(?, ?, ?, ?)');
    let position = 0;
    for (const type of ['expense', 'income']) {
      for (const [name, icon] of DEFAULT_CATEGORIES[type]) insert.run(name, type, icon, position++);
    }
  }
  return db;
}

function inTransaction(db, fn) {
  db.exec('BEGIN');
  try { const out = fn(); db.exec('COMMIT'); return out; }
  catch (err) { db.exec('ROLLBACK'); throw err; }
}

// ---------- categories ----------
// Names are unique across both types (budgets and filters address a category by name alone).
// `withCounts` adds how many transactions use each one. The catch-all always sorts last.
function categoriesByType(db, withCounts = false) {
  const counts = withCounts
    ? new Map(db.prepare('SELECT category, COUNT(*) AS n FROM transactions GROUP BY category').all().map((r) => [r.category, r.n]))
    : null;
  const out = { expense: [], income: [] };
  for (const r of db.prepare('SELECT name, type, icon FROM categories ORDER BY position, rowid').all()) {
    const item = { name: r.name, icon: r.icon, locked: r.name === FALLBACK[r.type] };
    if (counts) item.count = counts.get(r.name) ?? 0;
    out[r.type].push(item);
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.locked - b.locked); // stable
  return out;
}
const findCategory = (db, name) => db.prepare('SELECT name, type, icon FROM categories WHERE name = ?').get(name);

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
function nameTaken(db, name, except) {
  const lower = name.toLowerCase();
  return db.prepare('SELECT name FROM categories').all().some((r) => r.name !== except && r.name.toLowerCase() === lower);
}

function getSettings(db) {
  const s = { currency: 'USD', openingBalance: 0 };
  for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) {
    if (key === 'currency') s.currency = value;
    if (key === 'openingBalance') s.openingBalance = Number(value) || 0;
  }
  return s;
}
const setSetting = (db, key, value) =>
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));

// Demo data so the first run isn't an empty screen. Only runs on a brand-new database.
export function seedIfEmpty(db, now = new Date()) {
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'seeded'").get()) return;
  let seed = 20261115;
  const rnd = () => { // mulberry32 — deterministic
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const between = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 100);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const end = ymd(now);
  const insert = db.prepare('INSERT INTO transactions(date, type, category, note, amount) VALUES(?,?,?,?,?)');
  const thisMonth = end.slice(0, 7);

  db.exec('BEGIN');
  for (let back = 5; back >= 0; back--) {
    const month = shiftMonth(thisMonth, -back);
    const days = Number(lastDay(month).slice(8));
    const add = (day, type, category, note, cents) => {
      const date = `${month}-${pad(Math.min(day, days))}`;
      if (date <= end) insert.run(date, type, category, note, cents);
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
    if (back % 2 === 0) add(20, 'income', 'Freelance', pick(['Logo design project', 'Website audit', 'Consulting session']), between(380, 920));
    for (let day = 2 + Math.floor(rnd() * 3); day <= days; day += 3 + Math.floor(rnd() * 3)) {
      add(day, 'expense', 'Groceries', pick(['Weekly groceries', 'Farmers market', 'Corner store', 'Grocery run']), between(32, 112));
    }
    for (let i = 0; i < 6; i++) {
      add(1 + Math.floor(rnd() * days), 'expense', 'Dining', pick(['Lunch with team', 'Coffee', 'Dinner out', 'Takeout', 'Brunch', 'Bakery']), between(6, 58));
    }
    for (let i = 0; i < 3; i++) {
      add(1 + Math.floor(rnd() * days), 'expense', 'Transport', pick(['Fuel', 'Ride share', 'Parking']), between(9, 42));
    }
    for (let i = 0; i < 2; i++) {
      add(1 + Math.floor(rnd() * days), 'expense', 'Entertainment', pick(['Cinema', 'Concert tickets', 'Bookstore', 'Board game night']), between(14, 62));
      add(1 + Math.floor(rnd() * days), 'expense', 'Shopping', pick(['Clothing', 'Home goods', 'Electronics accessory', 'Gift']), between(24, 150));
    }
    if (rnd() < 0.5) add(1 + Math.floor(rnd() * days), 'expense', 'Health', 'Pharmacy', between(8, 36));
    if (back === 3) {
      add(14, 'expense', 'Travel', 'Flights — summer trip', 42000);
      add(16, 'expense', 'Travel', 'Hotel, 3 nights', 31000);
    }
  }
  const budget = db.prepare('INSERT OR IGNORE INTO budgets(category, monthly_limit) VALUES(?, ?)');
  for (const [cat, dollars] of [['Housing', 1500], ['Groceries', 550], ['Dining', 200], ['Transport', 150],
    ['Utilities', 180], ['Entertainment', 100], ['Shopping', 200], ['Subscriptions', 40], ['Health', 80]]) {
    budget.run(cat, dollars * 100);
  }
  setSetting(db, 'openingBalance', 850000);
  setSetting(db, 'seeded', '1');
  db.exec('COMMIT');
}

// ---------- validation ----------
function parseTxn(db, body) {
  if (!body || typeof body !== 'object') return { error: 'Request body must be a JSON object.' };
  const { date, type, category } = body;
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  const amount = Number(body.amount);
  if (!isDate(date)) return { error: 'Date must be a valid YYYY-MM-DD date.' };
  if (type !== 'income' && type !== 'expense') return { error: 'Type must be "income" or "expense".' };
  if (findCategory(db, String(category))?.type !== type) return { error: `"${category}" is not a valid ${type} category.` };
  if (!Number.isInteger(amount) || amount <= 0 || amount > 1e13) return { error: 'Amount must be greater than zero.' };
  if (note.length > 200) return { error: 'Description must be 200 characters or fewer.' };
  return { value: { date, type, category, note, amount } };
}

// ---------- queries ----------
const SIGNED = "SUM(CASE type WHEN 'income' THEN amount ELSE -amount END)";

function monthTotals(db, month) {
  const out = { income: 0, expense: 0 };
  const rows = db.prepare('SELECT type, SUM(amount) AS total FROM transactions WHERE substr(date,1,7) = ? GROUP BY type').all(month);
  for (const r of rows) out[r.type] = r.total;
  return out;
}

function summary(db, month) {
  const settings = getSettings(db);
  const prev = shiftMonth(month, -1);
  const now = today();
  // The trend ends today when looking at the current month, otherwise at month end.
  const end = month === now.slice(0, 7) ? now : lastDay(month);
  const start = `${shiftMonth(month, -5)}-01`;

  const balanceAt = (date) => settings.openingBalance +
    (db.prepare(`SELECT ${SIGNED} AS net FROM transactions WHERE date <= ?`).get(date).net ?? 0);

  const months = [];
  for (let i = 5; i >= 0; i--) {
    const m = shiftMonth(month, -i);
    months.push({ month: m, ...monthTotals(db, m) });
  }

  // Daily closing balance across the six-month window.
  const before = settings.openingBalance +
    (db.prepare(`SELECT ${SIGNED} AS net FROM transactions WHERE date < ?`).get(start).net ?? 0);
  const daily = new Map(db.prepare(`SELECT date, ${SIGNED} AS net FROM transactions WHERE date >= ? AND date <= ? GROUP BY date`)
    .all(start, end).map((r) => [r.date, r.net]));
  const trend = [];
  let running = before;
  const [sy, sm] = start.split('-').map(Number);
  for (let d = new Date(sy, sm - 1, 1); ymd(d) <= end; d.setDate(d.getDate() + 1)) {
    const key = ymd(d);
    running += daily.get(key) ?? 0;
    trend.push({ date: key, balance: running });
  }

  const spent = new Map(db.prepare(
    "SELECT category, SUM(amount) AS total FROM transactions WHERE type = 'expense' AND substr(date,1,7) = ? GROUP BY category")
    .all(month).map((r) => [r.category, r.total]));
  const byCategory = [...spent].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);
  const limits = new Map(db.prepare('SELECT category, monthly_limit FROM budgets').all().map((r) => [r.category, r.monthly_limit]));
  const budgets = categoriesByType(db).expense.map(({ name: category }) => ({
    category, limit: limits.get(category) ?? 0, spent: spent.get(category) ?? 0,
  }));

  const recent = db.prepare('SELECT * FROM transactions WHERE date <= ? ORDER BY date DESC, id DESC LIMIT 7').all(end);

  return {
    month, asOf: end,
    current: monthTotals(db, month),
    previous: monthTotals(db, prev),
    balance: balanceAt(end),
    balancePrev: balanceAt(lastDay(prev)),
    months, trend, byCategory, budgets, recent,
  };
}

function listTransactions(db, q) {
  const where = [];
  const params = [];
  if (isMonth(q.get('month'))) { where.push('substr(date,1,7) = ?'); params.push(q.get('month')); }
  if (['income', 'expense'].includes(q.get('type'))) { where.push('type = ?'); params.push(q.get('type')); }
  if (q.get('category')) { where.push('category = ?'); params.push(q.get('category')); }
  const term = (q.get('q') ?? '').trim().toLowerCase();
  if (term) {
    where.push('(instr(lower(note), ?) > 0 OR instr(lower(category), ?) > 0)');
    params.push(term, term);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totals = { income: 0, expense: 0, count: 0 };
  for (const r of db.prepare(`SELECT type, SUM(amount) AS total, COUNT(*) AS n FROM transactions ${clause} GROUP BY type`).all(...params)) {
    totals[r.type] = r.total;
    totals.count += r.n;
  }
  const limit = 500;
  const items = db.prepare(`SELECT * FROM transactions ${clause} ORDER BY date DESC, id DESC LIMIT ${limit}`).all(...params);
  return { items, totals, truncated: totals.count > items.length };
}

function toCsv(db) {
  const cell = (v) => {
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formulas
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const rows = db.prepare('SELECT * FROM transactions ORDER BY date, id').all();
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

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

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

async function handleApi(db, req, res, url) {
  const { method } = req;
  const path = url.pathname;
  const txnId = path.match(/^\/api\/transactions\/(\d+)$/);
  const budgetCat = path.match(/^\/api\/budgets\/([^/]+)$/);
  const categoryName = path.match(/^\/api\/categories\/([^/]+)$/);
  const param = (m) => { try { return decodeURIComponent(m[1]); } catch { throw new HttpError(400, 'Bad path.'); } };

  if (path === '/api/meta' && method === 'GET') {
    const months = db.prepare('SELECT DISTINCT substr(date,1,7) AS m FROM transactions ORDER BY m DESC').all().map((r) => r.m);
    return send(res, 200, {
      categories: categoriesByType(db), currencies: CURRENCIES, settings: getSettings(db),
      months, currentMonth: today().slice(0, 7), today: today(),
    });
  }
  if (path === '/api/summary' && method === 'GET') {
    const month = url.searchParams.get('month') ?? today().slice(0, 7);
    if (!isMonth(month)) throw new HttpError(400, 'Month must be in YYYY-MM format.');
    return send(res, 200, summary(db, month));
  }
  if (path === '/api/transactions' && method === 'GET') {
    return send(res, 200, listTransactions(db, url.searchParams));
  }
  if (path === '/api/categories' && method === 'GET') {
    return send(res, 200, categoriesByType(db, true));
  }
  if (path === '/api/categories' && method === 'POST') {
    const body = await readJson(req);
    const { error, name } = cleanCategoryName(body.name);
    if (error) throw new HttpError(400, error);
    if (body.type !== 'income' && body.type !== 'expense') throw new HttpError(400, 'Type must be "income" or "expense".');
    if (!isIconKey(body.icon)) throw new HttpError(400, 'Choose an icon.');
    if (nameTaken(db, name)) throw new HttpError(409, `A category named "${name}" already exists.`);
    const position = (db.prepare('SELECT MAX(position) AS p FROM categories').get().p ?? -1) + 1;
    db.prepare('INSERT INTO categories(name, type, icon, position) VALUES(?, ?, ?, ?)').run(name, body.type, body.icon, position);
    return send(res, 201, { name, type: body.type, icon: body.icon, locked: false, count: 0 });
  }
  if (categoryName && method === 'PUT') {
    const current = findCategory(db, param(categoryName));
    if (!current) throw new HttpError(404, 'That category no longer exists.');
    const body = await readJson(req);
    let { name, icon } = current;
    if (body.name !== undefined) {
      const cleaned = cleanCategoryName(body.name);
      if (cleaned.error) throw new HttpError(400, cleaned.error);
      if (cleaned.name !== current.name) {
        if (current.name === FALLBACK[current.type]) throw new HttpError(400, `"${current.name}" is built in and can't be renamed.`);
        if (nameTaken(db, cleaned.name, current.name)) throw new HttpError(409, `A category named "${cleaned.name}" already exists.`);
        name = cleaned.name;
      }
    }
    if (body.icon !== undefined) {
      if (!isIconKey(body.icon)) throw new HttpError(400, 'Choose an icon.');
      icon = body.icon;
    }
    inTransaction(db, () => {
      db.prepare('UPDATE categories SET name = ?, icon = ? WHERE name = ?').run(name, icon, current.name);
      if (name !== current.name) { // transactions and budgets reference categories by name
        db.prepare('UPDATE transactions SET category = ? WHERE category = ?').run(name, current.name);
        db.prepare('UPDATE budgets SET category = ? WHERE category = ?').run(name, current.name);
      }
    });
    return send(res, 200, { name, type: current.type, icon, locked: name === FALLBACK[current.type] });
  }
  if (categoryName && method === 'DELETE') {
    const current = findCategory(db, param(categoryName));
    if (!current) throw new HttpError(404, 'That category no longer exists.');
    if (current.name === FALLBACK[current.type]) throw new HttpError(400, `"${current.name}" is built in and can't be deleted.`);
    const used = db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE category = ?').get(current.name).n;
    const moveTo = url.searchParams.get('moveTo');
    if (used > 0) {
      if (!moveTo) throw new HttpError(409, `${used} ${used === 1 ? 'transaction uses' : 'transactions use'} "${current.name}". Choose a category to move them to.`);
      const target = findCategory(db, moveTo);
      if (!target || target.type !== current.type || target.name === current.name) {
        throw new HttpError(400, `Move them to a different ${current.type} category.`);
      }
    }
    inTransaction(db, () => {
      if (used > 0) db.prepare('UPDATE transactions SET category = ? WHERE category = ?').run(moveTo, current.name);
      db.prepare('DELETE FROM budgets WHERE category = ?').run(current.name);
      db.prepare('DELETE FROM categories WHERE name = ?').run(current.name);
    });
    return send(res, 200, { name: current.name, moved: used });
  }
  if (path === '/api/transactions' && method === 'POST') {
    const { error, value } = parseTxn(db, await readJson(req));
    if (error) throw new HttpError(400, error);
    const info = db.prepare('INSERT INTO transactions(date, type, category, note, amount) VALUES(?,?,?,?,?)')
      .run(value.date, value.type, value.category, value.note, value.amount);
    return send(res, 201, { id: Number(info.lastInsertRowid), ...value });
  }
  if (txnId && method === 'PUT') {
    const { error, value } = parseTxn(db, await readJson(req));
    if (error) throw new HttpError(400, error);
    const info = db.prepare('UPDATE transactions SET date=?, type=?, category=?, note=?, amount=? WHERE id=?')
      .run(value.date, value.type, value.category, value.note, value.amount, Number(txnId[1]));
    if (!info.changes) throw new HttpError(404, 'That transaction no longer exists.');
    return send(res, 200, { id: Number(txnId[1]), ...value });
  }
  if (txnId && method === 'DELETE') {
    const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(Number(txnId[1]));
    if (!row) throw new HttpError(404, 'That transaction no longer exists.');
    db.prepare('DELETE FROM transactions WHERE id = ?').run(row.id);
    return send(res, 200, row); // returned so the client can offer undo
  }
  if (budgetCat && method === 'PUT') {
    const category = param(budgetCat);
    if (findCategory(db, category)?.type !== 'expense') throw new HttpError(400, 'Unknown expense category.');
    const limit = Number((await readJson(req)).limit);
    if (!Number.isInteger(limit) || limit < 0 || limit > 1e13) throw new HttpError(400, 'Budget must be zero or a positive amount.');
    if (limit === 0) db.prepare('DELETE FROM budgets WHERE category = ?').run(category);
    else db.prepare('INSERT INTO budgets(category, monthly_limit) VALUES(?, ?) ON CONFLICT(category) DO UPDATE SET monthly_limit = excluded.monthly_limit').run(category, limit);
    return send(res, 200, { category, limit });
  }
  if (path === '/api/settings' && method === 'PUT') {
    const body = await readJson(req);
    if (body.currency !== undefined) {
      if (!CURRENCIES.includes(body.currency)) throw new HttpError(400, 'Unsupported currency.');
      setSetting(db, 'currency', body.currency);
    }
    if (body.openingBalance !== undefined) {
      const n = Number(body.openingBalance);
      if (!Number.isInteger(n) || Math.abs(n) > 1e13) throw new HttpError(400, 'Opening balance must be a number.');
      setSetting(db, 'openingBalance', n);
    }
    return send(res, 200, getSettings(db));
  }
  if (path === '/api/export.csv' && method === 'GET') {
    return send(res, 200, toCsv(db), {
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

export function createApp(db) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) await handleApi(db, req, res, url);
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

// ---------- entry point ----------
if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const port = Number(process.env.PORT) || 4310;
  const host = process.env.HOST || '127.0.0.1';
  const db = openDb(process.env.TALLY_DB || join(ROOT, 'data', 'tally.db'));
  if (process.env.TALLY_NO_SEED !== '1') seedIfEmpty(db);
  createApp(db).listen(port, host, () => console.log(`Tally is running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`));
}
