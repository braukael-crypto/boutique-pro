-- BoutiquePro — harden tenant permissions and preserve financial history.
-- This migration replaces broad FOR ALL policies with explicit operations.
-- It is safe to apply after 20261105090000_enable_tenant_rls.

-- Operational catalog: members may maintain products and customers in their shop.
DROP POLICY IF EXISTS "members_manage_products" ON public.products;
CREATE POLICY "members_read_products"
  ON public.products FOR SELECT TO authenticated
  USING (public.is_shop_member("shopId"));
CREATE POLICY "members_insert_products"
  ON public.products FOR INSERT TO authenticated
  WITH CHECK (public.is_shop_member("shopId"));
CREATE POLICY "members_update_products"
  ON public.products FOR UPDATE TO authenticated
  USING (public.is_shop_member("shopId"))
  WITH CHECK (public.is_shop_member("shopId"));
CREATE POLICY "members_delete_products"
  ON public.products FOR DELETE TO authenticated
  USING (public.is_shop_member("shopId"));

DROP POLICY IF EXISTS "members_manage_customers" ON public.customers;
CREATE POLICY "members_read_customers"
  ON public.customers FOR SELECT TO authenticated
  USING (public.is_shop_member("shopId"));
CREATE POLICY "members_insert_customers"
  ON public.customers FOR INSERT TO authenticated
  WITH CHECK (public.is_shop_member("shopId"));
CREATE POLICY "members_update_customers"
  ON public.customers FOR UPDATE TO authenticated
  USING (public.is_shop_member("shopId"))
  WITH CHECK (public.is_shop_member("shopId"));
CREATE POLICY "members_delete_customers"
  ON public.customers FOR DELETE TO authenticated
  USING (public.is_shop_member("shopId"));

-- Sales and their line items are append-only for authenticated shop members.
-- Corrections must later be represented by explicit reversals, not edits/deletes.
DROP POLICY IF EXISTS "members_manage_sales" ON public.sales;
CREATE POLICY "members_read_sales"
  ON public.sales FOR SELECT TO authenticated
  USING (public.is_shop_member("shopId"));
CREATE POLICY "members_insert_sales"
  ON public.sales FOR INSERT TO authenticated
  WITH CHECK (public.is_shop_member("shopId"));

DROP POLICY IF EXISTS "members_manage_sale_items" ON public.sale_items;
CREATE POLICY "members_read_sale_items"
  ON public.sale_items FOR SELECT TO authenticated
  USING (public.is_shop_member("shopId"));
CREATE POLICY "members_insert_sale_items"
  ON public.sale_items FOR INSERT TO authenticated
  WITH CHECK (public.is_shop_member("shopId"));

-- Credit repayments and stock movements are append-only audit records.
DROP POLICY IF EXISTS "members_manage_credit_payments" ON public.credit_payments;
CREATE POLICY "members_read_credit_payments"
  ON public.credit_payments FOR SELECT TO authenticated
  USING (public.is_shop_member("shopId"));
CREATE POLICY "members_insert_credit_payments"
  ON public.credit_payments FOR INSERT TO authenticated
  WITH CHECK (public.is_shop_member("shopId"));

DROP POLICY IF EXISTS "members_manage_stock_movements" ON public.stock_movements;
CREATE POLICY "members_read_stock_movements"
  ON public.stock_movements FOR SELECT TO authenticated
  USING (public.is_shop_member("shopId"));
CREATE POLICY "members_insert_stock_movements"
  ON public.stock_movements FOR INSERT TO authenticated
  WITH CHECK (public.is_shop_member("shopId"));

-- Expenses are also append-only to preserve the accounting trail.
DROP POLICY IF EXISTS "members_manage_expenses" ON public.expenses;
CREATE POLICY "members_read_expenses"
  ON public.expenses FOR SELECT TO authenticated
  USING (public.is_shop_member("shopId"));
CREATE POLICY "members_insert_expenses"
  ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (public.is_shop_member("shopId"));

-- The shop profile remains editable only by owners and managers.
-- Membership rows remain read-only to clients; invitation/role management
-- must use a separately authorized server-side operation.
