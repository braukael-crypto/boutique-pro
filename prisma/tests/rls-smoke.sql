-- Smoke test for tenant isolation on the temporary CI PostgreSQL database.
INSERT INTO public.shops (id, name, slug, "updatedAt") VALUES
  ('10000000-0000-4000-8000-000000000001', 'Shop A', 'shop-a-test', now()),
  ('10000000-0000-4000-8000-000000000002', 'Shop B', 'shop-b-test', now());

INSERT INTO public.shop_memberships (id, "shopId", "userId", role, "updatedAt") VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'OWNER', now()),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'OWNER', now());

INSERT INTO public.products (id, "shopId", name, "purchasePrice", "sellingPrice", quantity, "minStock", "updatedAt") VALUES
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Produit A', 100, 150, 5, 1, now()),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Produit B', 200, 250, 8, 1, now());

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', false);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.shops) <> 1 THEN
    RAISE EXCEPTION 'RLS failure: user can see another shop';
  END IF;
  IF (SELECT count(*) FROM public.products) <> 1 THEN
    RAISE EXCEPTION 'RLS failure: user can see another shop product';
  END IF;

  BEGIN
    INSERT INTO public.products (id, "shopId", name, "purchasePrice", "sellingPrice", quantity, "minStock", "updatedAt")
    VALUES ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'Intrusion', 1, 2, 1, 0, now());
    RAISE EXCEPTION 'RLS failure: cross-tenant insert was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;
