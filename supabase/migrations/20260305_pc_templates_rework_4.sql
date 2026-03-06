-- Migration: Complementa o schema dos 3 pilares
-- Executar APÓS 20260305_pc_templates_rework_3.sql
-- Esta migration adiciona os campos faltantes em pc_templates_backdrop

-- 1. Tipo do arquivo (PNG, JPG, SVG) — necessário para renderização correta no frontend
ALTER TABLE public.pc_templates_backdrop
  ADD COLUMN IF NOT EXISTS tipo_arquivo text NOT NULL DEFAULT 'PNG'
    CHECK (tipo_arquivo IN ('PNG', 'JPG', 'SVG'));

-- 2. Vínculo com a máscara — cada fundo pertence a uma máscara de diagramação
ALTER TABLE public.pc_templates_backdrop
  ADD COLUMN IF NOT EXISTS mascara_id uuid
    REFERENCES public.pc_templates_mascara(id) ON DELETE SET NULL;
