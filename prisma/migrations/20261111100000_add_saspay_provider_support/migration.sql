BEGIN;

-- =========================================================
-- Additive support for SASPAY provider (keep FEDAPAY history)
-- BoutiquePro test migration - does not modify historical migrations.
-- =========================================================

-- subscription_payments.provider: allow FEDAPAY and SASPAY
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'subscription_payments'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%provider%'
  LOOP
    EXECUTE format('ALTER TABLE public.subscription_payments DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.subscription_payments
  ADD CONSTRAINT subscription_payments_provider_check
  CHECK (provider IN ('FEDAPAY', 'SASPAY'));

-- payment_events.provider: allow FEDAPAY and SASPAY
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'payment_events'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%provider%'
  LOOP
    EXECUTE format('ALTER TABLE public.payment_events DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.payment_events
  ADD CONSTRAINT payment_events_provider_check
  CHECK (provider IN ('FEDAPAY', 'SASPAY'));

-- Generic confirmation: validates payment against its stored provider
-- (FEDAPAY and SASPAY). Preserves amount/currency/plan/reference/tx checks.
CREATE OR REPLACE FUNCTION public.confirm_subscription_payment(
  p_payment_id uuid,
  p_provider_payment_id text,
  p_provider_reference text,
  p_verified_amount numeric,
  p_verified_currency text,
  p_paid_at timestamptz DEFAULT NULL
)
RETURNS TABLE (
  payment_id uuid,
  subscription_id uuid,
  period_start timestamptz,
  period_end timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment public.subscription_payments%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE;
  v_plan public.subscription_plans%ROWTYPE;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  IF p_payment_id IS NULL
     OR p_provider_payment_id IS NULL
     OR length(trim(p_provider_payment_id)) = 0
     OR p_provider_reference IS NULL
     OR length(trim(p_provider_reference)) = 0
     OR p_verified_amount IS NULL
     OR p_verified_currency IS NULL
  THEN
    RAISE EXCEPTION 'Invalid payment verification data';
  END IF;

  SELECT *
  INTO v_payment
  FROM public.subscription_payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF v_payment.provider NOT IN ('FEDAPAY', 'SASPAY') THEN
    RAISE EXCEPTION 'Invalid payment provider';
  END IF;

  IF v_payment."providerReference" IS DISTINCT FROM p_provider_reference THEN
    RAISE EXCEPTION 'Provider reference does not match payment';
  END IF;

  IF v_payment.amount IS DISTINCT FROM p_verified_amount THEN
    RAISE EXCEPTION 'Verified amount does not match payment amount';
  END IF;

  IF v_payment.currency IS DISTINCT FROM p_verified_currency THEN
    RAISE EXCEPTION 'Verified currency does not match payment currency';
  END IF;

  SELECT *
  INTO v_plan
  FROM public.subscription_plans
  WHERE code = v_payment.plan
    AND "isActive" = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription plan is unavailable';
  END IF;

  IF v_plan."monthlyAmount" IS DISTINCT FROM v_payment.amount
     OR v_plan.currency IS DISTINCT FROM v_payment.currency
  THEN
    RAISE EXCEPTION 'Payment amount does not match official plan price';
  END IF;

  SELECT *
  INTO v_subscription
  FROM public.subscriptions
  WHERE id = v_payment."subscriptionId"
    AND "shopId" = v_payment."shopId"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription not found for this payment';
  END IF;

  IF v_payment.status = 'PAID' THEN
    IF v_payment."providerPaymentId"
       IS DISTINCT FROM p_provider_payment_id
    THEN
      RAISE EXCEPTION 'Payment already confirmed with another transaction';
    END IF;

    RETURN QUERY
    SELECT
      v_payment.id,
      v_payment."subscriptionId",
      v_payment."periodStart",
      v_payment."periodEnd";

    RETURN;
  END IF;

  IF v_payment.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Payment is not pending';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.subscription_payments sp
    WHERE sp.provider = v_payment.provider
      AND sp."providerPaymentId" = p_provider_payment_id
      AND sp.id <> p_payment_id
  ) THEN
    RAISE EXCEPTION 'Provider transaction already used';
  END IF;

  v_start := GREATEST(
    now(),
    COALESCE(
      v_subscription."currentPeriodEnd",
      v_subscription."trialEndsAt",
      now()
    )
  );

  v_end := v_start + interval '1 month';

  UPDATE public.subscription_payments
  SET
    status = 'PAID',
    "providerPaymentId" = p_provider_payment_id,
    "paidAt" = COALESCE(p_paid_at, now()),
    "periodStart" = v_start,
    "periodEnd" = v_end,
    "updatedAt" = now()
  WHERE id = p_payment_id;

  UPDATE public.subscriptions
  SET
    plan = v_payment.plan,
    status = 'ACTIVE',
    currency = v_payment.currency,
    "currentPeriodStart" = v_start,
    "currentPeriodEnd" = v_end,
    "updatedAt" = now()
  WHERE id = v_subscription.id;

  RETURN QUERY
  SELECT
    v_payment.id,
    v_subscription.id,
    v_start,
    v_end;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_subscription_payment(
  uuid, text, text, numeric, text, timestamptz
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.confirm_subscription_payment(
  uuid, text, text, numeric, text, timestamptz
)
TO service_role;

-- Generic payment event processing (idempotent by provider+eventId).
-- Supports SASPAY transaction.success and legacy FEDAPAY transaction.approved.
CREATE OR REPLACE FUNCTION public.process_payment_event(
  p_provider text,
  p_event_id text,
  p_event_name text,
  p_payment_id uuid,
  p_provider_payment_id text,
  p_provider_reference text,
  p_verified_amount numeric,
  p_verified_currency text,
  p_paid_at timestamptz,
  p_payload jsonb
)
RETURNS TABLE (
  is_duplicate boolean,
  confirmed_payment_id uuid,
  confirmed_subscription_id uuid,
  confirmed_period_start timestamptz,
  confirmed_period_end timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_row_id uuid := NULL;
  v_confirmation record;
  v_is_success boolean := false;
BEGIN
  IF p_provider IS NULL OR p_provider NOT IN ('FEDAPAY', 'SASPAY')
     OR p_event_id IS NULL OR length(trim(p_event_id)) = 0
     OR p_event_name IS NULL OR length(trim(p_event_name)) = 0
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
  THEN
    RAISE EXCEPTION 'Invalid payment event data';
  END IF;

  INSERT INTO public.payment_events (
    provider,
    "eventId",
    "paymentId",
    payload
  )
  VALUES (
    p_provider,
    p_event_id,
    p_payment_id,
    p_payload
  )
  ON CONFLICT (provider, "eventId") DO NOTHING
  RETURNING id INTO v_event_row_id;

  IF v_event_row_id IS NULL THEN
    RETURN QUERY
    SELECT true, NULL::uuid, NULL::uuid,
           NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  v_is_success := (p_provider = 'FEDAPAY' AND p_event_name = 'transaction.approved')
               OR (p_provider = 'SASPAY'  AND p_event_name = 'transaction.success');

  IF v_is_success THEN
    IF p_payment_id IS NULL
       OR p_provider_payment_id IS NULL
       OR p_provider_reference IS NULL
       OR p_verified_amount IS NULL
       OR p_verified_currency IS NULL
    THEN
      RAISE EXCEPTION 'Missing verified payment information';
    END IF;

    SELECT
      c.payment_id,
      c.subscription_id,
      c.period_start,
      c.period_end
    INTO v_confirmation
    FROM public.confirm_subscription_payment(
      p_payment_id,
      p_provider_payment_id,
      p_provider_reference,
      p_verified_amount,
      p_verified_currency,
      p_paid_at
    ) AS c;

    UPDATE public.payment_events
    SET "processedAt" = now()
    WHERE id = v_event_row_id;

    RETURN QUERY
    SELECT
      false,
      v_confirmation.payment_id,
      v_confirmation.subscription_id,
      v_confirmation.period_start,
      v_confirmation.period_end;

    RETURN;
  END IF;

  UPDATE public.payment_events
  SET "processedAt" = now()
  WHERE id = v_event_row_id;

  RETURN QUERY
  SELECT false, NULL::uuid, NULL::uuid,
         NULL::timestamptz, NULL::timestamptz;
END;
$$;

REVOKE ALL ON FUNCTION public.process_payment_event(
  text, text, text, uuid, text, text, numeric, text, timestamptz, jsonb
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.process_payment_event(
  text, text, text, uuid, text, text, numeric, text, timestamptz, jsonb
)
TO service_role;

-- Keep legacy RPC name working for historical/remaining callers.
CREATE OR REPLACE FUNCTION public.process_fedapay_event(
  p_event_id text,
  p_event_name text,
  p_payment_id uuid,
  p_provider_payment_id text,
  p_provider_reference text,
  p_verified_amount numeric,
  p_verified_currency text,
  p_paid_at timestamptz,
  p_payload jsonb
)
RETURNS TABLE (
  is_duplicate boolean,
  confirmed_payment_id uuid,
  confirmed_subscription_id uuid,
  confirmed_period_start timestamptz,
  confirmed_period_end timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT * FROM public.process_payment_event(
    'FEDAPAY',
    p_event_id,
    p_event_name,
    p_payment_id,
    p_provider_payment_id,
    p_provider_reference,
    p_verified_amount,
    p_verified_currency,
    p_paid_at,
    p_payload
  );
$$;

REVOKE ALL ON FUNCTION public.process_fedapay_event(
  text, text, uuid, text, text, numeric, text, timestamptz, jsonb
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.process_fedapay_event(
  text, text, uuid, text, text, numeric, text, timestamptz, jsonb
)
TO service_role;

COMMIT;
