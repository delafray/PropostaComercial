-- Migration: Cria função backup_introspect() para backups 100% automáticos
-- Uso: SELECT backup_introspect(); (retorna JSON com tables, fk_deps, functions, policies)

CREATE OR REPLACE FUNCTION public.backup_introspect()
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT json_build_object(

    'tables', (
      SELECT json_agg(
        json_build_object(
          'name', t.table_name,
          'columns', (
            SELECT json_agg(
              json_build_object(
                'name', c.column_name,
                'udt',  c.udt_name,
                'nullable', (c.is_nullable = 'YES'),
                'has_default', (c.column_default IS NOT NULL)
              ) ORDER BY c.ordinal_position
            )
            FROM information_schema.columns c
            WHERE c.table_schema = 'public' AND c.table_name = t.table_name
          )
        ) ORDER BY t.table_name
      )
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ),

    'fk_deps', (
      SELECT COALESCE(
        json_agg(json_build_object('from_table', fd.from_table, 'to_table', fd.to_table)),
        '[]'::json
      )
      FROM (
        SELECT DISTINCT kcu.table_name AS from_table, ccu.table_name AS to_table
        FROM information_schema.key_column_usage kcu
        JOIN information_schema.referential_constraints rc
          ON  kcu.constraint_name   = rc.constraint_name
          AND kcu.constraint_schema = rc.constraint_schema
        JOIN information_schema.constraint_column_usage ccu
          ON  rc.unique_constraint_name   = ccu.constraint_name
          AND rc.unique_constraint_schema = ccu.constraint_schema
        WHERE kcu.table_schema = 'public'
          AND ccu.table_schema = 'public'
          AND kcu.table_name  != ccu.table_name
      ) fd
    ),

    'functions', (
      SELECT COALESCE(
        json_agg(
          json_build_object('name', p.proname, 'def', pg_get_functiondef(p.oid))
          ORDER BY p.proname
        ),
        '[]'::json
      )
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
    ),

    'policies', (
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'tablename',  pol.tablename,
            'policyname', pol.policyname,
            'permissive', pol.permissive,
            'cmd',        pol.cmd,
            'roles',      pol.roles,
            'qual',       pol.qual,
            'with_check', pol.with_check
          ) ORDER BY pol.tablename, pol.policyname
        ),
        '[]'::json
      )
      FROM pg_policies pol
      WHERE pol.schemaname = 'public'
    )

  );
$$;

GRANT EXECUTE ON FUNCTION public.backup_introspect() TO authenticated;
