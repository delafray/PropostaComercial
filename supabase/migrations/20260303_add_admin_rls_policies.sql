-- Script: Permitir que administradores (is_admin = true) burlem o RLS (SELECT)
-- Isso concede acesso total de leitura (SELECT) a todas as tabelas listadas,
-- garantindo que o backup extraia os dados perfeitamente sem erros de permissão ou registros ausentes.
-- Agora com verificação de existência de tabela para evitar erros de execução.

DO $$
DECLARE
    tbl_name text;
    -- Lista das tabelas principais da aplicação (incluindo extras)
    tables_to_update text[] := ARRAY[
        'users',
        'system_config',
        'tag_categories',
        'tags',
        'photos',
        'photo_tags',
        'user_biometrics',
        'eventos_edicoes',
        'planilha_configuracoes',
        'planilha_atendimentos',
        'planilha_itens_opcionais'
    ];
BEGIN
    FOR tbl_name IN SELECT UNNEST(tables_to_update)
    LOOP
        -- Só cria a política se a tabela existir no schema 'public'
        IF EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = tbl_name
        ) THEN
            -- Remove a política se já existir para evitar erro de duplicata
            EXECUTE format('DROP POLICY IF EXISTS "Admins bypass RLS for SELECT in %s" ON public.%I', tbl_name, tbl_name);
            
            -- Cria a nova política garantindo permissão SELECT para Admins
            EXECUTE format(
                'CREATE POLICY "Admins bypass RLS for SELECT in %s" ' ||
                'ON public.%I ' ||
                'FOR SELECT ' ||
                'TO authenticated ' ||
                'USING ( ' ||
                '   EXISTS ( ' ||
                '       SELECT 1 FROM public.users ' ||
                '       WHERE id = auth.uid() AND is_admin = true ' ||
                '   ) ' ||
                ');',
                tbl_name, tbl_name
            );
        END IF;
    END LOOP;
END;
$$;

-- Criar política especial para o bucket de fotos no Storage
DROP POLICY IF EXISTS "Admins bypass RLS for SELECT in storage.objects" ON storage.objects;
CREATE POLICY "Admins bypass RLS for SELECT in storage.objects"
ON storage.objects
FOR SELECT
TO authenticated
USING (
   bucket_id = 'photos' AND
   EXISTS (
       SELECT 1 FROM public.users
       WHERE id = auth.uid() AND is_admin = true
    )
);

