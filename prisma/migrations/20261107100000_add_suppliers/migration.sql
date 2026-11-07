-- BoutiquePro: supplier directory, isolated by shop.
CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY,
  "shopId" uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "legacyId" bigint,
  name text NOT NULL,
  phone text,
  email text,
  address text,
  notes text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL
);
CREATE UNIQUE INDEX suppliers_shopId_id_key ON public.suppliers("shopId", id);
CREATE UNIQUE INDEX suppliers_shopId_legacyId_key ON public.suppliers("shopId", "legacyId");
CREATE INDEX suppliers_shopId_name_idx ON public.suppliers("shopId", name);
CREATE INDEX suppliers_shopId_phone_idx ON public.suppliers("shopId", phone);
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_manage_suppliers" ON public.suppliers FOR ALL TO authenticated
  USING (public.is_shop_member("shopId"))
  WITH CHECK (public.is_shop_member("shopId"));
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.suppliers TO authenticated;
