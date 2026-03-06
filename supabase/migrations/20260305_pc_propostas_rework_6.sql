-- Migration 6: Tabela de Propostas (Rascunhos e Finalizadas)
-- Módulo: Proposta Comercial

-- 1. Cria a tabela principal
CREATE TABLE IF NOT EXISTS public.pc_propostas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  mascara_id uuid REFERENCES public.pc_templates_mascara(id) ON DELETE SET NULL,
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('rascunho', 'finalizada')) DEFAULT 'rascunho',
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Habilita RLS
ALTER TABLE public.pc_propostas ENABLE ROW LEVEL SECURITY;

-- 3. Políticas de Segurança (RLS)
-- Leitura para usuários autenticados
CREATE POLICY "Enable read access for authenticated users 6" ON public.pc_propostas FOR SELECT TO authenticated USING (true);

-- Escrita para equipe interna (admin ou projetistas)
CREATE POLICY "Enable make changes internally 6" ON public.pc_propostas FOR ALL TO authenticated USING (
  exists (select 1 from users where id = auth.uid() and (is_admin = true or is_projetista = true))
);
