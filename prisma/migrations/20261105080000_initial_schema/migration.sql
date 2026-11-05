-- Initial PostgreSQL schema generated to match prisma/schema.prisma.
CREATE TYPE public."MembershipRole" AS ENUM ('OWNER', 'MANAGER', 'STAFF');
CREATE TYPE public."PaymentMethod" AS ENUM ('CASH', 'MOBILE_MONEY', 'CREDIT');
CREATE TYPE public."StockMovementType" AS ENUM ('IN', 'OUT', 'ADJUSTMENT');

CREATE TABLE public.shops (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL,
  phone text,
  whatsapp text,
  address text,
  "logoUrl" text,
  currency text NOT NULL DEFAULT 'XOF',
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL
);
CREATE UNIQUE INDEX shops_slug_key ON public.shops(slug);

CREATE TABLE public.shop_memberships (
  id uuid PRIMARY KEY,
  "shopId" uuid NOT NULL,
  "userId" uuid NOT NULL,
  role public."MembershipRole" NOT NULL DEFAULT 'STAFF',
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT shop_memberships_shopId_fkey FOREIGN KEY ("shopId") REFERENCES public.shops(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX shop_memberships_shopId_userId_key ON public.shop_memberships("shopId", "userId");
CREATE INDEX shop_memberships_userId_idx ON public.shop_memberships("userId");

CREATE TABLE public.products (
  id uuid PRIMARY KEY,
  "shopId" uuid NOT NULL,
  "legacyId" integer,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'Autres',
  "purchasePrice" numeric(14,2) NOT NULL,
  "sellingPrice" numeric(14,2) NOT NULL,
  quantity integer NOT NULL DEFAULT 0,
  "minStock" integer NOT NULL DEFAULT 0,
  "archivedAt" timestamp(3),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT products_shopId_fkey FOREIGN KEY ("shopId") REFERENCES public.shops(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX products_shopId_id_key ON public.products("shopId", id);
CREATE UNIQUE INDEX products_shopId_legacyId_key ON public.products("shopId", "legacyId");
CREATE INDEX products_shopId_name_idx ON public.products("shopId", name);
CREATE INDEX products_shopId_archivedAt_idx ON public.products("shopId", "archivedAt");

CREATE TABLE public.customers (
  id uuid PRIMARY KEY,
  "shopId" uuid NOT NULL,
  "legacyId" integer,
  name text NOT NULL,
  phone text,
  address text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT customers_shopId_fkey FOREIGN KEY ("shopId") REFERENCES public.shops(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX customers_shopId_id_key ON public.customers("shopId", id);
CREATE UNIQUE INDEX customers_shopId_legacyId_key ON public.customers("shopId", "legacyId");
CREATE INDEX customers_shopId_name_idx ON public.customers("shopId", name);
CREATE INDEX customers_shopId_phone_idx ON public.customers("shopId", phone);

CREATE TABLE public.sales (
  id uuid PRIMARY KEY,
  "shopId" uuid NOT NULL,
  "legacyId" integer,
  "idempotencyKey" text,
  date timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total numeric(14,2) NOT NULL,
  "estimatedProfit" numeric(14,2) NOT NULL DEFAULT 0,
  "paymentMethod" public."PaymentMethod" NOT NULL,
  "customerId" uuid,
  "customerName" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sales_shopId_fkey FOREIGN KEY ("shopId") REFERENCES public.shops(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX sales_shopId_id_key ON public.sales("shopId", id);
CREATE UNIQUE INDEX sales_shopId_legacyId_key ON public.sales("shopId", "legacyId");
CREATE UNIQUE INDEX sales_shopId_idempotencyKey_key ON public.sales("shopId", "idempotencyKey");
CREATE INDEX sales_shopId_date_idx ON public.sales("shopId", date);
CREATE INDEX sales_shopId_customerId_idx ON public.sales("shopId", "customerId");

CREATE TABLE public.sale_items (
  id uuid PRIMARY KEY,
  "shopId" uuid NOT NULL,
  "saleId" uuid NOT NULL,
  "productId" uuid,
  "productName" text NOT NULL,
  quantity integer NOT NULL,
  "purchasePrice" numeric(14,2) NOT NULL,
  "sellingPrice" numeric(14,2) NOT NULL,
  subtotal numeric(14,2) NOT NULL,
  "estimatedProfit" numeric(14,2) NOT NULL DEFAULT 0,
  CONSTRAINT sale_items_shopId_saleId_fkey FOREIGN KEY ("shopId", "saleId") REFERENCES public.sales("shopId", id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX sale_items_shopId_saleId_idx ON public.sale_items("shopId", "saleId");
CREATE INDEX sale_items_shopId_productId_idx ON public.sale_items("shopId", "productId");

CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY,
  "shopId" uuid NOT NULL,
  "legacyId" integer,
  "productId" uuid,
  "productName" text NOT NULL,
  "saleId" uuid,
  type public."StockMovementType" NOT NULL,
  quantity integer NOT NULL,
  reason text NOT NULL,
  date timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "stockBefore" integer NOT NULL,
  "stockAfter" integer NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT stock_movements_shopId_fkey FOREIGN KEY ("shopId") REFERENCES public.shops(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX stock_movements_shopId_id_key ON public.stock_movements("shopId", id);
CREATE UNIQUE INDEX stock_movements_shopId_legacyId_key ON public.stock_movements("shopId", "legacyId");
CREATE INDEX stock_movements_shopId_productId_date_idx ON public.stock_movements("shopId", "productId", date);
CREATE INDEX stock_movements_shopId_date_idx ON public.stock_movements("shopId", date);

CREATE TABLE public.credit_payments (
  id uuid PRIMARY KEY,
  "shopId" uuid NOT NULL,
  "legacyId" integer,
  "saleId" uuid NOT NULL,
  "customerId" uuid,
  amount numeric(14,2) NOT NULL,
  date timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT credit_payments_shopId_saleId_fkey FOREIGN KEY ("shopId", "saleId") REFERENCES public.sales("shopId", id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX credit_payments_shopId_legacyId_key ON public.credit_payments("shopId", "legacyId");
CREATE INDEX credit_payments_shopId_saleId_date_idx ON public.credit_payments("shopId", "saleId", date);
CREATE INDEX credit_payments_shopId_customerId_idx ON public.credit_payments("shopId", "customerId");

CREATE TABLE public.expenses (
  id uuid PRIMARY KEY,
  "shopId" uuid NOT NULL,
  "legacyId" integer,
  label text NOT NULL,
  category text NOT NULL,
  amount numeric(14,2) NOT NULL,
  date timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT expenses_shopId_fkey FOREIGN KEY ("shopId") REFERENCES public.shops(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX expenses_shopId_legacyId_key ON public.expenses("shopId", "legacyId");
CREATE INDEX expenses_shopId_date_idx ON public.expenses("shopId", date);
CREATE INDEX expenses_shopId_category_idx ON public.expenses("shopId", category);
