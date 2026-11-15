// End-to-end API tests against an in-memory database. Run with: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
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
