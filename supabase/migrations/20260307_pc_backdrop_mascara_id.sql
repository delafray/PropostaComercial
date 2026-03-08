-- Migration: Atribuir fundos existentes (mascara_id = null) ao módulo mais antigo
-- Contexto: fundos cadastrados antes da multi-módulo têm mascara_id = null.
-- Esta migration os vincula ao primeiro módulo (mascara) criado pelo usuário.

UPDATE pc_templates_backdrop
SET mascara_id = (
    SELECT id FROM pc_templates_mascara
    ORDER BY created_at ASC
    LIMIT 1
)
WHERE mascara_id IS NULL
  AND EXISTS (SELECT 1 FROM pc_templates_mascara LIMIT 1);
