import "server-only";

import {
  getSubscriptionAccess,
  type SubscriptionAccess,
  type SubscriptionAccessInput,
} from "./policy";

type DbError = { code?: string; message?: string; details?: string; hint?: string } | null;
type QueryResult<T = unknown> = Promise<{ data: T; error: DbError }>;
type QueryChain = {
  select: (columns?: string) => QueryChain;
  insert: (values: unknown) => QueryChain;
  update: (values: unknown) => QueryChain;
  eq: (column: string, value: unknown) => QueryChain;
  order: (column: string, options: { ascending: boolean }) => QueryChain;
  limit: (count: number) => QueryChain;
  maybeSingle: () => QueryResult<Record<string, unknown> | null>;
  single: () => QueryResult<Record<string, unknown> | null>;
  then: PromiseLike<{ data: unknown; error: DbError }>["then"];
};
type SupabaseServerClient = {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
  from: (table: string) => QueryChain;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: DbError }>;
};

export type ShopWriteAccessOk = {
  ok: true;
  supabase: SupabaseServerClient;
  userId: string;
  shopId: string;
  role: string | null;
  access: SubscriptionAccess;
};

export type ShopWriteAccessErrorCode =
  | "UNAUTHENTICATED"
  | "MEMBERSHIP_LOOKUP_FAILED"
  | "NO_MEMBERSHIP"
  | "SUBSCRIPTION_LOOKUP_FAILED"
  | "WRITE_NOT_ALLOWED";

export type ShopWriteAccessError = {
  ok: false;
  status: number;
  error: string;
  code: ShopWriteAccessErrorCode;
};

export type ShopWriteAccessResult = ShopWriteAccessOk | ShopWriteAccessError;

export function subscriptionWriteDeniedResponse(result: ShopWriteAccessError): Response {
  return Response.json({ error: result.error }, { status: result.status });
}

type Options = {
  membershipMissingStatus?: 401 | 403;
  membershipMissingMessage?: string;
};

type Dependencies = {
  createClientFn?: () => Promise<SupabaseServerClient>;
  getAccessFn?: typeof getSubscriptionAccess;
  now?: Date;
};

const ERR_UNAUTHENTICATED = "Authentification requise." as const;
const ERR_MEMBERSHIP_VERIFY = "Impossible de vérifier l'appartenance à la boutique." as const;
const ERR_ACCESS_VERIFY = "Impossible de vérifier l'accès à la boutique." as const;
const ERR_SUBSCRIPTION_VERIFY = "Impossible de vérifier l'abonnement de la boutique." as const;
const ERR_WRITE_DENIED =
  "Votre abonnement ne permet pas cette opération en écriture. Consultez vos données ou renouvelez votre abonnement." as const;

function deny(
  status: number,
  error: string,
  code: ShopWriteAccessErrorCode,
): ShopWriteAccessError {
  return { ok: false, status, error, code };
}

function logTechnical(context: string) {
  // Technical log without leaking sensitive request/auth/subscription details to clients or logs.
  console.error(`[subscription-access] ${context}`);
}

async function getDefaultCreateClient(): Promise<() => Promise<SupabaseServerClient>> {
  const mod = await import("../supabase/server");
  return mod.createClient as unknown as () => Promise<SupabaseServerClient>;
}

export async function requireShopWriteAccess(
  options: Options = {},
  deps: Dependencies = {},
): Promise<ShopWriteAccessResult> {
  const membershipMissingStatus = options.membershipMissingStatus ?? 401;
  const membershipMissingMessage =
    options.membershipMissingMessage ?? "Aucune boutique autorisée n'a été trouvée.";

  try {
    let createClientFn = deps.createClientFn;
    if (!createClientFn) {
      try {
        createClientFn = await getDefaultCreateClient();
      } catch {
        logTechnical("server client module unavailable");
        return deny(500, ERR_ACCESS_VERIFY, "SUBSCRIPTION_LOOKUP_FAILED");
      }
    }

    const getAccessFn = deps.getAccessFn ?? getSubscriptionAccess;
    const now = deps.now ?? new Date();

    let supabase: SupabaseServerClient;
    try {
      supabase = await createClientFn();
    } catch {
      logTechnical("server client creation failed");
      return deny(500, ERR_ACCESS_VERIFY, "SUBSCRIPTION_LOOKUP_FAILED");
    }

    let userResult: { data: { user: { id: string } | null }; error: unknown };
    try {
      userResult = await supabase.auth.getUser();
    } catch {
      logTechnical("auth lookup threw");
      return deny(401, ERR_UNAUTHENTICATED, "UNAUTHENTICATED");
    }

    const user = userResult?.data?.user ?? null;
    const authError = userResult?.error ?? null;
    if (authError || !user) {
      return deny(401, ERR_UNAUTHENTICATED, "UNAUTHENTICATED");
    }

    let membershipResult: { data: Record<string, unknown> | null; error: unknown };
    try {
      membershipResult = await supabase
        .from("shop_memberships")
        .select("shopId, role")
        .eq("userId", user.id)
        .order("createdAt", { ascending: true })
        .limit(1)
        .maybeSingle();
    } catch {
      logTechnical("membership lookup threw");
      return deny(500, ERR_MEMBERSHIP_VERIFY, "MEMBERSHIP_LOOKUP_FAILED");
    }

    const membership = membershipResult?.data ?? null;
    const membershipError = membershipResult?.error ?? null;
    if (membershipError) {
      logTechnical("membership lookup failed");
      return deny(500, ERR_MEMBERSHIP_VERIFY, "MEMBERSHIP_LOOKUP_FAILED");
    }

    if (!membership?.shopId) {
      return deny(membershipMissingStatus, membershipMissingMessage, "NO_MEMBERSHIP");
    }

    const shopId = String(membership.shopId);
    const role = typeof membership.role === "string" ? membership.role : null;

    let subscriptionResult: { data: Record<string, unknown> | null; error: unknown };
    try {
      subscriptionResult = await supabase
        .from("subscriptions")
        .select('status, "trialEndsAt", "currentPeriodEnd"')
        .eq("shopId", shopId)
        .maybeSingle();
    } catch {
      logTechnical("subscription lookup threw");
      return deny(500, ERR_SUBSCRIPTION_VERIFY, "SUBSCRIPTION_LOOKUP_FAILED");
    }

    const subscription = subscriptionResult?.data ?? null;
    const subscriptionError = subscriptionResult?.error ?? null;
    if (subscriptionError) {
      logTechnical("subscription lookup failed");
      return deny(500, ERR_SUBSCRIPTION_VERIFY, "SUBSCRIPTION_LOOKUP_FAILED");
    }

    let access: SubscriptionAccess;
    try {
      access = getAccessFn(
        (subscription ?? null) as SubscriptionAccessInput,
        now,
      );
    } catch {
      logTechnical("subscription policy evaluation failed");
      return deny(500, ERR_SUBSCRIPTION_VERIFY, "SUBSCRIPTION_LOOKUP_FAILED");
    }

    if (!access.canWrite) {
      return deny(403, ERR_WRITE_DENIED, "WRITE_NOT_ALLOWED");
    }

    return {
      ok: true,
      supabase,
      userId: user.id,
      shopId,
      role,
      access,
    };
  } catch {
    // Fail-closed: any unexpected exception must never authorize a write.
    logTechnical("unexpected failure");
    return deny(500, ERR_ACCESS_VERIFY, "SUBSCRIPTION_LOOKUP_FAILED");
  }
}
