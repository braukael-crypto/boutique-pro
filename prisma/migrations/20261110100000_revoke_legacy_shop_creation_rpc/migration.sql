BEGIN;

REVOKE EXECUTE ON FUNCTION public.create_shop_for_current_user(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_shop_for_current_user(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_shop_for_current_user(text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.create_shop_for_current_user(text, text) FROM service_role;

COMMIT;
