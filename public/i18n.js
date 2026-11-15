// Interface language. Every piece of UI text lives in a dictionary here (English) or in
// i18n-km.js (Khmer); app.js and index.html only refer to keys.
//
// Dictionary values are plain text with {placeholders}. A few contain a little trusted markup
// (only <b>…</b>) and are rendered with th(), whose parameters the caller has already escaped.
// Keys ending in `.one` / `.other` are plural forms, picked by tn().

import KM from './i18n-km.js';

export const LANGS = [{ code: 'en', label: 'English' }, { code: 'km', label: 'ខ្មែរ' }];

export const EN = {
  // document / navigation
  'doc.title': 'Tally — personal finance',
  'nav.main': 'Main',
  'nav.overview': 'Overview',
  'nav.transactions': 'Transactions',
  'nav.budgets': 'Budgets',
  'nav.categories': 'Categories',
  'nav.settings': 'Settings',
  'nav.theme': 'Toggle theme',
  'nav.addTxn': 'Add transaction',

  // shared
  'common.income': 'Income',
  'common.expense': 'Expense',
  'common.expenses': 'Expenses',
  'common.net': 'Net',
  'common.balance': 'Balance',
  'common.type': 'Type',
  'common.month': 'Month',
  'common.category': 'Category',
  'common.cancel': 'Cancel',
  'common.undo': 'Undo',
  'common.edit': 'Edit {name}',
  'common.delete': 'Delete {name}',
  'common.today': 'Today',
  'common.yesterday': 'Yesterday',
  'common.new': 'New',
  'common.prevMonth': 'Previous month',
  'common.nextMonth': 'Next month',
  'common.transactions.one': '{count} transaction',
  'common.transactions.other': '{count} transactions',

  // budget status lines (under each progress meter)
  'budget.over': 'Over by {amount}',
  'budget.used': '{pct}% used — {amount} left',

  // charts
  'chart.cashflowAria': 'Income and expenses for the last six months',
  'chart.bandAria': '{month}: income {income}, expenses {expense}',
  'chart.balanceAria': 'Balance over the last six months, ending at {amount}',

  // overview page
  'overview.sub': 'Your money in {month}, as of {date}.',
  'overview.thisMonth': '{amount} this month',        // amount is wrapped in <b>
  'overview.savingsRate': 'Savings rate',
  'overview.cashflow': 'Cash flow',
  'overview.spending': 'Spending by category',
  'overview.total': '{amount} total',
  'overview.noSpending': 'No spending yet',
  'overview.noSpendingHint': 'Expenses you add this month show up here.',
  'overview.manage': 'Manage',
  'overview.spentOf': '{spent} of {limit}',            // spent is wrapped in <b>
  'overview.noBudgets': 'No budgets set',
  'overview.noBudgetsHint': 'Set monthly limits on the Budgets page.',
  'overview.recent': 'Recent transactions',
  'overview.viewAll': 'View all',
  'overview.empty': 'Nothing here yet',
  'overview.emptyHint': 'Add your first transaction to get started.',
  // comparisons with the previous month, shown under each figure; {month} is a short month name
  'delta.noData': 'No data for {month}',
  'delta.same': 'Same as {month}',
  'delta.vs': '{change} vs {month}',                   // change is e.g. "▲ 4.2%", wrapped in <b>
  'delta.pts': '{n} pts',                              // percentage points
  'delta.noIncome': 'No income recorded',

  // transactions page
  'txns.sub.month.one': '{count} entry in {month}.',
  'txns.sub.month.other': '{count} entries in {month}.',
  'txns.sub.all.one': '{count} entry across all time.',
  'txns.sub.all.other': '{count} entries across all time.',
  'txns.export': 'Export CSV',
  'txns.search': 'Search descriptions…',
  'txns.searchAria': 'Search transactions',
  'txns.allTime': 'All time',
  'txns.allTypes': 'All types',
  'txns.allCategories': 'All categories',
  'txns.colDate': 'Date',
  'txns.colNote': 'Description',
  'txns.colAmount': 'Amount',
  'txns.colActions': 'Actions',
  'txns.truncated': 'Showing the 500 most recent — narrow the filters to see older entries.',
  'txns.noMatch': 'No transactions match these filters',
  'txns.noMatchHint': 'Try a different month, type, or search term.',
  'txns.none': 'No transactions yet',
  'txns.noneHint': 'Add your first one to start tracking.',

  // budgets page
  'budgets.sub': 'Monthly limits by category for {month}.',
  'budgets.budgeted': 'Budgeted',
  'budgets.spentIn': 'Spent in budgeted categories',
  'budgets.left': 'Left to spend',
  'budgets.overBudget': 'Over budget',
  'budgets.colSpent': 'Spent',
  'budgets.colLimit': 'Monthly limit ({currency})',
  'budgets.colProgress': 'Progress',
  'budgets.noLimit': 'No limit',                       // placeholder of the empty limit input
  'budgets.noLimitSet': 'No limit set',
  'budgets.limitAria': 'Monthly limit for {name}',
  'budgets.setToast': '{name} budget set to {amount}',
  'budgets.removedToast': '{name} budget removed',

  // categories page
  'cats.sub': 'Group your money your way. Each category gets an icon so it’s easy to spot.',
  'cats.expense': 'Expense categories',
  'cats.income': 'Income categories',
  'cats.new': 'New category',
  'cats.builtIn': 'Built in',

  // load errors
  'error.page': 'Couldn’t load this page',
  'error.pageHint': 'Check that the Tally server is running, then',
  'error.reload': 'reload',
  'error.server': 'Couldn’t reach the Tally server',
  'error.request': 'Request failed ({status}).',

  // transaction dialog
  'txn.add': 'Add transaction',
  'txn.edit': 'Edit transaction',
  'txn.amount': 'Amount ({currency})',
  'txn.date': 'Date',
  'txn.note': 'Description',
  'txn.optional': 'optional',
  'txn.notePlaceholder': 'e.g. Weekly groceries',
  'txn.delete': 'Delete transaction',
  'txn.save': 'Save transaction',
  'txn.errAmount': 'Enter an amount greater than zero.',
  'txn.errDate': 'Choose a date.',
  'txn.errCategory': 'Choose a category.',
  'txn.added': 'Transaction added',
  'txn.updated': 'Transaction updated',
  'txn.deleted': 'Transaction deleted',
  'txn.restored': 'Transaction restored',

  // category dialogs
  'cat.new': 'New category',
  'cat.edit': 'Edit category',
  'cat.name': 'Name',
  'cat.namePlaceholder': 'e.g. Pets',
  'cat.icon': 'Icon',
  'cat.save': 'Save category',
  'cat.hintLocked': 'Built-in category: you can change its icon, but not its name.',
  'cat.hintType': 'The type can’t be changed once a category exists.',
  'cat.errName': 'Give the category a name.',
  'cat.errIcon': 'Choose an icon.',
  'cat.updated': 'Category updated',
  'cat.added': 'Category “{name}” added',
  'cat.deleteTitle': 'Delete category',
  'cat.moveTo': 'Move those transactions to',
  'cat.usedBy.one': '“{name}” is used by {count} transaction.',
  'cat.usedBy.other': '“{name}” is used by {count} transactions.',
  'cat.unused': 'Delete “{name}”? Nothing uses it yet.',
  'cat.budgetNote': 'Any budget set for it is removed too.',
  'cat.deleted': '“{name}” deleted',
  'cat.deletedMoved': '“{name}” deleted, {count} moved to “{target}”',

  // settings dialog
  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.appearance': 'Appearance',
  'settings.system': 'System',
  'settings.light': 'Light',
  'settings.dark': 'Dark',
  'settings.currency': 'Currency',
  'settings.opening': 'Opening balance',
  'settings.openingHint': 'What you had before your first tracked transaction.',
  'settings.save': 'Save settings',
  'settings.errOpening': 'Opening balance must be a number.',
  'settings.saved': 'Settings saved',

  // Built-in category names. Categories are stored by their English name; these are only how
  // the starting set is displayed. A category the user creates or renames shows as typed.
  'catname.Housing': 'Housing',
  'catname.Groceries': 'Groceries',
  'catname.Dining': 'Dining',
  'catname.Transport': 'Transport',
  'catname.Utilities': 'Utilities',
  'catname.Health': 'Health',
  'catname.Entertainment': 'Entertainment',
  'catname.Shopping': 'Shopping',
  'catname.Travel': 'Travel',
  'catname.Subscriptions': 'Subscriptions',
  'catname.Other': 'Other',
  'catname.Salary': 'Salary',
  'catname.Freelance': 'Freelance',
  'catname.Investments': 'Investments',
  'catname.Other income': 'Other income',

  // icon names (tooltip / screen-reader label in the icon picker)
  'icon.home': 'House', 'icon.bolt': 'Lightning bolt', 'icon.droplet': 'Water drop', 'icon.wifi': 'Wi-Fi',
  'icon.phone': 'Mobile phone', 'icon.receipt': 'Receipt', 'icon.bank': 'Bank', 'icon.cart': 'Shopping cart',
  'icon.utensils': 'Fork and knife', 'icon.coffee': 'Coffee cup', 'icon.car': 'Car', 'icon.bus': 'Bus',
  'icon.fuel': 'Fuel pump', 'icon.plane': 'Plane', 'icon.heart': 'Heart', 'icon.pulse': 'Heartbeat',
  'icon.dumbbell': 'Dumbbell', 'icon.ticket': 'Ticket', 'icon.music': 'Music', 'icon.gamepad': 'Game controller',
  'icon.book': 'Book', 'icon.cap': 'Graduation cap', 'icon.bag': 'Shopping bag', 'icon.shirt': 'Shirt',
  'icon.gift': 'Gift', 'icon.tag': 'Price tag', 'icon.repeat': 'Repeat', 'icon.paw': 'Paw print',
  'icon.leaf': 'Leaf', 'icon.shield': 'Shield', 'icon.smile': 'Smiling face', 'icon.star': 'Star',
  'icon.briefcase': 'Briefcase', 'icon.laptop': 'Laptop', 'icon.trend': 'Rising chart', 'icon.wallet': 'Wallet',
  'icon.coins': 'Coins', 'icon.dots': 'More',

  // Messages from the server (it always answers in English; see translateError below)
  'srv.nameLong': 'Name must be 30 characters or fewer.',
  'srv.nameChars': 'Name contains characters that are not allowed.',
  'srv.exists': 'A category named “{name}” already exists.',
  'srv.noRename': '“{name}” is built in and can’t be renamed.',
  'srv.noDelete': '“{name}” is built in and can’t be deleted.',
  'srv.moveRequired.one': '{count} transaction uses “{name}”. Choose a category to move them to.',
  'srv.moveRequired.other': '{count} transactions use “{name}”. Choose a category to move them to.',
  'srv.moveDifferent': 'Move them to a different category of the same type.',
  'srv.catGone': 'That category no longer exists.',
  'srv.txnGone': 'That transaction no longer exists.',
  'srv.badCategory': '“{name}” is not a valid category for this type.',
  'srv.noteLong': 'Description must be 200 characters or fewer.',
  'srv.badDate': 'Date must be a valid date.',
  'srv.badBudget': 'Budget must be zero or a positive amount.',
  'srv.badCurrency': 'Unsupported currency.',
  'srv.internal': 'Something went wrong on the server.',
};

const DICTS = { en: EN, km: KM };
const STORE_KEY = 'tally-lang';

function initialLang() {
  try { const saved = localStorage.getItem(STORE_KEY); if (DICTS[saved]) return saved; } catch { /* private mode */ }
  // First visit: follow the browser's preferred language.
  const preferred = (navigator.languages?.[0] || navigator.language || '').toLowerCase();
  return preferred.startsWith('km') ? 'km' : 'en';
}
let lang = initialLang();

export const getLang = () => lang;
export function setLang(code) {
  if (!DICTS[code]) return;
  lang = code;
  try { localStorage.setItem(STORE_KEY, code); } catch { /* private mode */ }
  applyStatic();
}

// Locale handed to Intl for numbers. Browsers (Chrome, Edge) ship no Khmer locale data, so
// Khmer uses Latin digits with US grouping ("$1,234.50"), as Cambodian banking apps do.
export const locale = () => (lang === 'km' ? 'en-US'
  : (navigator.language || '').toLowerCase().startsWith('en') ? navigator.language : 'en-US');
// Currency symbol style: in Khmer show "៛" / "$" rather than the ISO code en-US uses for riel.
export const currencyDisplay = () => (lang === 'km' ? 'narrowSymbol' : 'symbol');

// Dates. Khmer month and weekday names are written out here for the same reason.
const KM_MONTHS = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'];
const KM_DAYS = ['អាទិត្យ', 'ច័ន្ទ', 'អង្គារ', 'ពុធ', 'ព្រហស្បតិ៍', 'សុក្រ', 'សៅរ៍'];
const DATE_OPTS = {
  monthYear: { month: 'long', year: 'numeric' },
  month: { month: 'short' },
  day: { month: 'short', day: 'numeric' },
  dayYear: { month: 'short', day: 'numeric', year: 'numeric' },
  weekday: { weekday: 'long', month: 'short', day: 'numeric' },
  weekdayYear: { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' },
};
// kind: monthYear "វិច្ឆិកា 2026" · month "វិច្ឆិកា" · day "15 វិច្ឆិកា" · dayYear "15 វិច្ឆិកា 2026"
//       weekday "ថ្ងៃអាទិត្យ 15 វិច្ឆិកា" · weekdayYear (same, with the year)
export function fmtDate(d, kind) {
  if (lang !== 'km') return d.toLocaleDateString(locale(), DATE_OPTS[kind]);
  const M = KM_MONTHS[d.getMonth()], D = d.getDate(), Y = d.getFullYear();
  switch (kind) {
    case 'monthYear': return `${M} ${Y}`;
    case 'month': return M;
    case 'day': return `${D} ${M}`;
    case 'dayYear': return `${D} ${M} ${Y}`;
    case 'weekday': return `ថ្ងៃ${KM_DAYS[d.getDay()]} ${D} ${M}`;
    case 'weekdayYear': return `ថ្ងៃ${KM_DAYS[d.getDay()]} ${D} ${M} ${Y}`;
    default: throw new Error(`Unknown date format ${kind}`);
  }
}

const fill = (s, params, wrap) => s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? wrap(params[k]) : m));
const lookup = (key) => DICTS[lang][key] ?? EN[key] ?? key;
const escText = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Plain text. Escape the result (esc) before putting it into HTML.
export const t = (key, params = {}) => fill(lookup(key), params, String);
// Plural form: `${key}.one` when count is 1, otherwise `${key}.other`. Adds {count} to params.
export const tn = (key, count, params = {}) =>
  t(`${key}.${count === 1 ? 'one' : 'other'}`, { count: count.toLocaleString(locale()), ...params });
// HTML: the dictionary text is escaped, parameters are inserted as-is (callers pass escaped HTML).
export const th = (key, params = {}) => fill(escText(lookup(key)), params, String);

// Display name of a category. The starting categories are translated; everything else is user text.
export const catName = (name) => (lang === 'en' ? name : DICTS[lang][`catname.${name}`] ?? name);

// The server answers in English. Map the messages a user can actually run into onto keys.
const SERVER_ERRORS = [
  [/^Give the category a name\.$/, 'cat.errName'],
  [/^Name must be 30 characters or fewer\.$/, 'srv.nameLong'],
  [/^Name contains characters that are not allowed\.$/, 'srv.nameChars'],
  [/^A category named "(.+)" already exists\.$/, 'srv.exists', ['name']],
  [/^"(.+)" is built in and can't be renamed\.$/, 'srv.noRename', ['name']],
  [/^"(.+)" is built in and can't be deleted\.$/, 'srv.noDelete', ['name']],
  [/^(\d+) transactions? uses? "(.+)"\. Choose a category to move them to\.$/, 'srv.moveRequired', ['count', 'name']],
  [/^Move them to a different \w+ category\.$/, 'srv.moveDifferent'],
  [/^That category no longer exists\.$/, 'srv.catGone'],
  [/^That transaction no longer exists\.$/, 'srv.txnGone'],
  [/^"(.+)" is not a valid \w+ category\.$/, 'srv.badCategory', ['name']],
  [/^Unknown expense category\.$/, 'srv.catGone'],
  [/^Amount must be greater than zero\.$/, 'txn.errAmount'],
  [/^Description must be 200 characters or fewer\.$/, 'srv.noteLong'],
  [/^Date must be a valid YYYY-MM-DD date\.$/, 'srv.badDate'],
  [/^Choose an icon\.$/, 'cat.errIcon'],
  [/^Budget must be zero or a positive amount\.$/, 'srv.badBudget'],
  [/^Unsupported currency\.$/, 'srv.badCurrency'],
  [/^Opening balance must be a number\.$/, 'settings.errOpening'],
  [/^Something went wrong on the server\.$/, 'srv.internal'],
  [/^Request failed \((\d+)\)\.$/, 'error.request', ['status']],
];
export function translateError(message) {
  if (lang === 'en') return message;
  for (const [re, key, names = []] of SERVER_ERRORS) {
    const m = re.exec(message);
    if (!m) continue;
    const params = Object.fromEntries(names.map((n, i) => [n, m[i + 1]]));
    if (params.name) params.name = catName(params.name);
    if (params.count) return tn(key, Number(params.count), params);
    return t(key, params);
  }
  return message;
}

// Static text in index.html: data-i18n="key" sets the text, data-i18n-attr="attr:key; attr:key"
// sets attributes.
export function applyStatic(root = document) {
  document.documentElement.lang = lang;
  document.title = t('doc.title');
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  });
}
