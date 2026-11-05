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

INSERT INTO public.customers (id, "shopId", name, "updatedAt") VALUES
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Client A', now()),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Client B', now());

INSERT INTO public.sales (id, "shopId", total, "paymentMethod")
VALUES
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 150, 'CASH'),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 250, 'CASH');

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

  -- A tenant-A sale cannot point to tenant-B customer.
  BEGIN
    INSERT INTO public.sales (id, "shopId", total, "paymentMethod", "customerId")
    VALUES ('50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 10, 'CASH', '60000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'RLS failure: cross-tenant customer reference was accepted';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  -- A tenant-A sale item cannot point to a tenant-B product.
  BEGIN
    INSERT INTO public.sale_items (id, "shopId", "saleId", "productId", "productName", quantity, "purchasePrice", "sellingPrice", subtotal)
    VALUES ('70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', 'Produit B', 1, 1, 2, 2);
    RAISE EXCEPTION 'RLS failure: cross-tenant sale item product was accepted';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  -- A tenant-A stock movement cannot point to a tenant-B product.
  BEGIN
    INSERT INTO public.stock_movements (id, "shopId", "productId", "productName", type, quantity, reason, "stockBefore", "stockAfter")
    VALUES ('80000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', 'Produit B', 'OUT', 1, 'Test', 2, 1);
    RAISE EXCEPTION 'RLS failure: cross-tenant stock movement product was accepted';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  -- A tenant-A credit payment cannot point to a tenant-B customer.
  BEGIN
    INSERT INTO public.credit_payments (id, "shopId", "saleId", "customerId", amount)
    VALUES ('90000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002', 1);
    RAISE EXCEPTION 'RLS failure: cross-tenant credit customer was accepted';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

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
