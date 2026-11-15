// End-to-end API tests against an in-memory database. Run with: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, openDb, seedIfEmpty } from '../server.js';

let server, base, db;
const call = async (path, method = 'GET', body) => {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* csv or html */ }
  return { status: res.status, data };
};

before(async () => {
  db = openDb(':memory:');
  server = createApp(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); });

test('starts empty and serves the app shell', async () => {
  const page = await call('/');
  assert.equal(page.status, 200);
  assert.match(page.data, /<title>Tally/);
  const list = await call('/api/transactions');
  assert.deepEqual(list.data.items, []);
});

test('transaction lifecycle: create, update, filter, delete', async () => {
  const created = await call('/api/transactions', 'POST',
    { date: '2026-03-10', type: 'expense', category: 'Groceries', note: 'Market', amount: 4250 });
  assert.equal(created.status, 201);
  const { id } = created.data;

  await call('/api/transactions', 'POST', { date: '2026-03-01', type: 'income', category: 'Salary', amount: 300000 });
  const updated = await call(`/api/transactions/${id}`, 'PUT',
    { date: '2026-03-11', type: 'expense', category: 'Dining', note: 'Dinner', amount: 5000 });
  assert.equal(updated.data.category, 'Dining');

  const found = await call('/api/transactions?month=2026-03&q=DINN');
  assert.equal(found.data.items.length, 1);
  assert.equal(found.data.totals.expense, 5000);

  const sum = await call('/api/summary?month=2026-03');
  assert.equal(sum.data.current.income, 300000);
  assert.equal(sum.data.current.expense, 5000);
  assert.equal(sum.data.balance, 295000);
  assert.equal(sum.data.months.length, 6);
  assert.equal(sum.data.trend.at(-1).balance, 295000);

  const removed = await call(`/api/transactions/${id}`, 'DELETE');
  assert.equal(removed.data.id, id);
  assert.equal((await call(`/api/transactions/${id}`, 'DELETE')).status, 404);
});

test('rejects invalid transactions', async () => {
  const bad = [
    { date: '2026-02-30', type: 'expense', category: 'Dining', amount: 100 },
    { date: '2026-02-01', type: 'expense', category: 'Salary', amount: 100 },
    { date: '2026-02-01', type: 'expense', category: 'Dining', amount: -5 },
    { date: '2026-02-01', type: 'refund', category: 'Dining', amount: 100 },
  ];
  for (const body of bad) assert.equal((await call('/api/transactions', 'POST', body)).status, 400);
});

test('budgets and settings', async () => {
  await call('/api/transactions', 'POST', { date: '2026-04-05', type: 'expense', category: 'Dining', amount: 12000 });
  assert.equal((await call('/api/budgets/Dining', 'PUT', { limit: 10000 })).status, 200);
  let dining = (await call('/api/summary?month=2026-04')).data.budgets.find((b) => b.category === 'Dining');
  assert.deepEqual(dining, { category: 'Dining', limit: 10000, spent: 12000 });
  await call('/api/budgets/Dining', 'PUT', { limit: 0 });
  dining = (await call('/api/summary?month=2026-04')).data.budgets.find((b) => b.category === 'Dining');
  assert.equal(dining.limit, 0);
  assert.equal((await call('/api/budgets/Nope', 'PUT', { limit: 100 })).status, 400);

  const settings = await call('/api/settings', 'PUT', { currency: 'EUR', openingBalance: 50000 });
  assert.deepEqual(settings.data, { currency: 'EUR', openingBalance: 50000 });
  assert.equal((await call('/api/settings', 'PUT', { currency: 'XXX' })).status, 400);
  // Cambodian riel and Thai baht are offered for Khmer users.
  for (const code of ['KHR', 'THB']) {
    assert.equal((await call('/api/settings', 'PUT', { currency: code })).data.currency, code);
    assert.ok((await call('/api/meta')).data.currencies.includes(code));
  }
  await call('/api/settings', 'PUT', { currency: 'EUR' });
});

test('categories: create, use, rename, delete', async () => {
  const meta = (await call('/api/meta')).data.categories;
  assert.equal(meta.expense.at(-1).name, 'Other'); // catch-all sorts last
  assert.deepEqual(meta.expense.find((c) => c.name === 'Dining'), { name: 'Dining', icon: 'utensils', locked: false });
  assert.equal(meta.expense.at(-1).locked, true);

  const made = await call('/api/categories', 'POST', { name: '  Pet   care ', type: 'expense', icon: 'paw' });
  assert.equal(made.status, 201);
  assert.equal(made.data.name, 'Pet care'); // trimmed, whitespace collapsed
  const after = (await call('/api/meta')).data.categories.expense.map((c) => c.name);
  assert.deepEqual(after.slice(-2), ['Pet care', 'Other']); // new ones slot in before the catch-all

  // validation: duplicates are case-insensitive and global across types
  assert.equal((await call('/api/categories', 'POST', { name: 'pet CARE', type: 'expense', icon: 'paw' })).status, 409);
  assert.equal((await call('/api/categories', 'POST', { name: 'salary', type: 'expense', icon: 'paw' })).status, 409);
  assert.equal((await call('/api/categories', 'POST', { name: '', type: 'expense', icon: 'paw' })).status, 400);
  assert.equal((await call('/api/categories', 'POST', { name: 'x'.repeat(31), type: 'expense', icon: 'paw' })).status, 400);
  assert.equal((await call('/api/categories', 'POST', { name: 'Bad icon', type: 'expense', icon: '<script>' })).status, 400);
  assert.equal((await call('/api/categories', 'POST', { name: 'Bad type', type: 'refund', icon: 'paw' })).status, 400);

  // a new category is usable by transactions and budgets, and only under its own type
  const spend = await call('/api/transactions', 'POST', { date: '2026-06-02', type: 'expense', category: 'Pet care', amount: 3000 });
  assert.equal(spend.status, 201);
  assert.equal((await call('/api/transactions', 'POST', { date: '2026-06-02', type: 'income', category: 'Pet care', amount: 3000 })).status, 400);
  assert.equal((await call('/api/budgets/Pet%20care', 'PUT', { limit: 9000 })).status, 200);

  // rename keeps transactions and budgets attached and updates the icon
  const renamed = await call('/api/categories/Pet%20care', 'PUT', { name: 'Pets', icon: 'heart' });
  assert.deepEqual(renamed.data, { name: 'Pets', type: 'expense', icon: 'heart', locked: false });
  assert.equal((await call('/api/transactions?category=Pets')).data.items.length, 1);
  assert.equal((await call('/api/transactions?category=Pet%20care')).data.items.length, 0);
  const pets = (await call('/api/summary?month=2026-06')).data.budgets.find((b) => b.category === 'Pets');
  assert.deepEqual(pets, { category: 'Pets', limit: 9000, spent: 3000 });
  assert.equal((await call('/api/categories/Pets', 'PUT', { name: 'dining' })).status, 409);
  assert.equal((await call('/api/categories/Pets', 'PUT', { name: 'PETS' })).status, 200); // case-only rename of itself is fine

  // the catch-all is protected; its icon can still change
  assert.equal((await call('/api/categories/Other', 'PUT', { name: 'Misc' })).status, 400);
  assert.equal((await call('/api/categories/Other', 'PUT', { icon: 'star' })).status, 200);
  assert.equal((await call('/api/categories/Other', 'DELETE')).status, 400);

  // listing carries usage counts
  const listed = (await call('/api/categories')).data;
  assert.equal(listed.expense.find((c) => c.name === 'PETS').count, 1);

  // deleting a used category needs somewhere to move its transactions
  assert.equal((await call('/api/categories/PETS', 'DELETE')).status, 409);
  assert.equal((await call('/api/categories/PETS?moveTo=Salary', 'DELETE')).status, 400); // wrong type
  assert.equal((await call('/api/categories/PETS?moveTo=PETS', 'DELETE')).status, 400);   // itself
  const gone = await call('/api/categories/PETS?moveTo=Other', 'DELETE');
  assert.deepEqual(gone.data, { name: 'PETS', moved: 1 });
  assert.equal((await call('/api/transactions?category=Other&month=2026-06')).data.items.length, 1);
  assert.equal((await call('/api/budgets/PETS', 'PUT', { limit: 100 })).status, 400);
  assert.equal((await call('/api/categories/PETS', 'DELETE')).status, 404);

  // an unused category deletes without a destination
  await call('/api/categories', 'POST', { name: 'Side gigs', type: 'income', icon: 'laptop' });
  assert.equal((await call('/api/categories/Side%20gigs', 'DELETE')).status, 200);
});

test('a database from before editable categories is upgraded in place', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tally-'));
  const file = join(dir, 'old.db');
  try {
    const old = new DatabaseSync(file); // the original schema: no categories table
    old.exec(`CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, type TEXT NOT NULL,
      category TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', amount INTEGER NOT NULL);
      INSERT INTO transactions(date, type, category, amount) VALUES('2026-01-01', 'expense', 'Dining', 100);`);
    old.close();

    const upgraded = openDb(file);
    const names = upgraded.prepare('SELECT name FROM categories').all().map((r) => r.name);
    assert.equal(names.length, 15);
    assert.ok(names.includes('Dining') && names.includes('Other income'));
    assert.equal(upgraded.prepare('SELECT COUNT(*) AS n FROM transactions').get().n, 1); // data untouched
    upgraded.close();
    openDb(file).close(); // a second open must not duplicate or fail
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('serves the bundled Khmer font', async () => {
  const res = await fetch(`${base}/fonts/kantumruy-pro-khmer.woff2`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'font/woff2');
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString(), 'wOF2');
});

test('csv export neutralises formulas; static files cannot escape public/', async () => {
  await call('/api/transactions', 'POST', { date: '2026-05-01', type: 'expense', category: 'Other', note: '=SUM(A1:A9)', amount: 100 });
  const csv = await call('/api/export.csv');
  assert.match(csv.data, /^date,type,category,description,amount/);
  assert.match(csv.data, /'=SUM\(A1:A9\)/);
  assert.notEqual((await call('/..%2Fserver.js')).status, 200);
});

test('demo seed fills a new database once', () => {
  const fresh = openDb(':memory:');
  seedIfEmpty(fresh, new Date(2026, 10, 15));
  const count = () => fresh.prepare('SELECT COUNT(*) AS n FROM transactions').get().n;
  const n = count();
  assert.ok(n > 100);
  seedIfEmpty(fresh, new Date(2026, 10, 15));
  assert.equal(count(), n);
  fresh.close();
});
