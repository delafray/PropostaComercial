-- Migration: Adicionar maquina_id à pc_propostas
-- Permite isolar propostas por computador/browser (senha compartilhada não conflita)
-- Propostas antigas ficam com maquina_id = NULL (serão "adotadas" no primeiro save)

ALTER TABLE public.pc_propostas
  ADD COLUMN IF NOT EXISTS maquina_id text;

-- Índice para consultas filtradas por máquina
CREATE INDEX IF NOT EXISTS idx_pc_propostas_maquina_id
  ON public.pc_propostas (maquina_id);
