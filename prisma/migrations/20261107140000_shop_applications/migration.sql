-- BoutiquePro: customer shop-opening requests.
-- Apply this migration in Supabase SQL Editor before deploying this feature.
CREATE TABLE IF NOT EXISTS public.shop_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  "shopName" text NOT NULL,
  "contactName" text NOT NULL,
  phone text NOT NULL,
  email text NOT NULL,
  address text,
  plan text NOT NULL CHECK (plan IN ('ESSENTIAL','STANDARD','PREMIUM','ENTERPRISE')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','UNDER_REVIEW','REJECTED','APPROVED')),
  "adminNote" text,
  "reviewedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shop_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_read_own_shop_application" ON public.shop_applications;
CREATE POLICY "users_read_own_shop_application"
  ON public.shop_applications FOR SELECT TO authenticated
  USING ("userId" = (SELECT auth.uid()));
DROP POLICY IF EXISTS "users_create_own_shop_application" ON public.shop_applications;
CREATE POLICY "users_create_own_shop_application"
  ON public.shop_applications FOR INSERT TO authenticated
  WITH CHECK ("userId" = (SELECT auth.uid()) AND status = 'PENDING');
GRANT SELECT, INSERT ON public.shop_applications TO authenticated;
GRANT ALL ON public.shop_applications TO service_role;
CREATE INDEX IF NOT EXISTS shop_applications_status_created_idx
  ON public.shop_applications(status, "createdAt" DESC);
NOTIFY pgrst, 'reload schema';
