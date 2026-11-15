// End-to-end API tests against the in-memory store (no network). Run with: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, seedDemo } from '../server.js';
import { createMemoryStore } from '../store/memory.js';
import { createSupabaseStore, readClaims } from '../store/supabase.js';

let server, base, store, token;
const call = async (path, method = 'GET', body, auth = token) => {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (auth) headers.Authorization = `Bearer ${auth}`;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* csv or html */ }
  return { status: res.status, data };
};
const signUp = async (email, password = 'correct horse') => (await call('/api/auth/signup', 'POST', { email, password }, null)).data.session;

before(async () => {
  store = createMemoryStore();
  server = createApp(store);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  token = (await signUp('ana@example.com')).accessToken;
});
after(() => { server.close(); });

test('serves the app shell without signing in; data needs a token', async () => {
  const page = await call('/', 'GET', undefined, null);
  assert.equal(page.status, 200);
  assert.match(page.data, /<title>Tally/);
  for (const [path, method] of [['/api/meta', 'GET'], ['/api/summary', 'GET'], ['/api/transactions', 'GET'],
    ['/api/transactions', 'POST'], ['/api/transactions/1', 'DELETE'], ['/api/budgets/Dining', 'PUT'],
    ['/api/settings', 'PUT'], ['/api/categories', 'GET'], ['/api/export.csv', 'GET']]) {
    const res = await call(path, method, method === 'GET' ? undefined : {}, null);
    assert.equal(res.status, 401, `${method} ${path}`);
    assert.equal(res.data.error, 'Your session has ended. Sign in again.');
  }
  assert.equal((await call('/api/meta', 'GET', undefined, 'not-a-real-token-at-all')).status, 401);
});

test('a new account starts empty, with the default categories', async () => {
  const list = await call('/api/transactions');
  assert.deepEqual(list.data.items, []);
  const meta = (await call('/api/meta')).data;
  assert.equal(meta.categories.expense.length + meta.categories.income.length, 15);
  assert.equal(meta.user.email, 'ana@example.com');
});

test('auth: sign up, sign in, refresh, sign out', async () => {
  // validation
  assert.equal((await call('/api/auth/signup', 'POST', { email: 'nope', password: 'longenough' }, null)).status, 400);
  const short = await call('/api/auth/signup', 'POST', { email: 'bo@example.com', password: 'short' }, null);
  assert.equal(short.status, 400);
  assert.match(short.data.error, /at least 8 characters/);
  assert.equal((await call('/api/auth/signup', 'POST', { email: 'ANA@example.com', password: 'whatever123' }, null)).status, 409);

  const wrong = await call('/api/auth/signin', 'POST', { email: 'ana@example.com', password: 'wrong password' }, null);
  assert.equal(wrong.status, 400);
  assert.equal(wrong.data.error, 'Email or password is incorrect.');

  const signin = await call('/api/auth/signin', 'POST', { email: ' Ana@Example.com ', password: 'correct horse' }, null);
  assert.equal(signin.status, 200);
  const s = signin.data;
  assert.ok(s.accessToken && s.refreshToken && s.expiresAt > Date.now());
  assert.equal((await call('/api/meta', 'GET', undefined, s.accessToken)).status, 200);

  // refresh tokens are single use
  const refreshed = await call('/api/auth/refresh', 'POST', { refreshToken: s.refreshToken }, null);
  assert.equal(refreshed.status, 200);
  assert.notEqual(refreshed.data.accessToken, s.accessToken);
  assert.equal((await call('/api/auth/refresh', 'POST', { refreshToken: s.refreshToken }, null)).status, 401);
  assert.equal((await call('/api/auth/refresh', 'POST', {}, null)).status, 401);

  // signing out ends that user's sessions
  const other = await call('/api/auth/signin', 'POST', { email: 'ana@example.com', password: 'correct horse' }, null);
  assert.equal((await call('/api/auth/signout', 'POST', {}, other.data.accessToken)).status, 200);
  assert.equal((await call('/api/meta', 'GET', undefined, other.data.accessToken)).status, 401);
  assert.equal((await call('/api/auth/refresh', 'POST', { refreshToken: other.data.refreshToken }, null)).status, 401);
  // ...so the shared test token needs replacing
  token = (await call('/api/auth/signin', 'POST', { email: 'ana@example.com', password: 'correct horse' }, null)).data.accessToken;
});

test('an expired access token is refused', async () => {
  const quick = createMemoryStore({ accessTtl: -1 });
  const { session } = await quick.auth.signUp('old@example.com', 'password123');
  assert.equal(quick.auth.verify(session.accessToken), null);
});

test('transaction lifecycle: create, update, filter, delete', async () => {
  const created = await call('/api/transactions', 'POST',
    { date: '2026-03-10', type: 'expense', category: 'Groceries', note: 'Market', amount: 4250 });
  assert.equal(created.status, 201);
  const { id } = created.data;
  assert.deepEqual(created.data, { id, date: '2026-03-10', type: 'expense', category: 'Groceries', note: 'Market', amount: 4250 });

  await call('/api/transactions', 'POST', { date: '2026-03-01', type: 'income', category: 'Salary', amount: 300000 });
  const updated = await call(`/api/transactions/${id}`, 'PUT',
    { date: '2026-03-11', type: 'expense', category: 'Dining', note: 'Dinner', amount: 5000 });
  assert.equal(updated.data.category, 'Dining');

  const found = await call('/api/transactions?month=2026-03&q=DINN');
  assert.equal(found.data.items.length, 1);
  assert.equal(found.data.totals.expense, 5000);
  assert.equal(found.data.totals.count, 1);

  const sum = await call('/api/summary?month=2026-03');
  assert.equal(sum.data.current.income, 300000);
  assert.equal(sum.data.current.expense, 5000);
  assert.equal(sum.data.balance, 295000);
  assert.equal(sum.data.months.length, 6);
  assert.equal(sum.data.trend.at(-1).balance, 295000);
  assert.equal(sum.data.recent.length, 2);
  assert.deepEqual((await call('/api/meta')).data.months, ['2026-03']);

  const removed = await call(`/api/transactions/${id}`, 'DELETE');
  assert.equal(removed.data.id, id);
  assert.equal((await call(`/api/transactions/${id}`, 'DELETE')).status, 404);
  assert.equal((await call(`/api/transactions/${id}`, 'PUT', { date: '2026-03-11', type: 'expense', category: 'Dining', amount: 1 })).status, 404);
});

test('rejects invalid transactions', async () => {
  const bad = [
    { date: '2026-02-30', type: 'expense', category: 'Dining', amount: 100 },
    { date: '2026-02-01', type: 'expense', category: 'Salary', amount: 100 },
    { date: '2026-02-01', type: 'expense', category: 'Dining', amount: -5 },
    { date: '2026-02-01', type: 'expense', category: 'Dining', amount: 10.5 },
    { date: '2026-02-01', type: 'refund', category: 'Dining', amount: 100 },
    { date: '2026-02-01', type: 'expense', category: 'Dining', amount: 100, note: 'x'.repeat(201) },
  ];
  for (const body of bad) assert.equal((await call('/api/transactions', 'POST', body)).status, 400);
});

test('balance carries over from before the six-month window', async () => {
  const { accessToken: t } = await signUp('carry@example.com');
  await call('/api/settings', 'PUT', { openingBalance: 10000 }, t);
  await call('/api/transactions', 'POST', { date: '2025-01-15', type: 'income', category: 'Salary', amount: 50000 }, t);
  await call('/api/transactions', 'POST', { date: '2026-09-02', type: 'expense', category: 'Dining', amount: 2500 }, t);
  await call('/api/transactions', 'POST', { date: '2026-10-02', type: 'expense', category: 'Dining', amount: 1500 }, t);
  const sum = (await call('/api/summary?month=2026-10', 'GET', undefined, t)).data;
  assert.equal(sum.balance, 10000 + 50000 - 2500 - 1500);
  assert.equal(sum.balancePrev, 10000 + 50000 - 2500);
  assert.equal(sum.trend[0].balance, 60000);
  assert.equal(sum.previous.expense, 2500);
  assert.deepEqual(sum.byCategory, [{ category: 'Dining', total: 1500 }]);
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
  assert.equal((await call('/api/budgets/Salary', 'PUT', { limit: 100 })).status, 400); // income category
  assert.equal((await call('/api/budgets/Dining', 'PUT', { limit: 1.5 })).status, 400);

  const settings = await call('/api/settings', 'PUT', { currency: 'EUR', openingBalance: 50000 });
  assert.deepEqual(settings.data, { currency: 'EUR', openingBalance: 50000 });
  assert.equal((await call('/api/settings', 'PUT', { currency: 'XXX' })).status, 400);
  assert.equal((await call('/api/settings', 'PUT', { openingBalance: 0.5 })).status, 400);
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

test('each user only sees and changes their own data', async () => {
  const { accessToken: bo } = await signUp('bo@example.com');
  const mine = await call('/api/transactions', 'POST', { date: '2026-07-01', type: 'expense', category: 'Travel', note: 'Ana only', amount: 777 });
  await call('/api/categories', 'POST', { name: 'Ana stuff', type: 'expense', icon: 'star' });
  await call('/api/settings', 'PUT', { currency: 'JPY' });

  // Bo sees none of it
  assert.deepEqual((await call('/api/transactions', 'GET', undefined, bo)).data.items, []);
  assert.equal((await call('/api/transactions?q=Ana', 'GET', undefined, bo)).data.totals.count, 0);
  const boMeta = (await call('/api/meta', 'GET', undefined, bo)).data;
  assert.ok(!boMeta.categories.expense.some((c) => c.name === 'Ana stuff'));
  assert.deepEqual(boMeta.months, []);
  assert.equal(boMeta.settings.currency, 'USD');
  assert.equal(boMeta.user.email, 'bo@example.com');
  assert.equal((await call('/api/summary?month=2026-07', 'GET', undefined, bo)).data.current.expense, 0);
  assert.equal((await call('/api/export.csv', 'GET', undefined, bo)).data, 'date,type,category,description,amount\r\n');

  // ...and can't touch it by id
  const id = mine.data.id;
  assert.equal((await call(`/api/transactions/${id}`, 'PUT', { date: '2026-07-01', type: 'expense', category: 'Travel', amount: 1 }, bo)).status, 404);
  assert.equal((await call(`/api/transactions/${id}`, 'DELETE', undefined, bo)).status, 404);
  assert.equal((await call('/api/categories/Ana%20stuff', 'DELETE', undefined, bo)).status, 404);

  // Bo can use the same category names independently
  assert.equal((await call('/api/categories', 'POST', { name: 'Ana stuff', type: 'income', icon: 'star' }, bo)).status, 201);
  assert.equal((await call('/api/categories/Travel', 'PUT', { name: 'Trips' }, bo)).status, 200);

  // Ana's data is untouched
  const still = (await call(`/api/transactions?category=Travel&month=2026-07`)).data.items;
  assert.deepEqual(still.map((t) => t.amount), [777]);
  assert.ok((await call('/api/meta')).data.categories.expense.some((c) => c.name === 'Travel'));
  await call('/api/settings', 'PUT', { currency: 'EUR' });
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
  assert.notEqual((await call('/..%2F.env')).status, 200);
});

test('demo seed fills a new account once', async () => {
  const demo = createMemoryStore();
  const { session } = await demo.auth.signUp('demo@example.com', 'password123');
  const repo = demo.forToken(session.accessToken);
  assert.equal(await seedDemo(repo, new Date(2026, 10, 15)), true);
  const n = (await repo.allTransactions()).length;
  assert.ok(n > 100);
  assert.equal((await repo.budgets()).get('Housing'), 150000);
  assert.equal((await repo.settings()).openingBalance, 850000);
  assert.equal(await seedDemo(repo, new Date(2026, 10, 15)), false);
  assert.equal((await repo.allTransactions()).length, n);
});

// ---------- the Supabase adapter, against a fake fetch ----------
const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

test('supabase: reads token claims but only trusts well-formed, unexpired user tokens', () => {
  const exp = Math.floor(Date.now() / 1000) + 600;
  assert.deepEqual(readClaims(jwt({ sub: 'u1', role: 'authenticated', email: 'a@b.co', exp })), { userId: 'u1', email: 'a@b.co' });
  assert.equal(readClaims(jwt({ sub: 'u1', role: 'anon', exp })), null);          // the publishable key itself
  assert.equal(readClaims(jwt({ sub: 'u1', role: 'authenticated', exp: 1 })), null); // expired
  assert.equal(readClaims('garbage'), null);
});

test('supabase: forwards the user token, maps errors, pages long results', async () => {
  const calls = [];
  const replies = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, ...init });
    const [status, body] = replies.shift() ?? [200, []];
    return new Response(body === null ? '' : JSON.stringify(body), { status });
  };
  const sb = createSupabaseStore({ url: 'https://example.supabase.co/', key: 'sb_publishable_test', fetch: fakeFetch });
  const repo = sb.forToken('user.jwt.token');

  replies.push([200, [{ name: 'Dining', type: 'expense', icon: 'utensils' }]]);
  assert.equal((await repo.categories())[0].name, 'Dining');
  const first = calls.at(-1);
  assert.equal(first.url, 'https://example.supabase.co/rest/v1/categories?select=name%2Ctype%2Cicon&order=position.asc');
  assert.equal(first.headers.apikey, 'sb_publishable_test');
  assert.equal(first.headers.Authorization, 'Bearer user.jwt.token');

  // transaction search goes through the tally_find function with null for unused filters
  replies.push([200, []]);
  await repo.find({ month: '2026-03', q: 'a,b)' }, 500);
  assert.match(calls.at(-1).url, /\/rest\/v1\/rpc\/tally_find\?select=.*&order=date.desc%2Cid.desc&limit=500$/);
  assert.deepEqual(JSON.parse(calls.at(-1).body), { p_month: '2026-03', p_type: null, p_category: null, p_q: 'a,b)' });

  // range() keeps reading while pages come back full
  replies.push([200, Array.from({ length: 1000 }, (_, i) => ({ id: i }))], [200, [{ id: 1000 }]]);
  assert.equal((await repo.range('2026-01-01', '2026-06-30')).length, 1001);
  assert.match(calls.at(-1).url, /offset=1000/);

  replies.push([401, { code: 'PGRST303', message: 'JWT expired' }]);
  await assert.rejects(repo.settings(), { status: 401 });
  replies.push([409, { code: '23505', message: 'duplicate key' }]);
  await assert.rejects(repo.addCategory({ name: 'X', type: 'expense', icon: 'dots' }), { status: 409 });

  // auth: sign-in hits the password grant with the publishable key and no user token
  replies.push([200, { access_token: 'a', refresh_token: 'r', expires_at: 2000000000, user: { email: 'x@y.co' } }]);
  assert.deepEqual(await sb.auth.signIn('x@y.co', 'pw'),
    { accessToken: 'a', refreshToken: 'r', expiresAt: 2000000000000, email: 'x@y.co' });
  assert.equal(calls.at(-1).url, 'https://example.supabase.co/auth/v1/token?grant_type=password');
  assert.equal(calls.at(-1).headers.Authorization, undefined);
  replies.push([400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }]);
  await assert.rejects(sb.auth.signIn('x@y.co', 'bad'), { status: 400, message: 'Email or password is incorrect.' });
  // sign-up that needs email confirmation returns no session
  replies.push([200, { id: 'u', email: 'n@y.co' }]);
  assert.deepEqual(await sb.auth.signUp('n@y.co', 'password123'), { session: null });
  // a refused refresh token always means "sign in again", whatever code Supabase uses
  replies.push([400, { code: 400, error_code: 'validation_failed', msg: 'Refresh token is not valid' }]);
  await assert.rejects(sb.auth.refresh('bogus'), { status: 401 });
});
