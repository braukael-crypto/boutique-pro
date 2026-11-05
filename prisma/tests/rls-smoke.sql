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

INSERT INTO public.sales (id, "shopId", total, "paymentMethod", "updatedAt")
VALUES
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 150, 'CASH', now()),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 250, 'CASH', now());

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
  IF (SELECT count(*) FROM public.sales) <> 1 THEN
    RAISE EXCEPTION 'RLS failure: user can see another shop sale';
  END IF;

  -- Financial records must not be editable or deletable by ordinary members.
  UPDATE public.sales
    SET total = 999
    WHERE id = '50000000-0000-4000-8000-000000000001';
  IF (SELECT total FROM public.sales WHERE id = '50000000-0000-4000-8000-000000000001') <> 150 THEN
    RAISE EXCEPTION 'RLS failure: sale history can be modified';
  END IF;

  DELETE FROM public.sales
    WHERE id = '50000000-0000-4000-8000-000000000001';
  IF (SELECT count(*) FROM public.sales WHERE id = '50000000-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'RLS failure: sale history can be deleted';
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
