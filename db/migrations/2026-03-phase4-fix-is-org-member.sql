-- Fix is_org_member infinite recursion
-- The function queries organization_members, which has an RLS policy
-- that calls is_org_member, causing stack overflow for non-superuser roles.
-- Adding SECURITY DEFINER makes the function execute as the owner (postgres),
-- bypassing RLS on the organization_members table.

CREATE OR REPLACE FUNCTION public.is_org_member(org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = org_id
          AND user_id = auth.uid()
    )
$function$;
