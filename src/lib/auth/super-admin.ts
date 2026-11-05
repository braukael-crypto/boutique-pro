import "server-only";

import type { User } from "@supabase/supabase-js";

export function isSuperAdmin(user: User | null): boolean {
  const allowedEmail = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();

  return Boolean(
    allowedEmail &&
    user?.email &&
    user.email.toLowerCase() === allowedEmail &&
    user.email_confirmed_at,
  );
}
