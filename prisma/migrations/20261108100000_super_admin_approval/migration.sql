CREATE OR REPLACE FUNCTION public.approve_shop_application(p_application_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.shop_applications%ROWTYPE; sid uuid; base_slug text; final_slug text;
BEGIN
 SELECT * INTO a FROM public.shop_applications WHERE id=p_application_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Application not found'; END IF;
 IF a.status NOT IN ('PENDING','UNDER_REVIEW') THEN RAISE EXCEPTION 'Application is not awaiting approval'; END IF;
 IF EXISTS (SELECT 1 FROM public.shop_memberships WHERE "userId"=a."userId") THEN RAISE EXCEPTION 'Applicant already belongs to a shop'; END IF;
 base_slug := trim(both '-' from regexp_replace(lower(a."shopName"), '[^a-z0-9]+', '-', 'g'));
 IF base_slug='' THEN base_slug:='boutique'; END IF;
 final_slug := left(base_slug,68)||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,8);
 INSERT INTO public.shops(id,name,slug,phone,whatsapp,address,currency,"updatedAt")
 VALUES(gen_random_uuid(),a."shopName",final_slug,a.phone,a.phone,a.address,'XOF',now()) RETURNING id INTO sid;
 INSERT INTO public.shop_memberships(id,"shopId","userId",role,"updatedAt")
 VALUES(gen_random_uuid(),sid,a."userId",'OWNER',now());
 UPDATE public.shop_applications SET status='APPROVED',"reviewedAt"=now(),"updatedAt"=now() WHERE id=p_application_id;
 RETURN sid;
END; $$;
REVOKE ALL ON FUNCTION public.approve_shop_application(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_shop_application(uuid) TO service_role;
