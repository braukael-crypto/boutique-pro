-- Atomic, idempotent credit repayment recording.
CREATE OR REPLACE FUNCTION public.record_shop_credit_payment(
  p_shop_id uuid,
  p_legacy_payment_id bigint,
  p_legacy_sale_id bigint,
  p_amount numeric,
  p_date timestamptz,
  p_note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  payment_uuid uuid;
  sale_row record;
  already_paid numeric(14,2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_shop_member(p_shop_id) THEN
    RAISE EXCEPTION 'Shop access denied' USING ERRCODE = '42501';
  END IF;
  IF p_legacy_payment_id IS NULL OR p_legacy_payment_id <= 0
     OR p_legacy_sale_id IS NULL OR p_legacy_sale_id <= 0
     OR p_amount IS NULL OR p_amount <= 0 OR p_amount <> trunc(p_amount) THEN
    RAISE EXCEPTION 'Invalid credit payment' USING ERRCODE = '22023';
  END IF;

  SELECT cp.id INTO payment_uuid
  FROM public.credit_payments cp
  WHERE cp."shopId" = p_shop_id AND cp."legacyId" = p_legacy_payment_id;
  IF payment_uuid IS NOT NULL THEN
    RETURN payment_uuid;
  END IF;

  SELECT s.id, s.total, s."paymentMethod", s."customerId"
    INTO sale_row
  FROM public.sales s
  WHERE s."shopId" = p_shop_id AND s."legacyId" = p_legacy_sale_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit sale not found in this shop' USING ERRCODE = 'P0002';
  END IF;
  IF sale_row."paymentMethod" <> 'CREDIT'::public."PaymentMethod" THEN
    RAISE EXCEPTION 'Sale is not a credit sale' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(sum(cp.amount), 0) INTO already_paid
  FROM public.credit_payments cp
  WHERE cp."shopId" = p_shop_id AND cp."saleId" = sale_row.id;

  IF already_paid + p_amount > sale_row.total THEN
    RAISE EXCEPTION 'Payment exceeds outstanding balance' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.credit_payments (
    id, "shopId", "legacyId", "saleId", "customerId", amount, date, note
  ) VALUES (
    gen_random_uuid(), p_shop_id, p_legacy_payment_id, sale_row.id,
    sale_row."customerId", p_amount, COALESCE(p_date, now()), NULLIF(btrim(p_note), '')
  )
  RETURNING id INTO payment_uuid;

  RETURN payment_uuid;
END;
$$;

REVOKE ALL ON FUNCTION public.record_shop_credit_payment(uuid, bigint, bigint, numeric, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_shop_credit_payment(uuid, bigint, bigint, numeric, timestamptz, text) TO authenticated;
