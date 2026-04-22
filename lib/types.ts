export type Row = Record<string, unknown>

export interface PariySummary extends Row {
  total_unique: number; common_skus: number; only_timaurd: number; only_safari: number
  discount_removed: number; recent_months: string[]
  timaurd_total: number; timaurd_in_stock: number; timaurd_zero_stock: number
  safari_total: number; safari_in_stock: number; safari_zero_stock: number
  miss_eff_timaurd: number; miss_eff_safari: number
  eff_count_timaurd: number; eff_count_safari: number
  ineff_stock_total: number
}
export interface MonthlyActive extends Row { warehouse: string; month: string; active_skus: number }
export interface CatParity extends Row { category: string; timaurd_count: number; safari_count: number }
export interface EfficientSku extends Row {
  warehouse: string; sku: string; product_name: string
  cat_l1: string; cat_l2: string; unit_price: number
  total_qty: number; recent_qty: number; total_rev: number; recent_rev: number
  months_active: number; avg_monthly_qty: number; recent_margin: number; stock_on_hand: number
}
export interface MissingEfficient extends Row {
  missing_from: string; sku: string; product_name: string
  cat_l1: string; recent_qty: number; recent_rev: number; total_qty: number; avg_monthly_qty: number
}
export interface InefficientStock extends Row {
  warehouse: string; sku: string; product_name: string
  cat_l1: string; cat_l2: string; stock_on_hand: number
  total_qty_ever: number; last_month_sold: string | null
  avg_monthly_qty: number; months_listed: number
}
export interface NosalesSku extends Row {
  warehouse: string; sku: string; product_name: string
  cat_l1: string; cat_l2: string; total_qty_ever: number; last_month_sold: string | null
}
