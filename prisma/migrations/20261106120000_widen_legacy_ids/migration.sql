-- JavaScript Date.now() identifiers are 13-digit values and exceed PostgreSQL INTEGER.
-- Widen all legacy identifiers before importing existing IndexedDB records.
ALTER TABLE public.products
  ALTER COLUMN "legacyId" TYPE bigint;
ALTER TABLE public.customers
  ALTER COLUMN "legacyId" TYPE bigint;
ALTER TABLE public.sales
  ALTER COLUMN "legacyId" TYPE bigint;
ALTER TABLE public.stock_movements
  ALTER COLUMN "legacyId" TYPE bigint;
ALTER TABLE public.credit_payments
  ALTER COLUMN "legacyId" TYPE bigint;
ALTER TABLE public.expenses
  ALTER COLUMN "legacyId" TYPE bigint;
