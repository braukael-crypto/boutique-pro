-- Atomic sale creation: sale, items, stock changes and movement history commit together.
CREATE OR REPLACE FUNCTION public.create_shop_sale(
  p_shop_id uuid,
  p_legacy_sale_id bigint,
  p_date timestamptz,
  p_payment_method public."PaymentMethod",
  p_customer_legacy_id bigint,
  p_customer_name text,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  sale_uuid uuid;
  customer_uuid uuid;
  item jsonb;
  product_row record;
  item_qty integer;
  item_index integer := 0;
  line_total numeric(14,2);
  line_profit numeric(14,2);
  sale_total numeric(14,2) := 0;
  sale_profit numeric(14,2) := 0;
  before_qty integer;
  after_qty integer;
  movement_legacy_id bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_shop_member(p_shop_id) THEN
    RAISE EXCEPTION 'Shop access denied' USING ERRCODE = '42501';
  END IF;
  IF p_legacy_sale_id IS NULL OR p_legacy_sale_id <= 0 THEN
    RAISE EXCEPTION 'Invalid sale identifier' USING ERRCODE = '22023';
  END IF;
  IF p_payment_method IS NULL OR p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0
     OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'Invalid sale items' USING ERRCODE = '22023';
  END IF;
  IF p_payment_method = 'CREDIT'::public."PaymentMethod"
     AND p_customer_legacy_id IS NULL THEN
    RAISE EXCEPTION 'A customer is required for credit sales' USING ERRCODE = '22023';
  END IF;

  SELECT s.id INTO sale_uuid
  FROM public.sales s
  WHERE s."shopId" = p_shop_id AND s."legacyId" = p_legacy_sale_id;
  IF sale_uuid IS NOT NULL THEN
    RETURN sale_uuid;
  END IF;

  IF p_customer_legacy_id IS NOT NULL THEN
    SELECT c.id INTO customer_uuid
    FROM public.customers c
    WHERE c."shopId" = p_shop_id AND c."legacyId" = p_customer_legacy_id;
    IF customer_uuid IS NULL THEN
      RAISE EXCEPTION 'Customer not found in this shop' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(item) <> 'object'
       OR (item->>'productLegacyId') IS NULL
       OR (item->>'quantity') IS NULL
       OR (item->>'quantity') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Invalid sale line' USING ERRCODE = '22023';
    END IF;
    item_qty := (item->>'quantity')::integer;
    IF item_qty <= 0 THEN
      RAISE EXCEPTION 'Quantity must be positive' USING ERRCODE = '22023';
    END IF;

    SELECT p.id, p.name, p.quantity, p."purchasePrice", p."sellingPrice"
      INTO product_row
    FROM public.products p
    WHERE p."shopId" = p_shop_id
      AND p."legacyId" = (item->>'productLegacyId')::bigint
      AND p."archivedAt" IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product not found in this shop' USING ERRCODE = 'P0002';
    END IF;
    IF product_row.quantity < item_qty THEN
      RAISE EXCEPTION 'Insufficient stock for %', product_row.name USING ERRCODE = '22023';
    END IF;

    line_total := product_row."sellingPrice" * item_qty;
    line_profit := (product_row."sellingPrice" - product_row."purchasePrice") * item_qty;
    sale_total := sale_total + line_total;
    sale_profit := sale_profit + line_profit;
  END LOOP;

  INSERT INTO public.sales (
    id, "shopId", "legacyId", date, total, "estimatedProfit",
    "paymentMethod", "customerId", "customerName"
  ) VALUES (
    gen_random_uuid(), p_shop_id, p_legacy_sale_id, COALESCE(p_date, now()),
    sale_total, sale_profit, p_payment_method, customer_uuid,
    CASE WHEN customer_uuid IS NOT NULL THEN NULLIF(btrim(p_customer_name), '') ELSE NULL END
  )
  RETURNING id INTO sale_uuid;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    item_index := item_index + 1;
    item_qty := (item->>'quantity')::integer;

    SELECT p.id, p.name, p.quantity, p."purchasePrice", p."sellingPrice"
      INTO product_row
    FROM public.products p
    WHERE p."shopId" = p_shop_id
      AND p."legacyId" = (item->>'productLegacyId')::bigint
      AND p."archivedAt" IS NULL
    FOR UPDATE;

    before_qty := product_row.quantity;
    after_qty := before_qty - item_qty;
    line_total := product_row."sellingPrice" * item_qty;
    line_profit := (product_row."sellingPrice" - product_row."purchasePrice") * item_qty;

    INSERT INTO public.sale_items (
      id, "shopId", "saleId", "productId", "productName", quantity,
      "purchasePrice", "sellingPrice", subtotal, "estimatedProfit"
    ) VALUES (
      gen_random_uuid(), p_shop_id, sale_uuid, product_row.id, product_row.name,
      item_qty, product_row."purchasePrice", product_row."sellingPrice",
      line_total, line_profit
    );

    UPDATE public.products
    SET quantity = after_qty, "updatedAt" = now()
    WHERE id = product_row.id AND "shopId" = p_shop_id;

    movement_legacy_id := p_legacy_sale_id * 1000 + item_index;
    INSERT INTO public.stock_movements (
      id, "shopId", "legacyId", "productId", "productName", "saleId",
      type, quantity, reason, date, "stockBefore", "stockAfter"
    ) VALUES (
      gen_random_uuid(), p_shop_id, movement_legacy_id, product_row.id,
      product_row.name, sale_uuid, 'OUT'::public."StockMovementType",
      item_qty, 'Vente #' || p_legacy_sale_id::text,
      COALESCE(p_date, now()), before_qty, after_qty
    );
  END LOOP;

  RETURN sale_uuid;
END;
$$;

REVOKE ALL ON FUNCTION public.create_shop_sale(uuid, bigint, timestamptz, public."PaymentMethod", bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_shop_sale(uuid, bigint, timestamptz, public."PaymentMethod", bigint, text, jsonb) TO authenticated;
