// Supabase storage: Postgres through PostgREST, accounts through Supabase Auth, both over plain
// fetch (no SDK). Every data request carries the signed-in user's own access token, so Postgres
// row level security decides what each request can see and change; this file never holds a key
// that could bypass it. The schema lives in supabase/migrations/.
import { HttpError, SIGN_IN_AGAIN } from './errors.js';

const TXN_COLS = 'id,date,type,category,note,amount';
const PAGE = 1000; // PostgREST's default max rows per response

// Supabase Auth error codes -> messages the client knows how to translate.
const AUTH_ERRORS = {
  invalid_credentials: [400, 'Email or password is incorrect.'],
  email_not_confirmed: [403, 'Confirm your email address first, then sign in.'],
  user_already_exists: [409, 'An account with this email already exists.'],
  email_exists: [409, 'An account with this email already exists.'],
  weak_password: [400, 'Choose a stronger password (at least 8 characters).'],
  email_address_invalid: [400, 'Enter a valid email address.'],
  validation_failed: [400, 'Enter a valid email address.'],
  signup_disabled: [403, 'New sign-ups are turned off.'],
  over_request_rate_limit: [429, 'Too many attempts. Try again in a few minutes.'],
  over_email_send_rate_limit: [429, 'Too many attempts. Try again in a few minutes.'],
  refresh_token_not_found: [401, SIGN_IN_AGAIN],
  refresh_token_already_used: [401, SIGN_IN_AGAIN],
  session_not_found: [401, SIGN_IN_AGAIN],
  bad_jwt: [401, SIGN_IN_AGAIN],
};

// Reads the claims of an access token WITHOUT verifying its signature. That is fine here because
// the claims only steer this server (reject early, show the email); PostgREST verifies every
// token it is handed, and a forged one gets nothing.
export function readClaims(token) {
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (claims.role !== 'authenticated' || typeof claims.sub !== 'string') return null;
    if (!(claims.exp * 1000 > Date.now())) return null;
    return { userId: claims.sub, email: claims.email ?? '' };
  } catch { return null; }
}

const toSession = (s) => ({
  accessToken: s.access_token,
  refreshToken: s.refresh_token,
  expiresAt: (s.expires_at ? s.expires_at * 1000 : Date.now() + s.expires_in * 1000),
  email: s.user?.email ?? '',
});

export function createSupabaseStore({ url, key, fetch: fetchImpl = globalThis.fetch }) {
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set.');
  const base = url.replace(/\/+$/, '');

  async function request(path, { method = 'GET', token, body, headers = {} } = {}) {
    let res;
    try {
      res = await fetchImpl(base + path, {
        method,
        headers: {
          apikey: key,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      console.error('Supabase request failed:', err.message);
      throw new HttpError(502, 'Could not reach the database. Try again.');
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { res, data };
  }

  // ---------- auth ----------
  async function authCall(path, body, token) {
    const { res, data } = await request(`/auth/v1/${path}`, { method: 'POST', body, token });
    if (res.ok) return data;
    const code = data?.error_code ?? data?.code ?? data?.error;
    const known = AUTH_ERRORS[code];
    if (known) throw new HttpError(known[0], known[1]);
    if (res.status === 429) throw new HttpError(429, AUTH_ERRORS.over_request_rate_limit[1]);
    if (res.status === 401 || res.status === 403) throw new HttpError(401, SIGN_IN_AGAIN);
    console.error(`Supabase auth ${path} -> ${res.status}`, data?.msg ?? data?.message ?? '');
    throw new HttpError(502, 'Could not sign in right now. Try again.');
  }

  const auth = {
    async signIn(email, password) {
      return toSession(await authCall('token?grant_type=password', { email, password }));
    },
    // With email confirmation switched on, Supabase answers without a session: the user has to
    // follow the link in their inbox before they can sign in.
    async signUp(email, password) {
      const data = await authCall('signup', { email, password });
      return data?.access_token ? { session: toSession(data) } : { session: null };
    },
    // Any refusal of a refresh token (Supabase answers 400 with varying codes) means the session is over.
    async refresh(refreshToken) {
      try {
        return toSession(await authCall('token?grant_type=refresh_token', { refresh_token: refreshToken }));
      } catch (err) {
        if (err.status >= 400 && err.status < 500 && err.status !== 429) throw new HttpError(401, SIGN_IN_AGAIN);
        throw err;
      }
    },
    async signOut(token) {
      await authCall('logout', undefined, token).catch(() => {}); // the session may be gone already
    },
    verify: (token) => readClaims(token),
  };

  // ---------- data, as one signed-in user ----------
  function forToken(token) {
    async function rest(path, opts = {}) {
      const { res, data } = await request(`/rest/v1/${path}`, { ...opts, token });
      if (res.ok) return data;
      if (res.status === 401 || data?.code === 'PGRST301' || data?.code === 'PGRST303') throw new HttpError(401, SIGN_IN_AGAIN);
      // Constraint violations the server's own checks should already have caught; a race lands here.
      if (data?.code === '23505') throw new HttpError(409, 'That already exists.');
      if (data?.code === '23503') throw new HttpError(409, 'That category no longer exists.');
      console.error(`Supabase ${opts.method ?? 'GET'} ${path.split('?')[0]} -> ${res.status}`, data?.code ?? '', data?.message ?? '');
      throw new HttpError(502, 'Could not reach the database. Try again.');
    }
    const q = (params) => new URLSearchParams(params).toString();
    const rpc = (fn, args = {}, params) => rest(`rpc/${fn}${params ? `?${params}` : ''}`, { method: 'POST', body: args });
    const json = (prefer) => ({ Prefer: prefer });
    const filterArgs = (f) => ({ p_month: f.month || null, p_type: f.type || null, p_category: f.category || null, p_q: f.q || null });

    // Reads every page of a result. `params` must give a total order so pages don't overlap.
    async function all(table, params) {
      const out = [];
      for (let offset = 0; ; offset += PAGE) {
        const page = await rest(`${table}?${params}&limit=${PAGE}&offset=${offset}`);
        out.push(...page);
        if (page.length < PAGE) return out;
      }
    }

    return {
      categories: () => rest(`categories?${q({ select: 'name,type,icon', order: 'position.asc' })}`),
      async categoryCounts() {
        return new Map((await rpc('tally_category_counts')).map((r) => [r.category, r.n]));
      },
      addCategories: (list) => rest('categories?on_conflict=user_id,name', {
        method: 'POST', body: list, headers: json('resolution=ignore-duplicates,return=minimal'),
      }),
      addCategory: (c) => rest('categories', { method: 'POST', body: c, headers: json('return=minimal') }),
      // One UPDATE; the foreign keys cascade the new name to transactions and budgets.
      async updateCategory(name, change) {
        const rows = await rest(`categories?${q({ name: `eq.${name}`, select: 'name' })}`, {
          method: 'PATCH', body: change, headers: json('return=representation'),
        });
        return rows.length > 0;
      },
      deleteCategory: (name, moveTo) => rpc('tally_delete_category', { p_name: name, p_move_to: moveTo ?? null }),

      async settings() {
        const [row] = await rest('settings?select=currency,opening_balance');
        return { currency: row?.currency ?? 'USD', openingBalance: row?.opening_balance ?? 0 };
      },
      async saveSettings({ currency, openingBalance }) {
        const body = {};
        if (currency !== undefined) body.currency = currency;
        if (openingBalance !== undefined) body.opening_balance = openingBalance;
        await rest('settings?on_conflict=user_id', {
          method: 'POST', body, headers: json('resolution=merge-duplicates,return=minimal'),
        });
      },

      async budgets() {
        return new Map((await rest('budgets?select=category,monthly_limit')).map((r) => [r.category, r.monthly_limit]));
      },
      setBudget: (category, limit) => (limit === 0
        ? rest(`budgets?${q({ category: `eq.${category}` })}`, { method: 'DELETE' })
        : rest('budgets?on_conflict=user_id,category', {
          method: 'POST', body: { category, monthly_limit: limit }, headers: json('resolution=merge-duplicates,return=minimal'),
        })),

      find: (filter, limit) => rpc('tally_find', filterArgs(filter), q({ select: TXN_COLS, order: 'date.desc,id.desc', limit })),
      findTotals: (filter) => rpc('tally_find_totals', filterArgs(filter)),
      range: (from, to) => all('transactions',
        `${q({ select: TXN_COLS, order: 'date.asc,id.asc' })}&date=gte.${from}&date=lte.${to}`),
      recent: (to, limit) => rest(`transactions?${q({ select: TXN_COLS, order: 'date.desc,id.desc', limit })}&date=lte.${to}`),
      allTransactions: () => all('transactions', q({ select: TXN_COLS, order: 'date.asc,id.asc' })),
      netBefore: async (date) => Number(await rpc('tally_net_before', { p_date: date })),
      months: () => rpc('tally_months'),

      async getTxn(id) {
        const [row] = await rest(`transactions?${q({ select: TXN_COLS, id: `eq.${id}` })}`);
        return row ?? null;
      },
      async addTxn(t) {
        const [row] = await rest(`transactions?select=${TXN_COLS}`, { method: 'POST', body: t, headers: json('return=representation') });
        return row;
      },
      addTxns: (list) => rest('transactions', { method: 'POST', body: list, headers: json('return=minimal') }),
      async updateTxn(id, t) {
        const [row] = await rest(`transactions?${q({ select: TXN_COLS, id: `eq.${id}` })}`, {
          method: 'PATCH', body: t, headers: json('return=representation'),
        });
        return row ?? null;
      },
      async deleteTxn(id) {
        const [row] = await rest(`transactions?${q({ select: TXN_COLS, id: `eq.${id}` })}`, {
          method: 'DELETE', headers: json('return=representation'),
        });
        return row ?? null;
      },
    };
  }

  return { kind: 'supabase', auth, forToken };
}
