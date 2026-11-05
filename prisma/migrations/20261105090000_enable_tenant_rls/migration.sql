-- BoutiquePro — Row Level Security (RLS)
-- This migration is intentionally not executed against Supabase yet.
-- It assumes Supabase Auth and that shop_memberships.user_id stores auth.users.id.

-- Membership lookup helpers run with the migration owner so the membership
-- lookup does not recurse through shop_memberships RLS. Keep search_path empty
-- and schema-qualify every referenced object.
CREATE OR REPLACE FUNCTION public.is_shop_member(target_shop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shop_memberships AS membership
    WHERE membership.\"shopId\" = target_shop_id
      AND membership.\"userId\" = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.is_shop_manager(target_shop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shop_memberships AS membership
    WHERE membership.\"shopId\" = target_shop_id
      AND membership.\"userId\" = (SELECT auth.uid())
      AND membership.role IN ('OWNER'::public."MembershipRole", 'MANAGER'::public."MembershipRole")
  );
$$;

REVOKE ALL ON FUNCTION public.is_shop_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_shop_manager(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_shop_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_shop_manager(uuid) TO authenticated;

-- Enable RLS on every table that contains tenant data or membership data.
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

-- A user can read shops where they are a member. Only owners/managers can
-- update the shop profile. Shop creation and membership changes stay server-side.
DROP POLICY IF EXISTS "shop_members_can_read_their_shops" ON public.shops;
CREATE POLICY "shop_members_can_read_their_shops"
  ON public.shops FOR SELECT TO authenticated
  USING (public.is_shop_member(id));

DROP POLICY IF EXISTS "shop_managers_can_update_their_shops" ON public.shops;
CREATE POLICY "shop_managers_can_update_their_shops"
  ON public.shops FOR UPDATE TO authenticated
  USING (public.is_shop_manager(id))
  WITH CHECK (public.is_shop_manager(id));

-- Members can see the membership list for their own shop. No client-side
-- INSERT/UPDATE/DELETE policy is created: invitations and role changes must
-- go through a trusted server-side flow.
DROP POLICY IF EXISTS "shop_members_can_read_memberships" ON public.shop_memberships;
CREATE POLICY "shop_members_can_read_memberships"
  ON public.shop_memberships FOR SELECT TO authenticated
  USING (public.is_shop_member(\"shopId\"));

-- All authenticated members can work with operational records belonging to
-- their shop. Fine-grained STAFF/MANAGER/OWNER permissions are a later layer.
DROP POLICY IF EXISTS "members_manage_products" ON public.products;
CREATE POLICY "members_manage_products"
  ON public.products FOR ALL TO authenticated
  USING (public.is_shop_member(\"shopId\"))
  WITH CHECK (public.is_shop_member(\"shopId\"));

DROP POLICY IF EXISTS "members_manage_customers" ON public.customers;
CREATE POLICY "members_manage_customers"
  ON public.customers FOR ALL TO authenticated
  USING (public.is_shop_member(\"shopId\"))
  WITH CHECK (public.is_shop_member(\"shopId\"));

DROP POLICY IF EXISTS "members_manage_sales" ON public.sales;
CREATE POLICY "members_manage_sales"
  ON public.sales FOR ALL TO authenticated
  USING (public.is_shop_member(\"shopId\"))
  WITH CHECK (public.is_shop_member(\"shopId\"));

DROP POLICY IF EXISTS "members_manage_sale_items" ON public.sale_items;
CREATE POLICY "members_manage_sale_items"
  ON public.sale_items FOR ALL TO authenticated
  USING (public.is_shop_member(\"shopId\"))
  WITH CHECK (public.is_shop_member(\"shopId\"));

DROP POLICY IF EXISTS "members_manage_stock_movements" ON public.stock_movements;
CREATE POLICY "members_manage_stock_movements"
  ON public.stock_movements FOR ALL TO authenticated
  USING (public.is_shop_member(\"shopId\"))
  WITH CHECK (public.is_shop_member(\"shopId\"));

DROP POLICY IF EXISTS "members_manage_credit_payments" ON public.credit_payments;
CREATE POLICY "members_manage_credit_payments"
  ON public.credit_payments FOR ALL TO authenticated
  USING (public.is_shop_member(\"shopId\"))
  WITH CHECK (public.is_shop_member(\"shopId\"));

DROP POLICY IF EXISTS "members_manage_expenses" ON public.expenses;
CREATE POLICY "members_manage_expenses"
  ON public.expenses FOR ALL TO authenticated
  USING (public.is_shop_member(\"shopId\"))
  WITH CHECK (public.is_shop_member(\"shopId\"));

-- Important deployment notes:
-- 1. Run only after the Prisma schema migration has created these tables/enums.
-- 2. Apply via a trusted migration role, never from a browser.
-- 3. Keep the Supabase service-role key server-only; it bypasses RLS.
-- 4. This establishes tenant membership isolation, not complete role-based
--    permissions or business-rule validation. Add those before production.


-- Supabase Data API table privileges. RLS remains the row-level gate.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.shops,
  public.shop_memberships,
  public.products,
  public.customers,
  public.sales,
  public.sale_items,
  public.stock_movements,
  public.credit_payments,
  public.expenses
TO authenticated;

-- Atomic shop onboarding. The browser cannot choose an owner user_id:
-- the owner is always the verified Supabase Auth identity (auth.uid()).
CREATE OR REPLACE FUNCTION public.create_shop_for_current_user(
  p_name text,
  p_slug text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id uuid;
  new_shop_id uuid;
  clean_name text;
  clean_slug text;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  clean_name := btrim(p_name);
  clean_slug := lower(btrim(p_slug));

  IF clean_name IS NULL OR char_length(clean_name) < 2 OR char_length(clean_name) > 100 THEN
    RAISE EXCEPTION 'Shop name must contain between 2 and 100 characters';
  END IF;

  IF clean_slug IS NULL OR clean_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR char_length(clean_slug) > 80 THEN
    RAISE EXCEPTION 'Invalid shop slug';
  END IF;

  INSERT INTO public.shops (id, name, slug, "updatedAt")
  VALUES (gen_random_uuid(), clean_name, clean_slug, now())
  RETURNING id INTO new_shop_id;

  INSERT INTO public.shop_memberships (id, \"shopId\", \"userId\", role, "updatedAt")
  VALUES (gen_random_uuid(), new_shop_id, current_user_id, 'OWNER'::public."MembershipRole", now());

  RETURN new_shop_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_shop_for_current_user(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_shop_for_current_user(text, text) TO authenticated;
