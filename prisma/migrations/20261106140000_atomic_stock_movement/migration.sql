-- BoutiquePro: atomic stock movement RPC.
-- The caller must be authenticated and belong to the supplied shop.
-- Product quantity and the immutable movement record commit or roll back together.

CREATE OR REPLACE FUNCTION public.apply_stock_movement(
  p_shop_id uuid,
  p_product_id uuid,
  p_legacy_id bigint,
  p_type public."StockMovementType",
  p_quantity integer,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  current_quantity integer;
  next_quantity integer;
  current_product_name text;
  movement_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_shop_member(p_shop_id) THEN
    RAISE EXCEPTION 'Shop access denied' USING ERRCODE = '42501';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be a positive integer' USING ERRCODE = '22023';
  END IF;

  IF p_type NOT IN ('IN'::public."StockMovementType", 'OUT'::public."StockMovementType") THEN
    RAISE EXCEPTION 'Unsupported stock movement type' USING ERRCODE = '22023';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Movement reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT p.quantity, p.name
    INTO current_quantity, current_product_name
  FROM public.products AS p
  WHERE p.id = p_product_id
    AND p."shopId" = p_shop_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found in this shop' USING ERRCODE = 'P0002';
  END IF;

  IF p_type = 'OUT'::public."StockMovementType" AND p_quantity > current_quantity THEN
    RAISE EXCEPTION 'Insufficient stock' USING ERRCODE = '22023';
  END IF;

  next_quantity := CASE
    WHEN p_type = 'IN'::public."StockMovementType" THEN current_quantity + p_quantity
    ELSE current_quantity - p_quantity
  END;

  UPDATE public.products
  SET quantity = next_quantity,
      "updatedAt" = now()
  WHERE id = p_product_id
    AND "shopId" = p_shop_id;

  INSERT INTO public.stock_movements (
    id, "shopId", "legacyId", "productId", "productName",
    type, quantity, reason, date, "stockBefore", "stockAfter"
  )
  VALUES (
    gen_random_uuid(), p_shop_id, p_legacy_id, p_product_id, current_product_name,
    p_type, p_quantity, btrim(p_reason), now(), current_quantity, next_quantity
  )
  ON CONFLICT ("shopId", "legacyId") DO NOTHING
  RETURNING id INTO movement_id;

  IF movement_id IS NULL THEN
    RAISE EXCEPTION 'Duplicate stock movement identifier' USING ERRCODE = '23505';
  END IF;

  RETURN movement_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_stock_movement(uuid, uuid, bigint, public."StockMovementType", integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_stock_movement(uuid, uuid, bigint, public."StockMovementType", integer, text) TO authenticated;
