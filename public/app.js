// Tally front end — vanilla ES module, no build step.
// All amounts travel as integer minor units (cents) and are formatted here.

import { ICON_KEYS, catSvg } from './icons.js';
import { LANGS, getLang, setLang, locale, currencyDisplay, fmtDate, t, tn, th, catName, translateError, applyStatic } from './i18n.js';

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  meta: null,
  month: null,
  filters: { month: '', type: '', category: '', q: '' },
  redraw: null,      // re-renders charts on resize
  editing: null,     // transaction being edited, or null when adding
  icons: new Map(),  // category name -> icon key, rebuilt from meta
  cats: null,        // category list with usage counts (Categories page)
  catEditing: null,  // category being edited, or null when adding
  catFromTxn: false, // category dialog was opened from the transaction dialog
};

// ---------- api ----------
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(translateError(data.error || `Request failed (${res.status}).`));
  return data;
}

// ---------- formatting ----------
let moneyFmt, compactFmt, axisFmt;
function setCurrency(code) {
  const base = { style: 'currency', currency: code, currencyDisplay: currencyDisplay() };
  moneyFmt = new Intl.NumberFormat(locale(), base);
  compactFmt = new Intl.NumberFormat(locale(), { ...base, notation: 'compact', maximumFractionDigits: 1 });
  axisFmt = new Intl.NumberFormat(locale(), { ...base, maximumFractionDigits: 0 });
}
const money = (cents) => moneyFmt.format(cents / 100);
const moneyAxis = (cents, compact) => (compact ? compactFmt : axisFmt).format(cents / 100);
const signed = (cents) => (cents > 0 ? '+' : cents < 0 ? '−' : '') + money(Math.abs(cents));
const toDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d || 1); };
const num = (n) => n.toLocaleString(locale());
const fixed1 = (n) => n.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const monthLong = (m) => fmtDate(toDate(m), 'monthYear');
const monthShort = (m) => fmtDate(toDate(m), 'month');
const dayShort = (s) => fmtDate(toDate(s), 'day');
const dayFull = (s) => fmtDate(toDate(s), 'dayYear');
function shiftMonth(month, delta) {
  const d = toDate(month); d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---------- shared UI bits ----------
const ICON = {
  plus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  edit: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13l.6-3L11 2.6a1.1 1.1 0 0 1 1.6 0l.8.8a1.1 1.1 0 0 1 0 1.6L6 12.4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  trash: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warn: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 15 14H1z" fill="currentColor"/><path d="M8 6.5v3.4M8 11.6v.4" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>',
  over: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M8 4.2v4.6M8 11v.6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>',
  download: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v7.5M4.8 7.2 8 10.4l3.2-3.2M3 13h10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const catIcon = (name) => catSvg(state.icons.get(name));
const catLabel = (name) => `<span class="with-ico">${catIcon(name)}<span>${esc(catName(name))}</span></span>`;
const catBadge = (icon) => `<span class="cat-badge">${catSvg(icon)}</span>`;

const stepper = () => `
  <div class="stepper" role="group" aria-label="${esc(t('common.month'))}">
    <button data-action="prev-month" aria-label="${esc(t('common.prevMonth'))}">‹</button>
    <span>${esc(monthLong(state.month))}</span>
    <button data-action="next-month" aria-label="${esc(t('common.nextMonth'))}">›</button>
  </div>`;
const addButton = () => `<button class="btn primary" data-action="add-txn">${ICON.plus}${esc(t('txn.add'))}</button>`;

function budgetState(spent, limit) {
  const pct = limit ? spent / limit : 0;
  if (pct > 1) return { cls: 'over', pct, text: `${ICON.over}${th('budget.over', { amount: esc(money(spent - limit)) })}` };
  const used = th('budget.used', { pct: num(Math.round(pct * 100)), amount: esc(money(limit - spent)) });
  if (pct >= 0.85) return { cls: 'near', pct, text: `${ICON.warn}${used}` };
  return { cls: 'ok', pct, text: used };
}

// On phones the table rows restyle into a native list: avatar, title, subtitle, amount.
// The avatar and subtitle are hidden on wider screens, where the table columns carry them.
function txnRow(txn, withActions) {
  const sign = txn.type === 'income' ? '+' : '−';
  const cat = catName(txn.category);
  const title = txn.note || cat;
  const sub = withActions ? cat : `${cat} · ${dayShort(txn.date)}`;
  return `<tr class="txn" data-id="${txn.id}">
    <td class="av" aria-hidden="true"><span class="avatar ${txn.type}">${catIcon(txn.category)}</span></td>
    <td class="date">${esc(withActions ? dayFull(txn.date) : dayShort(txn.date))}</td>
    <td class="note"><span class="title">${esc(title)}</span><span class="sub">${esc(sub)}</span></td>
    <td class="cat"><span class="chip">${catLabel(txn.category)}</span></td>
    <td class="amount ${txn.type}">${sign}${esc(money(txn.amount))}</td>
    ${withActions ? `<td class="actions"><div class="row-actions">
      <button class="icon-btn" data-action="edit-txn" data-id="${txn.id}" aria-label="${esc(t('common.edit', { name: title }))}">${ICON.edit}</button>
      <button class="icon-btn" data-action="delete-txn" data-id="${txn.id}" aria-label="${esc(t('common.delete', { name: title }))}">${ICON.trash}</button>
    </div></td>` : ''}
  </tr>`;
}

// Rows with a "Today" / "Yesterday" / "Monday, Nov 9" header before each new day.
// The header rows only show in the phone list layout.
function groupedRows(items) {
  const today = state.meta.today;
  const y = toDate(today); y.setDate(y.getDate() - 1);
  const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  const thisYear = today.slice(0, 4);
  const label = (d) => (d === today ? t('common.today') : d === yesterday ? t('common.yesterday')
    : fmtDate(toDate(d), d.startsWith(thisYear) ? 'weekday' : 'weekdayYear'));
  let last = '';
  return items.map((txn) => {
    const head = txn.date === last ? '' : `<tr class="day"><th colspan="6" scope="colgroup">${esc(label(txn.date))}</th></tr>`;
    last = txn.date;
    return head + txnRow(txn, true);
  }).join('');
}

// ---------- tooltip & toast ----------
const tip = $('#tip');
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let left = x + 14;
  if (left + r.width > innerWidth - 8) left = x - r.width - 14;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, Math.min(y - r.height / 2, innerHeight - r.height - 8))}px`;
}
const hideTip = () => { tip.hidden = true; };

const toastEl = $('#toast');
let toastTimer;
function toast(message, undo) {
  clearTimeout(toastTimer);
  toastEl.innerHTML = `<span>${esc(message)}</span>${undo ? `<button type="button">${esc(t('common.undo'))}</button>` : ''}`;
  toastEl.hidden = false;
  if (undo) $('button', toastEl).onclick = () => { toastEl.hidden = true; undo(); };
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, undo ? 7000 : 2600);
}

// ---------- charts ----------
// Each chart registers a function that clears its hover state; touch users dismiss
// a tooltip by tapping outside the chart (see the pointerdown listener below).
const chartResets = new Set();
const resetCharts = () => { chartResets.forEach((fn) => fn()); };

function niceScale(min, max, count = 4) {
  if (max === min) max = min + 1;
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
  return { lo, hi, ticks };
}

// Column with a rounded data-end and a square baseline.
function column(x, y, w, h) {
  if (h <= 0) return '';
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function drawCashflow(el, months) {
  const W = Math.max(280, el.clientWidth);
  const H = 240;
  const m = { l: 48, r: 4, t: 10, b: 26 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const peak = Math.max(1, ...months.flatMap((d) => [d.income, d.expense]));
  const { hi, ticks } = niceScale(0, peak);
  const compact = hi >= 1_000_000; // 10K in major units
  const y = (v) => m.t + ih - (v / hi) * ih;
  const band = iw / months.length;
  const bw = Math.min(20, Math.max(6, (band - 14) / 2));

  let svg = `<svg width="${W}" height="${H}" role="img" aria-label="${esc(t('chart.cashflowAria'))}">`;
  for (const tick of ticks) {
    svg += `<line class="${tick === 0 ? 'base-line' : 'grid-line'}" x1="${m.l}" x2="${W - m.r}" y1="${y(tick)}" y2="${y(tick)}"/>`;
    svg += `<text x="${m.l - 8}" y="${y(tick) + 4}" text-anchor="end">${esc(moneyAxis(tick, compact))}</text>`;
  }
  months.forEach((d, i) => {
    const cx = m.l + band * (i + 0.5);
    svg += `<rect class="band" data-i="${i}" tabindex="0" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}" rx="6" aria-label="${esc(t('chart.bandAria', { month: monthLong(d.month), income: money(d.income), expense: money(d.expense) }))}"/>`;
    svg += `<path d="${column(cx - bw - 1, y(d.income), bw, y(0) - y(d.income))}" fill="var(--series-1)" pointer-events="none"/>`;
    svg += `<path d="${column(cx + 1, y(d.expense), bw, y(0) - y(d.expense))}" fill="var(--series-2)" pointer-events="none"/>`;
    svg += `<text class="${i === months.length - 1 ? 'strong' : ''}" x="${cx}" y="${H - 6}" text-anchor="middle">${esc(monthShort(d.month))}</text>`;
  });
  el.innerHTML = svg + '</svg>';

  const bands = el.querySelectorAll('.band');
  const show = (node, x, yPos) => {
    const d = months[Number(node.dataset.i)];
    bands.forEach((b) => b.classList.toggle('on', b === node));
    showTip(`<div class="tip-title">${esc(monthLong(d.month))}</div>
      <div class="tip-row"><span><i style="background:var(--series-1)"></i>${esc(t('common.income'))}</span><b>${esc(money(d.income))}</b></div>
      <div class="tip-row"><span><i style="background:var(--series-2)"></i>${esc(t('common.expenses'))}</span><b>${esc(money(d.expense))}</b></div>
      <div class="tip-row total"><span>${esc(t('common.net'))}</span><b>${esc(signed(d.income - d.expense))}</b></div>`, x, yPos);
  };
  const clear = () => { bands.forEach((b) => b.classList.remove('on')); hideTip(); };
  chartResets.add(clear);
  bands.forEach((b) => {
    b.addEventListener('pointermove', (e) => show(b, e.clientX, e.clientY));
    // A finger lifting fires pointerleave; keep the tooltip until the next tap elsewhere.
    b.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') clear(); });
    b.addEventListener('focus', () => { const r = b.getBoundingClientRect(); show(b, r.right - 20, r.top + r.height / 2); });
    b.addEventListener('blur', clear);
  });
}

function drawBalance(el, points) {
  const W = Math.max(280, el.clientWidth);
  const H = 190;
  const m = { l: 48, r: 14, t: 10, b: 26 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const values = points.map((p) => p.balance);
  const { lo, hi, ticks } = niceScale(Math.min(...values), Math.max(...values), 3);
  const compact = Math.max(Math.abs(lo), Math.abs(hi)) >= 1_000_000;
  const x = (i) => m.l + (points.length > 1 ? (i / (points.length - 1)) * iw : iw / 2);
  const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;

  let svg = `<svg width="${W}" height="${H}" role="img" aria-label="${esc(t('chart.balanceAria', { amount: money(values.at(-1)) }))}">`;
  for (const tick of ticks) {
    svg += `<line class="grid-line" x1="${m.l}" x2="${W - m.r}" y1="${y(tick)}" y2="${y(tick)}"/>`;
    svg += `<text x="${m.l - 8}" y="${y(tick) + 4}" text-anchor="end">${esc(moneyAxis(tick, compact))}</text>`;
  }
  points.forEach((p, i) => {
    if (p.date.endsWith('-01') && x(i) < W - m.r - 16) {
      svg += `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : 'middle'}">${esc(monthShort(p.date))}</text>`;
    }
  });
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join('');
  const last = points.length - 1;
  svg += `<path d="${line}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  svg += `<line class="cross base-line" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>`;
  svg += `<circle class="dot" cx="${x(last)}" cy="${y(values[last])}" r="5" fill="var(--series-1)" stroke="var(--surface)" stroke-width="2"/>`;
  svg += `<rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/>`;
  el.innerHTML = svg + '</svg>';

  const cross = $('.cross', el);
  const dot = $('.dot', el);
  const hit = $('.hit', el);
  const place = (i) => { dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(values[i])); };
  hit.addEventListener('pointermove', (e) => {
    const box = hit.getBoundingClientRect();
    const i = Math.max(0, Math.min(last, Math.round(((e.clientX - box.left) / box.width) * last)));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    place(i);
    showTip(`<div class="tip-title">${esc(dayFull(points[i].date))}</div>
      <div class="tip-row"><span><i style="background:var(--series-1)"></i>${esc(t('common.balance'))}</span><b>${esc(money(values[i]))}</b></div>`, e.clientX, e.clientY);
  });
  const reset = () => { cross.setAttribute('visibility', 'hidden'); place(last); hideTip(); };
  chartResets.add(reset);
  hit.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') reset(); });
}

// ---------- views ----------
function deltaLine(cur, prev, upIsGood, prevLabel) {
  const month = esc(prevLabel);
  if (!prev) return `<span class="delta">${th('delta.noData', { month })}</span>`;
  const change = (cur - prev) / Math.abs(prev);
  if (Math.abs(change) < 0.0005) return `<span class="delta">${th('delta.same', { month })}</span>`;
  const up = change > 0;
  const good = up === upIsGood;
  const badge = `<b class="${good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${fixed1(Math.abs(change) * 100)}%</b>`;
  return `<span class="delta">${th('delta.vs', { change: badge, month })}</span>`;
}

async function renderOverview() {
  const s = await api(`/api/summary?month=${state.month}`);
  const prevLabel = monthShort(shiftMonth(state.month, -1));
  const net = s.current.income - s.current.expense;
  const rate = s.current.income ? net / s.current.income : null;
  const prevRate = s.previous.income ? (s.previous.income - s.previous.expense) / s.previous.income : null;
  const monthChange = s.balance - s.balancePrev;
  const totalSpent = s.current.expense;
  const top = s.byCategory.slice(0, 7);
  const budgets = s.budgets.filter((b) => b.limit > 0).sort((a, b) => b.spent / b.limit - a.spent / a.limit).slice(0, 5);

  const month = esc(prevLabel);
  let rateDelta = `<span class="delta">${th('delta.noIncome')}</span>`;
  if (rate !== null && prevRate !== null) {
    const pts = (rate - prevRate) * 100;
    const badge = `<b class="${pts > 0 ? 'good' : 'bad'}">${pts > 0 ? '▲' : '▼'} ${th('delta.pts', { n: fixed1(Math.abs(pts)) })}</b>`;
    rateDelta = Math.abs(pts) < 0.05 ? `<span class="delta">${th('delta.same', { month })}</span>`
      : `<span class="delta">${th('delta.vs', { change: badge, month })}</span>`;
  } else if (rate !== null) rateDelta = `<span class="delta">${th('delta.noData', { month })}</span>`;

  view.innerHTML = `
    <header class="page-head">
      <div><h1>${esc(t('nav.overview'))}</h1><p class="sub">${esc(t('overview.sub', { month: monthLong(state.month), date: dayShort(s.asOf) }))}</p></div>
      <div class="head-actions">${stepper()}${addButton()}</div>
    </header>
    <div class="grid">
      <section class="card span-8">
        <div class="label">${esc(t('common.balance'))}</div>
        <div class="hero-value">${esc(money(s.balance))}</div>
        <span class="delta">${th('overview.thisMonth', { amount: `<b class="${monthChange >= 0 ? 'good' : 'bad'}">${esc(signed(monthChange))}</b>` })}</span>
        <div class="chart" id="balance-chart" style="margin-top:14px"></div>
      </section>
      <div class="tiles span-4">
        <section class="card tile"><div class="label">${esc(t('common.income'))}</div><div class="tile-value">${esc(money(s.current.income))}</div>${deltaLine(s.current.income, s.previous.income, true, prevLabel)}</section>
        <section class="card tile"><div class="label">${esc(t('common.expenses'))}</div><div class="tile-value">${esc(money(s.current.expense))}</div>${deltaLine(s.current.expense, s.previous.expense, false, prevLabel)}</section>
        <section class="card tile"><div class="label">${esc(t('overview.savingsRate'))}</div><div class="tile-value">${rate === null ? '—' : `${fixed1(rate * 100)}%`}</div>${rateDelta}</section>
      </div>
      <section class="card span-7">
        <div class="card-head"><h2>${esc(t('overview.cashflow'))}</h2>
          <div class="legend"><span><i style="background:var(--series-1)"></i>${esc(t('common.income'))}</span><span><i style="background:var(--series-2)"></i>${esc(t('common.expenses'))}</span></div>
        </div>
        <div class="chart" id="cashflow-chart"></div>
      </section>
      <section class="card span-5">
        <div class="card-head"><h2>${esc(t('overview.spending'))}</h2><span class="hint">${esc(t('overview.total', { amount: money(totalSpent) }))}</span></div>
        ${top.length ? `<div class="cat-list">${top.map((c) => `
          <div class="cat-row" title="${esc(catName(c.category))}: ${esc(money(c.total))}">
            <span class="name">${catLabel(c.category)}</span>
            <div class="bar"><span style="width:${(c.total / top[0].total) * 100}%"></span></div>
            <span class="val num">${esc(money(c.total))}<small>${Math.round((c.total / totalSpent) * 100)}%</small></span>
          </div>`).join('')}</div>` : `<div class="empty"><b>${esc(t('overview.noSpending'))}</b>${esc(t('overview.noSpendingHint'))}</div>`}
      </section>
      <section class="card span-5">
        <div class="card-head"><h2>${esc(t('nav.budgets'))}</h2><a href="#/budgets">${esc(t('overview.manage'))}</a></div>
        ${budgets.length ? `<div class="budget-list">${budgets.map((b) => {
          const st = budgetState(b.spent, b.limit);
          return `<div class="${st.cls}">
            <div class="budget-top">${catLabel(b.category)}<span class="amt num">${th('overview.spentOf', { spent: `<b>${esc(money(b.spent))}</b>`, limit: esc(money(b.limit)) })}</span></div>
            <div class="meter"><span style="width:${Math.min(100, st.pct * 100)}%"></span></div>
            <div class="status">${st.text}</div>
          </div>`;
        }).join('')}</div>` : `<div class="empty"><b>${esc(t('overview.noBudgets'))}</b>${esc(t('overview.noBudgetsHint'))}</div>`}
      </section>
      <section class="card span-7">
        <div class="card-head"><h2>${esc(t('overview.recent'))}</h2><a href="#/transactions">${esc(t('overview.viewAll'))}</a></div>
        ${s.recent.length ? `<div class="table-wrap"><table class="recent"><tbody>${s.recent.map((txn) => txnRow(txn, false)).join('')}</tbody></table></div>`
          : `<div class="empty"><b>${esc(t('overview.empty'))}</b>${esc(t('overview.emptyHint'))}</div>`}
      </section>
    </div>`;

  state.items = s.recent;
  state.redraw = () => {
    chartResets.clear();
    drawBalance($('#balance-chart'), s.trend);
    drawCashflow($('#cashflow-chart'), s.months);
  };
  state.redraw();
}

async function renderTransactions() {
  const f = state.filters;
  // A category filter can outlive its category (renamed or deleted); drop it instead of showing nothing.
  const known = [...state.meta.categories.expense, ...state.meta.categories.income];
  if (f.category && !known.some((c) => c.name === f.category)) f.category = '';
  const params = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
  const data = await api(`/api/transactions?${params}`);
  const cats = known.map((c) => c.name);
  const months = [...new Set([state.meta.currentMonth, ...state.meta.months])].sort().reverse();
  const opt = (value, label, current) => `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`;
  const filtered = f.type || f.category || f.q || f.month;

  view.innerHTML = `
    <header class="page-head">
      <div><h1>${esc(t('nav.transactions'))}</h1><p class="sub">${esc(f.month ? tn('txns.sub.month', data.totals.count, { month: monthLong(f.month) }) : tn('txns.sub.all', data.totals.count))}</p></div>
      <div class="head-actions"><a class="btn" href="/api/export.csv" download>${ICON.download}${esc(t('txns.export'))}</a>${addButton()}</div>
    </header>
    <section class="card">
      <div class="toolbar">
        <input type="search" id="f-q" placeholder="${esc(t('txns.search'))}" aria-label="${esc(t('txns.searchAria'))}" value="${esc(f.q)}">
        <select id="f-month" aria-label="${esc(t('common.month'))}">${opt('', t('txns.allTime'), f.month)}${months.map((m) => opt(m, monthLong(m), f.month)).join('')}</select>
        <select id="f-type" aria-label="${esc(t('common.type'))}">${opt('', t('txns.allTypes'), f.type)}${opt('income', t('common.income'), f.type)}${opt('expense', t('common.expenses'), f.type)}</select>
        <select id="f-category" aria-label="${esc(t('common.category'))}">${opt('', t('txns.allCategories'), f.category)}${cats.map((c) => opt(c, catName(c), f.category)).join('')}</select>
      </div>
      ${data.items.length ? `<div class="table-wrap"><table>
        <thead><tr><th class="av"></th><th>${esc(t('txns.colDate'))}</th><th>${esc(t('txns.colNote'))}</th><th>${esc(t('common.category'))}</th><th class="amount">${esc(t('txns.colAmount'))}</th><th><span class="sr-only">${esc(t('txns.colActions'))}</span></th></tr></thead>
        <tbody>${groupedRows(data.items)}</tbody></table></div>
        <div class="totals"><span>${esc(t('common.income'))} <b>${esc(money(data.totals.income))}</b></span><span>${esc(t('common.expenses'))} <b>${esc(money(data.totals.expense))}</b></span><span>${esc(t('common.net'))} <b>${esc(signed(data.totals.income - data.totals.expense))}</b></span>${data.truncated ? `<span>${esc(t('txns.truncated'))}</span>` : ''}</div>`
        : `<div class="empty"><b>${esc(t(filtered ? 'txns.noMatch' : 'txns.none'))}</b>${esc(t(filtered ? 'txns.noMatchHint' : 'txns.noneHint'))}</div>`}
    </section>`;

  state.items = data.items;
  state.redraw = null;
  const bind = (id, key, event = 'change') => $(id).addEventListener(event, (e) => { f[key] = e.target.value; renderTransactions(); });
  bind('#f-month', 'month'); bind('#f-type', 'type'); bind('#f-category', 'category');
  let timer;
  $('#f-q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      f.q = e.target.value;
      await renderTransactions();
      const input = $('#f-q'); input.focus(); input.setSelectionRange(input.value.length, input.value.length);
    }, 220);
  });
}

async function renderBudgets() {
  const s = await api(`/api/summary?month=${state.month}`);
  const withLimit = s.budgets.filter((b) => b.limit > 0);
  const budgeted = withLimit.reduce((a, b) => a + b.limit, 0);
  const spent = withLimit.reduce((a, b) => a + b.spent, 0);
  const left = budgeted - spent;
  view.innerHTML = `
    <header class="page-head">
      <div><h1>${esc(t('nav.budgets'))}</h1><p class="sub">${esc(t('budgets.sub', { month: monthLong(state.month) }))}</p></div>
      <div class="head-actions">${stepper()}</div>
    </header>
    <div class="summary-strip">
      <section class="card tile"><div class="label">${esc(t('budgets.budgeted'))}</div><div class="tile-value">${esc(money(budgeted))}</div></section>
      <section class="card tile"><div class="label">${esc(t('budgets.spentIn'))}</div><div class="tile-value">${esc(money(spent))}</div></section>
      <section class="card tile"><div class="label">${esc(t(left >= 0 ? 'budgets.left' : 'budgets.overBudget'))}</div><div class="tile-value">${esc(money(Math.abs(left)))}</div></section>
    </div>
    <section class="card">
      <div class="table-wrap"><table class="budget-table">
        <thead><tr><th>${esc(t('common.category'))}</th><th class="amount">${esc(t('budgets.colSpent'))}</th><th class="amount">${esc(t('budgets.colLimit', { currency: state.meta.settings.currency }))}</th><th>${esc(t('budgets.colProgress'))}</th></tr></thead>
        <tbody>${s.budgets.map((b) => {
          const st = b.limit ? budgetState(b.spent, b.limit) : null;
          return `<tr class="${st ? st.cls : ''}">
            <td class="name">${catLabel(b.category)}</td>
            <td class="amount spent">${esc(money(b.spent))}</td>
            <td class="amount limit"><input type="number" min="0" step="1" inputmode="decimal" placeholder="${esc(t('budgets.noLimit'))}" data-budget="${esc(b.category)}" aria-label="${esc(t('budgets.limitAria', { name: catName(b.category) }))}" value="${b.limit ? b.limit / 100 : ''}"></td>
            <td class="prog">${st ? `<div class="meter"><span style="width:${Math.min(100, st.pct * 100)}%"></span></div><div class="status">${st.text}</div>` : `<span class="status">${esc(t('budgets.noLimitSet'))}</span>`}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </section>`;
  state.redraw = null;
  view.querySelectorAll('[data-budget]').forEach((input) => {
    input.addEventListener('change', async () => {
      const limit = Math.round((parseFloat(input.value) || 0) * 100);
      try {
        await api(`/api/budgets/${encodeURIComponent(input.dataset.budget)}`, { method: 'PUT', body: { limit } });
        const name = catName(input.dataset.budget);
        toast(limit ? t('budgets.setToast', { name, amount: money(limit) }) : t('budgets.removedToast', { name }));
        renderBudgets();
      } catch (err) { toast(err.message); }
    });
  });
}

async function renderCategories() {
  const cats = state.cats = await api('/api/categories');
  const section = (type, title) => `
    <section class="card span-6">
      <div class="card-head"><h2>${esc(title)}</h2>
        <button class="btn" data-action="new-category" data-type="${type}">${ICON.plus}${esc(t('cats.new'))}</button></div>
      <ul class="cat-manage">${cats[type].map((c) => `
        <li>
          ${catBadge(c.icon)}
          <div class="cat-meta"><b>${esc(catName(c.name))}</b><span>${esc(tn('common.transactions', c.count))}${c.locked ? ` · ${esc(t('cats.builtIn'))}` : ''}</span></div>
          <div class="row-actions">
            <button class="icon-btn" data-action="edit-category" data-name="${esc(c.name)}" aria-label="${esc(t('common.edit', { name: catName(c.name) }))}">${ICON.edit}</button>
            ${c.locked ? '' : `<button class="icon-btn" data-action="delete-category" data-name="${esc(c.name)}" aria-label="${esc(t('common.delete', { name: catName(c.name) }))}">${ICON.trash}</button>`}
          </div>
        </li>`).join('')}</ul>
    </section>`;
  view.innerHTML = `
    <header class="page-head">
      <div><h1>${esc(t('nav.categories'))}</h1><p class="sub">${esc(t('cats.sub'))}</p></div>
    </header>
    <div class="grid start">${section('expense', t('cats.expense'))}${section('income', t('cats.income'))}</div>`;
  state.redraw = null;
}

const routes = { overview: renderOverview, transactions: renderTransactions, budgets: renderBudgets, categories: renderCategories };
const currentRoute = () => { const r = location.hash.replace(/^#\/?/, ''); return routes[r] ? r : 'overview'; };
async function render() {
  hideTip();
  chartResets.clear();
  const route = currentRoute();
  document.querySelectorAll('.nav a').forEach((a) => {
    if (a.dataset.route === route) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  try { await routes[route](); }
  catch (err) {
    view.innerHTML = `<div class="card empty"><b>${esc(t('error.page'))}</b>${esc(err.message)} ${esc(t('error.pageHint'))} <a href="" style="text-decoration:underline">${esc(t('error.reload'))}</a></div>`;
  }
}

// ---------- dialogs ----------
const txnDialog = $('#txn-dialog');
const txnForm = $('#txn-form');
// Icon + name cards, so the category you pick is recognisable at a glance. A native <select> can't show icons.
function fillCategories(type, selected) {
  const list = state.meta.categories[type];
  const pick = list.some((c) => c.name === selected) ? selected : list[0]?.name;
  $('#cat-picker').innerHTML = list.map((c) => `
    <label class="cat-opt"><input type="radio" name="category" value="${esc(c.name)}"${c.name === pick ? ' checked' : ''}>
      <span>${catSvg(c.icon)}<b>${esc(catName(c.name))}</b></span></label>`).join('')
    + `<button type="button" class="cat-opt add" data-action="new-category" data-from-txn="1">${ICON.plus}<b>${esc(t('common.new'))}</b></button>`;
}
function openTxnDialog(txn = null) {
  state.editing = txn;
  $('#txn-title').textContent = t(txn ? 'txn.edit' : 'txn.add');
  $('.form-error', txnForm).hidden = true;
  const type = txn?.type ?? 'expense';
  txnForm.type.value = type;
  fillCategories(type, txn?.category);
  txnForm.amount.value = txn ? (txn.amount / 100).toFixed(2) : '';
  txnForm.date.value = txn?.date ?? state.meta.today;
  txnForm.note.value = txn?.note ?? '';
  $('[data-action="delete-editing"]', txnForm).hidden = !txn;
  txnDialog.showModal();
  // On touch screens, opening the keyboard for an edit hides the sheet; only do it when adding.
  if (!txn || !coarse.matches) txnForm.amount.focus();
}
txnForm.addEventListener('change', (e) => { if (e.target.name === 'type') fillCategories(e.target.value); });
txnForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = $('.form-error', txnForm);
  const amount = Math.round(parseFloat(txnForm.amount.value) * 100);
  const fail = (msg, field) => { error.textContent = msg; error.hidden = false; field?.focus(); };
  if (!Number.isFinite(amount) || amount <= 0) return fail(t('txn.errAmount'), txnForm.amount);
  if (!txnForm.date.value) return fail(t('txn.errDate'), txnForm.date);
  const category = $('input[name="category"]:checked', txnForm)?.value;
  if (!category) return fail(t('txn.errCategory'));
  const body = { type: txnForm.type.value, amount, date: txnForm.date.value, category, note: txnForm.note.value };
  try {
    if (state.editing) await api(`/api/transactions/${state.editing.id}`, { method: 'PUT', body });
    else await api('/api/transactions', { method: 'POST', body });
    txnDialog.close();
    toast(t(state.editing ? 'txn.updated' : 'txn.added'));
    await refreshMeta();
    render();
  } catch (err) { fail(err.message); }
});

// ----- category dialogs -----
const catDialog = $('#cat-dialog');
const catForm = $('#cat-form');
function fillIconPicker(selected) {
  $('#icon-picker').innerHTML = ICON_KEYS.map((key) => `
    <label class="icon-opt" title="${esc(t(`icon.${key}`))}"><input type="radio" name="icon" value="${key}" aria-label="${esc(t(`icon.${key}`))}"${key === selected ? ' checked' : ''}>
      <span>${catSvg(key)}</span></label>`).join('');
}
// Opens for a new category (`category` null, `type` preselected) or to edit an existing one.
function openCategoryDialog({ category = null, type = 'expense', fromTxn = false } = {}) {
  state.catEditing = category;
  state.catFromTxn = fromTxn;
  $('#cat-title').textContent = t(category ? 'cat.edit' : 'cat.new');
  $('.form-error', catForm).hidden = true;
  const kind = category ? category.type : type;
  catForm.type.value = kind;
  catForm.querySelectorAll('input[name="type"]').forEach((r) => { r.disabled = !!category; });
  catForm.catName.value = category ? catName(category.name) : '';
  catForm.catName.disabled = !!category?.locked;
  const hint = $('#cat-hint');
  hint.hidden = !category;
  if (category) hint.textContent = t(category.locked ? 'cat.hintLocked' : 'cat.hintType');
  fillIconPicker(category?.icon ?? 'tag');
  catDialog.showModal();
  (catForm.catName.disabled ? $('input[name="icon"]:checked', catForm) : catForm.catName).focus();
}
catForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = $('.form-error', catForm);
  const fail = (msg, field) => { error.textContent = msg; error.hidden = false; field?.focus(); };
  const editing = state.catEditing;
  let name = catForm.catName.value.replace(/\s+/g, ' ').trim();
  const icon = $('input[name="icon"]:checked', catForm)?.value;
  if (!name) return fail(t('cat.errName'), catForm.catName);
  if (!icon) return fail(t('cat.errIcon'));
  // A built-in category is shown under its translated name; leaving that untouched is not a rename.
  if (editing && name === catName(editing.name)) name = editing.name;
  // A new name must not look the same as how another category is displayed.
  const all = [...state.meta.categories.expense, ...state.meta.categories.income];
  const clash = all.some((c) => c.name !== editing?.name && c.name !== name && catName(c.name).toLowerCase() === name.toLowerCase());
  if (clash) return fail(t('srv.exists', { name }), catForm.catName);
  try {
    if (editing) {
      await api(`/api/categories/${encodeURIComponent(editing.name)}`, { method: 'PUT', body: { name, icon } });
      if (state.filters.category === editing.name) state.filters.category = name;
    } else {
      await api('/api/categories', { method: 'POST', body: { name, type: catForm.type.value, icon } });
    }
    catDialog.close();
    await refreshMeta();
    toast(editing ? t('cat.updated') : t('cat.added', { name }));
    if (state.catFromTxn) fillCategories(catForm.type.value, name); // keep the transaction dialog going
    else render();
  } catch (err) { fail(err.message); }
});

const delDialog = $('#cat-delete-dialog');
const delForm = $('#cat-delete-form');
function openDeleteCategory(category) {
  state.catEditing = category;
  $('.form-error', delForm).hidden = true;
  const { count, type } = category;
  const name = catName(category.name);
  const budgetNote = type === 'expense' ? ` ${t('cat.budgetNote')}` : '';
  $('#cat-delete-text').textContent = (count ? tn('cat.usedBy', count, { name }) : t('cat.unused', { name })) + budgetNote;
  $('#cat-move-field').hidden = !count;
  const targets = state.cats[type].filter((c) => c.name !== category.name);
  delForm.moveTo.innerHTML = targets.map((c) => `<option value="${esc(c.name)}">${esc(catName(c.name))}</option>`).join('');
  delForm.moveTo.value = targets.find((c) => c.locked)?.name ?? targets[0]?.name ?? '';
  delDialog.showModal();
}
delForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const category = state.catEditing;
  const error = $('.form-error', delForm);
  const moveTo = category.count ? `?moveTo=${encodeURIComponent(delForm.moveTo.value)}` : '';
  try {
    await api(`/api/categories/${encodeURIComponent(category.name)}${moveTo}`, { method: 'DELETE' });
    if (state.filters.category === category.name) state.filters.category = '';
    delDialog.close();
    await refreshMeta();
    const name = catName(category.name);
    toast(category.count ? t('cat.deletedMoved', { name, count: num(category.count), target: catName(delForm.moveTo.value) }) : t('cat.deleted', { name }));
    render();
  } catch (err) { error.textContent = err.message; error.hidden = false; }
});

const settingsDialog = $('#settings-dialog');
const settingsForm = $('#settings-form');
function openSettings() {
  const { currencies, settings } = state.meta;
  settingsForm.currency.innerHTML = currencies.map((c) => `<option${c === settings.currency ? ' selected' : ''}>${c}</option>`).join('');
  settingsForm.openingBalance.value = (settings.openingBalance / 100).toFixed(2);
  $('.form-error', settingsForm).hidden = true;
  settingsForm.appearance.value = document.documentElement.dataset.theme || 'system';
  settingsForm.language.value = getLang();
  settingsForm.language.value = getLang();
  settingsDialog.showModal();
}
settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = $('.form-error', settingsForm);
  const opening = Math.round(parseFloat(settingsForm.openingBalance.value || '0') * 100);
  if (!Number.isFinite(opening)) { error.textContent = t('settings.errOpening'); error.hidden = false; return; }
  try {
    await api('/api/settings', { method: 'PUT', body: { currency: settingsForm.currency.value, openingBalance: opening } });
    settingsDialog.close();
    await refreshMeta();
    toast(t('settings.saved'));
    render();
  } catch (err) { error.textContent = err.message; error.hidden = false; }
});

// ---------- actions ----------
async function deleteTxn(id) {
  try {
    const removed = await api(`/api/transactions/${id}`, { method: 'DELETE' });
    await render();
    toast(t('txn.deleted'), async () => {
      const { date, type, category, note, amount } = removed;
      await api('/api/transactions', { method: 'POST', body: { date, type, category, note, amount } });
      toast(t('txn.restored'));
      render();
    });
  } catch (err) { toast(err.message); }
}

// Category from the Categories page data, with its type attached.
const findCat = (name) => {
  for (const type of ['expense', 'income']) {
    const c = state.cats[type].find((x) => x.name === name);
    if (c) return { ...c, type };
  }
};
// ---------- theme ----------
const coarse = matchMedia('(pointer: coarse)');
const osDark = matchMedia('(prefers-color-scheme: dark)');
// Keep the browser chrome (status bar, address bar) the same colour as the page.
function syncThemeColor() {
  const page = getComputedStyle(document.documentElement).getPropertyValue('--page').trim();
  if (page) $('meta[name="theme-color"]').content = page;
}
function setTheme(mode) {
  const root = document.documentElement;
  if (mode === 'system') delete root.dataset.theme; else root.dataset.theme = mode;
  try {
    if (mode === 'system') localStorage.removeItem('tally-theme'); else localStorage.setItem('tally-theme', mode);
  } catch { /* private mode */ }
  syncThemeColor();
  state.redraw?.();
}
osDark.addEventListener('change', syncThemeColor);
settingsForm.addEventListener('change', (e) => {
  if (e.target.name === 'appearance') setTheme(e.target.value);
  // Language applies at once, like appearance. It is a per-device preference, kept in localStorage.
  if (e.target.name === 'language') {
    setLang(e.target.value);
    applyCurrency();
    render();
  }
});
syncThemeColor();

// ---------- bottom sheets ----------
// On phones the dialogs are bottom sheets; dragging the top of one down dismisses it.
for (const dialog of [txnDialog, catDialog, delDialog, settingsDialog]) {
  let startY = null;
  let dy = 0;
  dialog.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || !matchMedia('(max-width: 760px)').matches) return;
    if (e.clientY - dialog.getBoundingClientRect().top > 64) return;  // only the grabber / title area
    startY = e.clientY; dy = 0;
    dialog.style.transition = 'none';
  });
  dialog.addEventListener('pointermove', (e) => {
    if (startY === null) return;
    dy = Math.max(0, e.clientY - startY);
    dialog.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (startY === null) return;
    startY = null;
    dialog.style.transition = '';
    if (dy > 90) {
      dialog.style.transform = 'translateY(100%)';
      setTimeout(() => { dialog.close(); dialog.style.transform = ''; }, 200);
    } else dialog.style.transform = '';
  };
  dialog.addEventListener('pointerup', end);
  dialog.addEventListener('pointercancel', end);
  // Tapping the dimmed backdrop closes the sheet, as on native platforms.
  dialog.addEventListener('click', (e) => {
    const r = dialog.getBoundingClientRect();
    const outside = e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right;
    if (e.target === dialog && outside) dialog.close();
  });
}

document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch' && !e.target.closest('.chart')) resetCharts();
});

document.addEventListener('click', (e) => {
  const row = e.target.closest('tr.txn');
  if (row && !e.target.closest('button, a, input, select')) {
    const txn = state.items?.find((t) => t.id === Number(row.dataset.id));
    if (txn) openTxnDialog(txn);
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const id = Number(el.dataset.id);
  switch (el.dataset.action) {
    case 'delete-editing': {
      const target = state.editing;
      txnDialog.close();
      if (target) deleteTxn(target.id);
      break;
    }
    case 'prev-month': state.month = shiftMonth(state.month, -1); render(); break;
    case 'next-month': state.month = shiftMonth(state.month, 1); render(); break;
    case 'add-txn': openTxnDialog(); break;
    case 'edit-txn': openTxnDialog(state.items?.find((t) => t.id === id)); break;
    case 'delete-txn': deleteTxn(id); break;
    case 'new-category':
      openCategoryDialog(el.dataset.fromTxn ? { type: txnForm.type.value, fromTxn: true } : { type: el.dataset.type });
      break;
    case 'edit-category': openCategoryDialog({ category: findCat(el.dataset.name) }); break;
    case 'delete-category': openDeleteCategory(findCat(el.dataset.name)); break;
    case 'settings': openSettings(); break;
    case 'close-dialog': el.closest('dialog').close(); break;
    case 'theme': {
      const root = document.documentElement;
      const dark = root.dataset.theme ? root.dataset.theme === 'dark' : osDark.matches;
      setTheme(dark ? 'light' : 'dark');
      break;
    }
  }
});

async function refreshMeta() {
  state.meta = await api('/api/meta');
  state.icons = new Map([...state.meta.categories.expense, ...state.meta.categories.income].map((c) => [c.name, c.icon]));
  applyCurrency();
}
// Number formatters and the currency shown in labels depend on both currency and language.
function applyCurrency() {
  const { currency } = state.meta.settings;
  setCurrency(currency);
  $('#txn-amount-label').textContent = t('txn.amount', { currency });
}

let resizeFrame;
new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => state.redraw?.());
}).observe(view);
addEventListener('hashchange', render);
addEventListener('scroll', hideTip, { passive: true });

// Language picker: each option is labelled in its own language.
$('#lang-options').innerHTML = LANGS.map((l) => `<label><input type="radio" name="language" value="${l.code}"><span lang="${l.code}">${esc(l.label)}</span></label>`).join('');
applyStatic();

try {
  await refreshMeta();
  state.month = state.meta.currentMonth;
  state.filters.month = state.meta.currentMonth;
  render();
} catch (err) {
  view.innerHTML = `<div class="card empty"><b>${esc(t('error.server'))}</b>${esc(err.message)}</div>`;
}
