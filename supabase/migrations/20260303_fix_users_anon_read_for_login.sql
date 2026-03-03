-- Fix login: the backup migration created two problems:
-- 1. No SELECT policy for anon role → initial name/email lookup fails before auth
-- 2. The admin policy on public.users is self-referential (queries users inside a
--    policy for users) → infinite recursion error for authenticated users

-- Step 1: Create a SECURITY DEFINER function to safely check admin status.
-- SECURITY DEFINER bypasses RLS, breaking the recursion loop.
CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.users WHERE id = auth.uid()),
    false
  );
$$;

-- Step 2: Replace the broken recursive admin policy on public.users
DROP POLICY IF EXISTS "Admins bypass RLS for SELECT in users" ON public.users;
CREATE POLICY "Authenticated users can read own profile or admins read all"
ON public.users
FOR SELECT
TO authenticated
USING (auth.uid() = id OR public.is_current_user_admin());

-- Step 3: Allow unauthenticated (anon) access for the login lookup.
-- authService.login() queries public.users by name/email BEFORE authenticating.
DROP POLICY IF EXISTS "Allow anon to lookup active users for login" ON public.users;
CREATE POLICY "Allow anon to lookup active users for login"
ON public.users
FOR SELECT
TO anon
USING (is_active = true);
