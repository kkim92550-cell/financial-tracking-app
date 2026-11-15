// In-memory storage with the same interface as store/supabase.js. Used by the tests and by
// `TALLY_STORE=memory` for working offline. Nothing is persisted: a restart starts empty.
// It mimics what Postgres does for the Supabase store: data is per user (row level security),
// renames cascade, and a category that transactions still use can't be deleted.
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { HttpError, SIGN_IN_AGAIN } from './errors.js';

const ACCESS_TTL = 60 * 60 * 1000;
const byNewest = (a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1);
const byOldest = (a, b) => -byNewest(a, b);
const pick = ({ id, date, type, category, note, amount }) => ({ id, date, type, category, note, amount });

export function createMemoryStore({ accessTtl = ACCESS_TTL } = {}) {
  const users = new Map();    // email -> { id, salt, hash }
  const access = new Map();   // access token -> { userId, email, expiresAt }
  const refresh = new Map();  // refresh token -> { userId, email }
  const data = new Map();     // userId -> { categories, txns, budgets, settings }
  let nextId = 1;
  let nextPos = 1;

  const hash = (password, salt) => scryptSync(password, salt, 32);
  function issue(user) {
    const accessToken = randomBytes(24).toString('hex');
    const refreshToken = randomBytes(24).toString('hex');
    const expiresAt = Date.now() + accessTtl;
    access.set(accessToken, { userId: user.id, email: user.email, expiresAt });
    refresh.set(refreshToken, { userId: user.id, email: user.email });
    return { accessToken, refreshToken, expiresAt, email: user.email };
  }

  const auth = {
    async signIn(email, password) {
      const user = users.get(email.toLowerCase());
      const ok = user && timingSafeEqual(hash(password, user.salt), user.hash);
      if (!ok) throw new HttpError(400, 'Email or password is incorrect.');
      return issue(user);
    },
    async signUp(email, password) {
      const key = email.toLowerCase();
      if (users.has(key)) throw new HttpError(409, 'An account with this email already exists.');
      const salt = randomBytes(16);
      const user = { id: randomUUID(), email: key, salt, hash: hash(password, salt) };
      users.set(key, user);
      return { session: issue(user) };
    },
    async refresh(token) {
      const r = refresh.get(token);
      if (!r) throw new HttpError(401, SIGN_IN_AGAIN);
      refresh.delete(token); // refresh tokens are single use, as in Supabase
      return issue({ id: r.userId, email: r.email });
    },
    async signOut(token) {
      const a = access.get(token);
      if (!a) return;
      for (const [k, v] of access) if (v.userId === a.userId) access.delete(k);
      for (const [k, v] of refresh) if (v.userId === a.userId) refresh.delete(k);
    },
    verify(token) {
      const a = access.get(token);
      if (!a || a.expiresAt <= Date.now()) return null;
      return { userId: a.userId, email: a.email };
    },
  };

  function forToken(token) {
    const claims = auth.verify(token);
    const mine = () => {
      if (!claims || !access.has(token)) throw new HttpError(401, SIGN_IN_AGAIN); // signed out meanwhile
      if (!data.has(claims.userId)) {
        data.set(claims.userId, { categories: [], txns: [], budgets: new Map(), settings: { currency: 'USD', openingBalance: 0 } });
      }
      return data.get(claims.userId);
    };
    const cat = (name) => mine().categories.find((c) => c.name === name);
    const checkCategory = (t) => {
      if (cat(t.category)?.type !== t.type) throw new HttpError(409, 'That category no longer exists.');
    };
    const matches = (f) => (t) => (!f.month || t.date.slice(0, 7) === f.month)
      && (!f.type || t.type === f.type)
      && (!f.category || t.category === f.category)
      && (!f.q || t.note.toLowerCase().includes(f.q.toLowerCase()) || t.category.toLowerCase().includes(f.q.toLowerCase()));

    return {
      async categories() {
        return mine().categories.slice().sort((a, b) => a.position - b.position).map(({ name, type, icon }) => ({ name, type, icon }));
      },
      async categoryCounts() {
        const m = new Map();
        for (const t of mine().txns) m.set(t.category, (m.get(t.category) ?? 0) + 1);
        return m;
      },
      async addCategories(list) {
        for (const c of list) if (!cat(c.name)) mine().categories.push({ ...c, position: nextPos++ });
      },
      async addCategory(c) {
        if (mine().categories.some((x) => x.name.toLowerCase() === c.name.toLowerCase())) throw new HttpError(409, 'That already exists.');
        mine().categories.push({ ...c, position: nextPos++ });
      },
      async updateCategory(name, change) {
        const c = cat(name);
        if (!c) return false;
        const d = mine();
        if (change.name !== undefined && change.name !== name) {
          for (const t of d.txns) if (t.category === name) t.category = change.name;
          if (d.budgets.has(name)) { d.budgets.set(change.name, d.budgets.get(name)); d.budgets.delete(name); }
          c.name = change.name;
        }
        if (change.icon !== undefined) c.icon = change.icon;
        return true;
      },
      async deleteCategory(name, moveTo) {
        const d = mine();
        let moved = 0;
        if (moveTo != null) {
          const target = cat(moveTo);
          const used = d.txns.filter((t) => t.category === name);
          if (used.length && (!target || used.some((t) => t.type !== target.type))) throw new HttpError(409, 'That category no longer exists.');
          for (const t of used) { t.category = moveTo; moved++; }
        }
        if (d.txns.some((t) => t.category === name)) throw new HttpError(409, 'That category no longer exists.');
        d.budgets.delete(name);
        d.categories = d.categories.filter((c) => c.name !== name);
        return moved;
      },

      async settings() { return { ...mine().settings }; },
      async saveSettings(change) {
        const s = mine().settings;
        if (change.currency !== undefined) s.currency = change.currency;
        if (change.openingBalance !== undefined) s.openingBalance = change.openingBalance;
      },

      async budgets() { return new Map(mine().budgets); },
      async setBudget(category, limit) {
        if (limit === 0) mine().budgets.delete(category);
        else mine().budgets.set(category, limit);
      },

      async find(filter, limit) { return mine().txns.filter(matches(filter)).sort(byNewest).slice(0, limit).map(pick); },
      async findTotals(filter) {
        const out = new Map();
        for (const t of mine().txns.filter(matches(filter))) {
          const r = out.get(t.type) ?? { type: t.type, total: 0, n: 0 };
          r.total += t.amount; r.n++;
          out.set(t.type, r);
        }
        return [...out.values()];
      },
      async range(from, to) { return mine().txns.filter((t) => t.date >= from && t.date <= to).sort(byOldest).map(pick); },
      async recent(to, limit) { return mine().txns.filter((t) => t.date <= to).sort(byNewest).slice(0, limit).map(pick); },
      async allTransactions() { return mine().txns.slice().sort(byOldest).map(pick); },
      async netBefore(date) {
        return mine().txns.reduce((sum, t) => (t.date < date ? sum + (t.type === 'income' ? t.amount : -t.amount) : sum), 0);
      },
      async months() { return [...new Set(mine().txns.map((t) => t.date.slice(0, 7)))].sort().reverse(); },

      async getTxn(id) { const t = mine().txns.find((x) => x.id === id); return t ? pick(t) : null; },
      async addTxn(t) {
        checkCategory(t);
        const row = { id: nextId++, ...t };
        mine().txns.push(row);
        return pick(row);
      },
      async addTxns(list) { for (const t of list) await this.addTxn(t); },
      async updateTxn(id, t) {
        const row = mine().txns.find((x) => x.id === id);
        if (!row) return null;
        checkCategory(t);
        Object.assign(row, t);
        return pick(row);
      },
      async deleteTxn(id) {
        const d = mine();
        const row = d.txns.find((x) => x.id === id);
        if (!row) return null;
        d.txns = d.txns.filter((x) => x !== row);
        return pick(row);
      },
    };
  }

  return { kind: 'memory', auth, forToken };
}
