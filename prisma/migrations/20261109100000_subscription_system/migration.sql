BEGIN;

-- =========================================================
-- 1. CATALOGUE DES FORMULES
-- =========================================================

CREATE TABLE public.subscription_plans (
  code text PRIMARY KEY
    CHECK (code IN ('ESSENTIAL', 'STANDARD', 'PREMIUM', 'ENTERPRISE')),
  name text NOT NULL,
  "monthlyAmount" numeric(14,2) NOT NULL
    CHECK ("monthlyAmount" > 0),
  currency text NOT NULL DEFAULT 'XOF'
    CHECK (currency = 'XOF'),
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.subscription_plans
  (code, name, "monthlyAmount", currency)
VALUES
  ('ESSENTIAL', 'Essentiel', 2000, 'XOF'),
  ('STANDARD', 'Standard', 3000, 'XOF'),
  ('PREMIUM', 'Premium', 4000, 'XOF'),
  ('ENTERPRISE', 'Entreprise', 5000, 'XOF');


-- =========================================================
-- 2. ABONNEMENTS DES BOUTIQUES
-- =========================================================

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  "shopId" uuid NOT NULL UNIQUE
    REFERENCES public.shops(id) ON DELETE CASCADE,

  plan text NOT NULL
    REFERENCES public.subscription_plans(code),

  status text NOT NULL DEFAULT 'TRIALING'
    CHECK (
      status IN (
        'TRIALING',
        'ACTIVE',
        'PAST_DUE',
        'EXPIRED',
        'CANCELED'
      )
    ),

  "billingInterval" text NOT NULL DEFAULT 'MONTHLY'
    CHECK ("billingInterval" = 'MONTHLY'),

  currency text NOT NULL DEFAULT 'XOF'
    CHECK (currency = 'XOF'),

  "trialStartedAt" timestamptz,
  "trialEndsAt" timestamptz,

  "currentPeriodStart" timestamptz,
  "currentPeriodEnd" timestamptz,

  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),

  CHECK (
    "trialEndsAt" IS NULL
    OR "trialStartedAt" IS NULL
    OR "trialEndsAt" > "trialStartedAt"
  ),

  CHECK (
    "currentPeriodEnd" IS NULL
    OR "currentPeriodStart" IS NULL
    OR "currentPeriodEnd" > "currentPeriodStart"
  )
);

CREATE INDEX subscriptions_status_end_idx
ON public.subscriptions(status, "currentPeriodEnd");


-- =========================================================
-- 3. HISTORIQUE DES PAIEMENTS
-- =========================================================

CREATE TABLE public.subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  "shopId" uuid NOT NULL
    REFERENCES public.shops(id) ON DELETE RESTRICT,

  "subscriptionId" uuid NOT NULL
    REFERENCES public.subscriptions(id) ON DELETE RESTRICT,

  plan text NOT NULL
    REFERENCES public.subscription_plans(code),

  provider text NOT NULL
    CHECK (provider = 'FEDAPAY'),

  status text NOT NULL DEFAULT 'PENDING'
    CHECK (
      status IN (
        'PENDING',
        'PAID',
        'FAILED',
        'CANCELLED',
        'REFUNDED'
      )
    ),

  amount numeric(14,2) NOT NULL
    CHECK (amount > 0),

  currency text NOT NULL DEFAULT 'XOF'
    CHECK (currency = 'XOF'),

  "providerReference" text,
  "providerPaymentId" text,

  "idempotencyKey" text NOT NULL,

  "paidAt" timestamptz,
  "periodStart" timestamptz,
  "periodEnd" timestamptz,

  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),

  UNIQUE ("shopId", "idempotencyKey"),

  CHECK (
    "providerPaymentId" IS NULL
    OR length(trim("providerPaymentId")) > 0
  ),

  CHECK (
    "periodEnd" IS NULL
    OR "periodStart" IS NULL
    OR "periodEnd" > "periodStart"
  )
);

ALTER TABLE public.subscription_payments
ADD CONSTRAINT subscription_payments_provider_reference_nonempty
CHECK (
  "providerReference" IS NULL
  OR length(trim("providerReference")) > 0
);

CREATE UNIQUE INDEX subscription_payments_provider_reference_idx
ON public.subscription_payments(provider, "providerReference")
WHERE "providerReference" IS NOT NULL;

CREATE UNIQUE INDEX subscription_payments_provider_id_idx
ON public.subscription_payments(provider, "providerPaymentId")
WHERE "providerPaymentId" IS NOT NULL;

CREATE INDEX subscription_payments_shop_date_idx
ON public.subscription_payments("shopId", "createdAt" DESC);


-- =========================================================
-- 4. JOURNAL DES ÉVÉNEMENTS FEDAPAY
-- =========================================================

CREATE TABLE public.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  provider text NOT NULL
    CHECK (provider = 'FEDAPAY'),

  "eventId" text NOT NULL
    CHECK (length(trim("eventId")) > 0),

  "paymentId" uuid
    REFERENCES public.subscription_payments(id),

  payload jsonb NOT NULL,

  "processedAt" timestamptz,

  "createdAt" timestamptz NOT NULL DEFAULT now(),

  UNIQUE (provider, "eventId")
);


-- =========================================================
-- 5. SÉCURITÉ RLS ET PERMISSIONS
-- =========================================================

ALTER TABLE public.subscription_plans
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.subscriptions
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.subscription_payments
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.payment_events
ENABLE ROW LEVEL SECURITY;


CREATE POLICY "public_read_active_subscription_plans"
ON public.subscription_plans
FOR SELECT
TO anon, authenticated
USING ("isActive" = true);


CREATE POLICY "members_read_own_subscriptions"
ON public.subscriptions
FOR SELECT
TO authenticated
USING (public.is_shop_member("shopId"));


CREATE POLICY "members_read_own_subscription_payments"
ON public.subscription_payments
FOR SELECT
TO authenticated
USING (public.is_shop_member("shopId"));


REVOKE ALL ON TABLE
  public.subscription_plans,
  public.subscriptions,
  public.subscription_payments,
  public.payment_events
FROM PUBLIC, anon, authenticated;


GRANT SELECT ON TABLE public.subscription_plans
TO anon, authenticated;

GRANT SELECT ON TABLE
  public.subscriptions,
  public.subscription_payments
TO authenticated;

GRANT ALL ON TABLE
  public.subscription_plans,
  public.subscriptions,
  public.subscription_payments,
  public.payment_events
TO service_role;


-- =========================================================
-- 6. CONFIRMATION SÉCURISÉE D'UN PAIEMENT
-- =========================================================
-- Cette fonction doit être appelée uniquement par le serveur
-- après vérification réelle du paiement auprès de FedaPay.
--
-- Elle vérifie :
-- - l'existence du paiement ;
-- - le fournisseur ;
-- - le montant ;
-- - la devise ;
-- - le tarif officiel de la formule ;
-- - l'identifiant unique de transaction ;
-- - l'état actuel du paiement.
--
-- Elle active ensuite l'abonnement dans une transaction SQL.

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

  IF v_payment.provider <> 'FEDAPAY' THEN
    RAISE EXCEPTION 'Invalid payment provider';
  END IF;

  IF v_payment."providerReference" IS DISTINCT FROM p_provider_reference THEN
    RAISE EXCEPTION 'FedaPay reference does not match payment';
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

  -- Un paiement déjà confirmé ne peut être rejoué
  -- qu'avec exactement le même identifiant FedaPay.
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

  -- Empêche la réutilisation d'une transaction FedaPay.
  IF EXISTS (
    SELECT 1
    FROM public.subscription_payments sp
    WHERE sp.provider = 'FEDAPAY'
      AND sp."providerPaymentId" = p_provider_payment_id
      AND sp.id <> p_payment_id
  ) THEN
    RAISE EXCEPTION 'FedaPay transaction already used';
  END IF;

  -- Une période déjà payée ou un essai encore valable
  -- ne sont pas perdus lors du renouvellement.
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


-- =========================================================
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_row_id uuid := NULL;
  v_confirmation record;
BEGIN
  IF p_event_id IS NULL
     OR length(trim(p_event_id)) = 0
     OR p_event_name IS NULL
     OR length(trim(p_event_name)) = 0
     OR p_payload IS NULL
     OR jsonb_typeof(p_payload) <> 'object'
  THEN
    RAISE EXCEPTION 'Invalid FedaPay event data';
  END IF;

  INSERT INTO public.payment_events (
    provider,
    "eventId",
    "paymentId",
    payload
  )
  VALUES (
    'FEDAPAY',
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

  IF p_event_name = 'transaction.approved' THEN

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

REVOKE ALL ON FUNCTION public.process_fedapay_event(
  text, text, uuid, text, text, numeric, text, timestamptz, jsonb
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.process_fedapay_event(
  text, text, uuid, text, text, numeric, text, timestamptz, jsonb
)
TO service_role;


-- 7. APPROBATION D'UNE NOUVELLE BOUTIQUE
-- =========================================================
-- Crée :
-- - la boutique ;
-- - son propriétaire ;
-- - son abonnement d'essai de 30 jours.
--
-- Cette fonction ne touche jamais aux boutiques existantes.

CREATE OR REPLACE FUNCTION public.approve_shop_application(
  p_application_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  a public.shop_applications%ROWTYPE;
  sid uuid;
  base_slug text;
  final_slug text;
  v_now timestamptz := now();
BEGIN
  SELECT *
  INTO a
  FROM public.shop_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found';
  END IF;

  IF a.status NOT IN ('PENDING', 'UNDER_REVIEW') THEN
    RAISE EXCEPTION 'Application is not awaiting approval';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(a."userId"::text, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.shop_memberships
    WHERE "userId" = a."userId"
  ) THEN
    RAISE EXCEPTION 'Applicant already belongs to a shop';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.subscription_plans
    WHERE code = a.plan
      AND "isActive" = true
  ) THEN
    RAISE EXCEPTION 'Selected subscription plan is unavailable';
  END IF;

  base_slug := trim(
    both '-' FROM regexp_replace(
      lower(a."shopName"),
      '[^a-z0-9]+',
      '-',
      'g'
    )
  );

  IF base_slug = '' THEN
    base_slug := 'boutique';
  END IF;

  final_slug :=
    left(base_slug, 68)
    || '-'
    || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  INSERT INTO public.shops (
    id,
    name,
    slug,
    phone,
    whatsapp,
    address,
    currency,
    "updatedAt"
  )
  VALUES (
    gen_random_uuid(),
    a."shopName",
    final_slug,
    a.phone,
    a.phone,
    a.address,
    'XOF',
    v_now
  )
  RETURNING id INTO sid;

  INSERT INTO public.shop_memberships (
    id,
    "shopId",
    "userId",
    role,
    "updatedAt"
  )
  VALUES (
    gen_random_uuid(),
    sid,
    a."userId",
    'OWNER',
    v_now
  );

  INSERT INTO public.subscriptions (
    "shopId",
    plan,
    status,
    "billingInterval",
    currency,
    "trialStartedAt",
    "trialEndsAt"
  )
  VALUES (
    sid,
    a.plan,
    'TRIALING',
    'MONTHLY',
    'XOF',
    v_now,
    v_now + interval '30 days'
  );

  UPDATE public.shop_applications
  SET
    status = 'APPROVED',
    "reviewedAt" = v_now,
    "updatedAt" = v_now
  WHERE id = p_application_id;

  RETURN sid;
END;
$$;


REVOKE ALL ON FUNCTION public.approve_shop_application(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.approve_shop_application(uuid)
TO service_role;


COMMIT;
