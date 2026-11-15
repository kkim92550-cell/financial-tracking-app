-- Tally schema for Supabase (Postgres). Applied to the `tally` project with the Supabase MCP
-- `apply_migration` tool; keep this file in step with what is deployed.
--
-- Every row belongs to one auth user (`user_id`, defaulting to auth.uid()). Row Level Security
-- limits each signed-in user to their own rows; the anon role gets no table access at all.
-- Money is integer minor units (cents) in bigint columns. Dates are plain `date`s (no time zone).

-- ---------- tables ----------
create table public.categories (
  user_id  uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  name     text   not null check (char_length(name) between 1 and 30),
  type     text   not null check (type in ('income', 'expense')),
  icon     text   not null check (icon ~ '^[a-z0-9-]{1,24}$'),
  position bigint generated always as identity,
  primary key (user_id, name),
  -- target of the (user_id, category, type) foreign keys below, so a transaction's category
  -- always exists and always has the transaction's type
  unique (user_id, name, type)
);
-- Names are unique per user, case-insensitively and across both types.
create unique index categories_user_lower_name on public.categories (user_id, lower(name));

create table public.transactions (
  id       bigint generated always as identity primary key,
  user_id  uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  date     date   not null,
  type     text   not null check (type in ('income', 'expense')),
  category text   not null,
  note     text   not null default '' check (char_length(note) <= 200),
  amount   bigint not null check (amount > 0 and amount <= 10000000000000),
  -- renaming a category carries its transactions along; deleting a used one is refused
  foreign key (user_id, category, type) references public.categories (user_id, name, type) on update cascade
);
create index transactions_user_date on public.transactions (user_id, date desc, id desc);
create index transactions_user_category on public.transactions (user_id, category, type);

create table public.budgets (
  user_id       uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  category      text   not null,
  type          text   not null default 'expense' check (type = 'expense'),
  monthly_limit bigint not null check (monthly_limit > 0 and monthly_limit <= 10000000000000),
  primary key (user_id, category),
  foreign key (user_id, category, type) references public.categories (user_id, name, type)
    on update cascade on delete cascade
);

create table public.settings (
  user_id         uuid   primary key default auth.uid() references auth.users (id) on delete cascade,
  currency        text   not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  opening_balance bigint not null default 0 check (abs(opening_balance) <= 10000000000000)
);

-- ---------- privileges & row level security ----------
revoke all on public.categories, public.transactions, public.budgets, public.settings from anon, public;
grant select, insert, update, delete on public.categories, public.transactions, public.budgets, public.settings to authenticated;

alter table public.categories   enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets      enable row level security;
alter table public.settings     enable row level security;

create policy "own categories" on public.categories for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own transactions" on public.transactions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own budgets" on public.budgets for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own settings" on public.settings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------- functions (SECURITY INVOKER: they run as the caller, so RLS still applies) ----------

-- Months (YYYY-MM) that have transactions, newest first.
create function public.tally_months()
returns setof text language sql stable security invoker set search_path = '' as $$
  select m from (
    select distinct to_char(t.date, 'YYYY-MM') as m from public.transactions t
    where t.user_id = (select auth.uid())
  ) s order by m desc;
$$;

-- How many transactions use each category.
create function public.tally_category_counts()
returns table (category text, n bigint) language sql stable security invoker set search_path = '' as $$
  select t.category, count(*) from public.transactions t
  where t.user_id = (select auth.uid()) group by t.category;
$$;

-- Net (income minus expenses) of everything dated before p_date.
create function public.tally_net_before(p_date date)
returns bigint language sql stable security invoker set search_path = '' as $$
  select coalesce(sum(case t.type when 'income' then t.amount else -t.amount end), 0)::bigint
  from public.transactions t where t.user_id = (select auth.uid()) and t.date < p_date;
$$;

-- Transactions matching the Transactions page filters. Any argument may be null.
-- p_q matches a case-insensitive substring of the description or category (no wildcards).
create function public.tally_find(p_month text, p_type text, p_category text, p_q text)
returns setof public.transactions language sql stable security invoker set search_path = '' as $$
  select t.* from public.transactions t
  where t.user_id = (select auth.uid())
    and (p_month is null or (t.date >= to_date(p_month, 'YYYY-MM')
                             and t.date < (to_date(p_month, 'YYYY-MM') + interval '1 month')::date))
    and (p_type is null or t.type = p_type)
    and (p_category is null or t.category = p_category)
    and (p_q is null or strpos(lower(t.note), lower(p_q)) > 0 or strpos(lower(t.category), lower(p_q)) > 0);
$$;

-- Income/expense totals and counts for the same filters.
create function public.tally_find_totals(p_month text, p_type text, p_category text, p_q text)
returns table (type text, total bigint, n bigint) language sql stable security invoker set search_path = '' as $$
  select f.type, sum(f.amount)::bigint, count(*) from public.tally_find(p_month, p_type, p_category, p_q) f
  group by f.type;
$$;

-- Delete a category, first moving its transactions to p_move_to (same type; enforced by the
-- foreign key). One function call is one database transaction, so it is all or nothing.
-- Returns how many transactions moved.
create function public.tally_delete_category(p_name text, p_move_to text)
returns integer language plpgsql volatile security invoker set search_path = '' as $$
declare moved integer := 0;
begin
  if p_move_to is not null then
    update public.transactions set category = p_move_to
    where user_id = (select auth.uid()) and category = p_name;
    get diagnostics moved = row_count;
  end if;
  delete from public.categories where user_id = (select auth.uid()) and name = p_name;
  return moved;
end;
$$;

revoke execute on function public.tally_months(), public.tally_category_counts(), public.tally_net_before(date),
  public.tally_find(text, text, text, text), public.tally_find_totals(text, text, text, text),
  public.tally_delete_category(text, text) from public, anon;
grant execute on function public.tally_months(), public.tally_category_counts(), public.tally_net_before(date),
  public.tally_find(text, text, text, text), public.tally_find_totals(text, text, text, text),
  public.tally_delete_category(text, text) to authenticated;
