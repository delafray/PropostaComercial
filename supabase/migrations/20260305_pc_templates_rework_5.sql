-- Migration: Adiciona configuração de páginas às Máscaras PDF
-- Cada Máscara armazena um array JSON com a descrição de comportamento de cada página.
-- Exemplo: [{"pagina": 1, "descricao": "Capa com logo do cliente"}, ...]

ALTER TABLE public.pc_templates_mascara
  ADD COLUMN IF NOT EXISTS paginas_config jsonb NOT NULL DEFAULT '[]'::jsonb;
