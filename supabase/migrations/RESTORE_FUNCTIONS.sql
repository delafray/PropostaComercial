-- ============================================================
-- GALERIA DE FOTOS — Funções PostgreSQL para Restauração
-- ============================================================
-- Estas funções NÃO são exportadas pelo backup do browser.
-- Aplique este arquivo manualmente no SQL Editor do Supabase
-- APÓS rodar os outros arquivos do backup (schema + dados).
--
-- Projeto original: zamknopwowugrjapoman
-- Reconstruído a partir de: database.types.ts + usePhotoFilters.ts
-- Data: 2026-03-03
-- ============================================================


-- ============================================================
-- FUNÇÃO 1: get_available_related_tags
-- ============================================================
-- Dado um conjunto de tags já selecionadas pelo usuário,
-- retorna todas as tags que co-ocorrem em fotos que possuem
-- TODAS as tags do conjunto (lógica cascata para o filtro
-- da galeria — à medida que seleciona, o leque se afunila).
--
-- Parâmetros:
--   current_tag_ids  — tags já selecionadas no filtro
--   filter_user_id   — (opcional) limitar às fotos de um usuário
--
-- Retorna: lista de tag_id disponíveis para seleção seguinte
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_available_related_tags(
    current_tag_ids UUID[],
    filter_user_id  UUID DEFAULT NULL
)
RETURNS TABLE(tag_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT DISTINCT pt.tag_id
    FROM public.photo_tags pt
    INNER JOIN public.photos p ON p.id = pt.photo_id
    WHERE
        (filter_user_id IS NULL OR p.user_id = filter_user_id)
        AND (
            cardinality(current_tag_ids) = 0
            OR p.id IN (
                SELECT pt2.photo_id
                FROM public.photo_tags pt2
                WHERE pt2.tag_id = ANY(current_tag_ids)
                GROUP BY pt2.photo_id
                HAVING COUNT(DISTINCT pt2.tag_id) = cardinality(current_tag_ids)
            )
        );
$$;

GRANT EXECUTE ON FUNCTION public.get_available_related_tags(UUID[], UUID) TO anon, authenticated;


-- ============================================================
-- FUNÇÃO 2: search_photos_by_tags
-- ============================================================
-- Busca paginada de fotos por tags.
--
-- Lógica de filtro (igual ao usePhotoFilters.ts):
--   • primary_tag_ids → foto deve ter pelo menos UMA dessas (OR)
--   • sub_tag_ids     → foto deve ter pelo menos UMA dessas (OR)
--   • Os dois grupos combinam com AND entre si
--   • Se um grupo estiver vazio ([]), essa condição é ignorada
--
-- Parâmetros:
--   primary_tag_ids — tags do grupo primário
--   sub_tag_ids     — tags do grupo secundário
--   filter_user_id  — (opcional) limitar às fotos de um usuário
--   page_number     — página (começa em 1, padrão 1)
--   items_per_page  — itens por página (padrão 20)
--
-- Retorna: id, name, url, local_path, created_at, total_count
--   total_count = total de fotos que batem o filtro (para paginação)
-- ============================================================

CREATE OR REPLACE FUNCTION public.search_photos_by_tags(
    primary_tag_ids UUID[],
    sub_tag_ids     UUID[],
    filter_user_id  UUID DEFAULT NULL,
    page_number     INT  DEFAULT 1,
    items_per_page  INT  DEFAULT 20
)
RETURNS TABLE(
    id          UUID,
    name        TEXT,
    url         TEXT,
    local_path  TEXT,
    created_at  TIMESTAMPTZ,
    total_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH matching AS (
        SELECT p.id, p.name, p.url, p.local_path, p.created_at
        FROM public.photos p
        WHERE
            (filter_user_id IS NULL OR p.user_id = filter_user_id)
            AND (
                cardinality(primary_tag_ids) = 0
                OR EXISTS (
                    SELECT 1 FROM public.photo_tags pt
                    WHERE pt.photo_id = p.id
                      AND pt.tag_id = ANY(primary_tag_ids)
                )
            )
            AND (
                cardinality(sub_tag_ids) = 0
                OR EXISTS (
                    SELECT 1 FROM public.photo_tags pt
                    WHERE pt.photo_id = p.id
                      AND pt.tag_id = ANY(sub_tag_ids)
                )
            )
    ),
    counted AS (
        SELECT *, COUNT(*) OVER() AS total_count
        FROM matching
        ORDER BY created_at DESC
    )
    SELECT id, name, url, local_path, created_at, total_count
    FROM counted
    LIMIT items_per_page
    OFFSET ((page_number - 1) * items_per_page);
$$;

GRANT EXECUTE ON FUNCTION public.search_photos_by_tags(UUID[], UUID[], UUID, INT, INT) TO anon, authenticated;


-- ============================================================
-- VERIFICAÇÃO (opcional — rode após criar as funções)
-- ============================================================
-- SELECT routine_name, routine_type
-- FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN ('get_available_related_tags', 'search_photos_by_tags');
