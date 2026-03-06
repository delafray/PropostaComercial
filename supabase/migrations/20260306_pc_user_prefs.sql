-- ============================================================
-- Tabela de preferências do usuário para o módulo Proposta Comercial
-- Armazena pares chave-valor JSONB por usuário (ex: 'ultima_pasta')
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pc_user_prefs (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid        REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  chave      text        NOT NULL,
  valor      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(user_id, chave)
);

ALTER TABLE public.pc_user_prefs ENABLE ROW LEVEL SECURITY;

-- Lê as próprias prefs (is_projetista ou is_admin)
CREATE POLICY "pc_user_prefs: lê próprias prefs"
  ON public.pc_user_prefs FOR SELECT
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND (u.is_projetista = true OR u.is_admin = true)
    )
  );

-- Insere as próprias prefs (is_projetista ou is_admin)
CREATE POLICY "pc_user_prefs: insere próprias prefs"
  ON public.pc_user_prefs FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND (u.is_projetista = true OR u.is_admin = true)
    )
  );

-- Atualiza as próprias prefs
CREATE POLICY "pc_user_prefs: update próprias prefs"
  ON public.pc_user_prefs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Índice para busca rápida por usuário + chave
CREATE INDEX IF NOT EXISTS idx_pc_user_prefs_user_chave
  ON public.pc_user_prefs(user_id, chave);
