-- Harden suppliers RLS: keep member read/create, restrict mutation/deletion to shop managers.
-- This does not widen access; it narrows the previous FOR ALL policy.

DROP POLICY IF EXISTS "members_manage_suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "members_read_suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "members_insert_suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "shop_managers_update_suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "shop_managers_delete_suppliers" ON public.suppliers;

CREATE POLICY "members_read_suppliers"
ON public.suppliers
FOR SELECT
TO authenticated
USING (public.is_shop_member("shopId"));

CREATE POLICY "members_insert_suppliers"
ON public.suppliers
FOR INSERT
TO authenticated
WITH CHECK (public.is_shop_member("shopId"));

CREATE POLICY "shop_managers_update_suppliers"
ON public.suppliers
FOR UPDATE
TO authenticated
USING (public.is_shop_manager("shopId"))
WITH CHECK (public.is_shop_manager("shopId"));

CREATE POLICY "shop_managers_delete_suppliers"
ON public.suppliers
FOR DELETE
TO authenticated
USING (public.is_shop_manager("shopId"));
