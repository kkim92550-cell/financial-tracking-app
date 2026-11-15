-- Covering index for the budgets -> categories foreign key (performance advisor).
create index budgets_user_category_type on public.budgets (user_id, category, type);
