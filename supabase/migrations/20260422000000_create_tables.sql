-- Assortment Parity Dashboard tables

create table if not exists parity_summary (
  id int primary key default 1,
  total_unique int, common_skus int, only_timaurd int, only_safari int,
  discount_removed int, recent_months text[],
  timaurd_total int, timaurd_in_stock int, timaurd_zero_stock int,
  safari_total int, safari_in_stock int, safari_zero_stock int,
  miss_eff_timaurd int, miss_eff_safari int,
  eff_count_timaurd int, eff_count_safari int,
  ineff_stock_total int
);

create table if not exists monthly_active (
  id serial primary key,
  warehouse text, month text, active_skus int
);

create table if not exists cat_parity (
  id serial primary key,
  category text, timaurd_count int, safari_count int
);

create table if not exists efficient_skus (
  id serial primary key,
  warehouse text, sku text, product_name text,
  cat_l1 text, cat_l2 text, unit_price numeric,
  total_qty int, recent_qty int, total_rev numeric, recent_rev numeric,
  months_active int, avg_monthly_qty numeric,
  recent_margin numeric, stock_on_hand int
);

create table if not exists missing_efficient (
  id serial primary key,
  missing_from text, sku text, product_name text,
  cat_l1 text, recent_qty int, recent_rev numeric,
  total_qty int, avg_monthly_qty numeric
);

create table if not exists inefficient_stock (
  id serial primary key,
  warehouse text, sku text, product_name text,
  cat_l1 text, cat_l2 text, stock_on_hand int,
  total_qty_ever int, last_month_sold text,
  avg_monthly_qty numeric, months_listed int
);

create table if not exists nosales_skus (
  id serial primary key,
  warehouse text, sku text, product_name text,
  cat_l1 text, cat_l2 text,
  total_qty_ever int, last_month_sold text
);

-- Enable public read via RLS (anon key can read)
alter table parity_summary enable row level security;
alter table monthly_active enable row level security;
alter table cat_parity enable row level security;
alter table efficient_skus enable row level security;
alter table missing_efficient enable row level security;
alter table inefficient_stock enable row level security;
alter table nosales_skus enable row level security;

create policy "public read" on parity_summary for select using (true);
create policy "public read" on monthly_active for select using (true);
create policy "public read" on cat_parity for select using (true);
create policy "public read" on efficient_skus for select using (true);
create policy "public read" on missing_efficient for select using (true);
create policy "public read" on inefficient_stock for select using (true);
create policy "public read" on nosales_skus for select using (true);
