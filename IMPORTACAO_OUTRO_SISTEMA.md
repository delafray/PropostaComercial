**AVISO PARA IAs:** Se durante qualquer tarefa você descobrir algo que impacte a exportação/importação deste módulo (nova dependência externa, nova tabela, novo bucket, nova fonte, novo hardcode), **ACRESCENTE neste arquivo** na seção apropriada. Este documento deve estar sempre atualizado.

---

# Transplante do Módulo PropostaComercial

Este documento contém dois planos completos:
- **Plano A** — Checklist de PRE-EXPORTAÇÃO (rodar no sistema de origem)
- **Plano B** — Guia de IMPORTAÇÃO (rodar no sistema de destino)

O módulo é 100% isolado em `src/features/PropostaComercial/`. Nenhum arquivo externo importa dele.

---

# PLANO A — PRE-EXPORTAÇÃO (verificar antes de copiar)

> **Quem executa:** IA no sistema de ORIGEM, antes de entregar a pasta ao destino.

## 1. Verificar integridade dos arquivos do módulo

Confirmar que todos estes arquivos existem e não estão vazios:

```
src/features/PropostaComercial/
├── index.tsx                        ← Entry point principal
├── MascarasModule.tsx               ← Entry point alternativo (rota /mascaras)
├── types/
│   └── index.ts                     ← Todos os tipos exportados
├── services/
│   ├── templateService.ts           ← CRUD templates + storage
│   ├── propostaService.ts           ← CRUD propostas + storage
│   └── prefService.ts               ← Preferências do usuário
├── utils/
│   ├── fontLoader.ts                ← Carregamento de fontes + renderização vetorial
│   ├── briefingParser.ts            ← Extração de dados do PDF de briefing
│   ├── mascaraParser.ts             ← Detecção de slots em PDFs de máscara
│   ├── visualizacaoUtils.ts         ← Renderização de página PDF → imagem
│   ├── projetoParser.ts             ← Classificação de arquivos da pasta
│   ├── pastaHandle.ts               ← File System Access API
│   ├── pdfUtils.ts                  ← Utilitários PDF
│   └── maquinaId.ts                 ← Fingerprint de sessão/perfil
└── components/
    ├── GerarPdfPage.tsx             ← Geração de PDF (arquivo mais complexo)
    ├── TemplateManager.tsx          ← Editor de templates
    ├── NovaPropostaPage.tsx         ← Formulário nova proposta
    ├── MascarasPage.tsx             ← Importador de pasta + status
    ├── ConfiguracaoPage.tsx         ← Configuração de slots
    ├── RecortePlacementModal.tsx    ← Posicionamento de recorte no PDF
    └── PdfActionModal.tsx           ← Modal de ações do PDF gerado
```

## 2. Verificar dependências externas (APENAS 2)

Grep nos arquivos do módulo por imports que saem da pasta. Devem existir **exatamente** estes:

| Import | Arquivos que usam | O que importa |
|---|---|---|
| `../../../../services/supabaseClient` | 6 arquivos (3 services + index.tsx + GerarPdfPage.tsx + MascarasModule.tsx) | `{ supabase }` |
| `../../../components/Layout` | 2 arquivos (index.tsx + MascarasModule.tsx) | `default export Layout` |

**Se houver QUALQUER outro import externo não listado aqui, documente-o antes de exportar.**

## 3. Verificar fontes em `public/fonts/`

Estes 8 arquivos TTF devem existir:

| Arquivo | Família (no jsPDF) | Estilo |
|---|---|---|
| `Arial.ttf` | helvetica | normal |
| `ArialBold.ttf` | helvetica | bold |
| `ArialItalic.ttf` | helvetica | italic |
| `ArialBoldItalic.ttf` | helvetica | bolditalic |
| `CenturyGothic.ttf` | century-gothic | normal |
| `CenturyGothicBold.ttf` | century-gothic | bold |
| `CenturyGothicItalic.ttf` | century-gothic | italic |
| `CenturyGothicBoldItalic.ttf` | century-gothic | bolditalic |

Caminho de fetch no código: `/fonts/{arquivo}` (relativo ao `public/`).

## 4. Verificar migrations

As seguintes migrations SQL devem ser copiadas junto (ordem de aplicação):

| # | Arquivo | O que faz |
|---|---|---|
| 1 | `20260305_pc_FULL_APPLY.sql` | Cria as 4 tabelas core + RLS + `is_projetista` em `users` |
| 2 | `20260306_pc_user_prefs.sql` | Tabela `pc_user_prefs` (se não coberta pelo FULL_APPLY) |
| 3 | `20260307_pc_mascara_formato.sql` | Coluna `formato` em `pc_templates_mascara` |
| 4 | `20260307_pc_backdrop_mascara_id.sql` | Vincula backdrops órfãos ao módulo mais antigo |
| 5 | `20260309_pc_propostas_maquina_id.sql` | Coluna `maquina_id` em `pc_propostas` + índice |

## 5. Verificar pacotes npm do módulo

Estes pacotes são usados **dentro** do módulo e devem existir no `package.json` do destino:

| Pacote | Versão mínima | Usado para |
|---|---|---|
| `jspdf` | ^4.1.0 | Geração de PDF |
| `svg2pdf.js` | ^2.7.0 | Renderização SVG→PDF |
| `pdfjs-dist` | ^3.11.174 | Parsing de PDFs (briefing, máscara, preview) |
| `jszip` | ^3.10.1 | Manipulação de ZIP |
| `opentype.js` | ^1.3.4 | Métricas de fonte + paths vetoriais |
| `file-saver` | ^2.0.5 | Download de arquivos no browser |
| `@supabase/supabase-js` | ^2.47.10 | Cliente Supabase |

DevDependencies (tipos):
| Pacote | Versão |
|---|---|
| `@types/file-saver` | ^2.0.7 |
| `@types/opentype.js` | ^1.3.9 |

## 6. Gerar pacote de exportação

Copiar para o destino:
1. Pasta `src/features/PropostaComercial/` (inteira)
2. Pasta `public/fonts/` (8 TTFs)
3. Migrations SQL listadas acima
4. Este arquivo (`IMPORTACAO_OUTRO_SISTEMA.md`)

---

# PLANO B — IMPORTAÇÃO (executar no sistema de destino)

> **Quem executa:** IA no sistema de DESTINO, com o pacote exportado em mãos.

## Contexto Geral

O módulo **PropostaComercial** é um gerador de PDFs comerciais com:
- Templates configuráveis (máscara PDF + fundos visuais + referências OpenCV)
- Propostas por cliente com dados extraídos de briefing PDF
- Geração de PDF vetorial com texto como paths (compatível com CorelDraw)
- Posicionamento interativo de recortes
- Preferências por usuário/máquina
- Roles: admin/projetista (gerencia templates) vs usuário comum (gera PDFs)

**Base tecnológica esperada:** React + Vite + TailwindCSS + TypeScript + Supabase (mesma instância).

## Passo 1 — Copiar arquivos

```
# Copiar módulo
src/features/PropostaComercial/  →  {destino}/src/features/PropostaComercial/

# Copiar fontes (se não existirem)
public/fonts/*.ttf               →  {destino}/public/fonts/
```

## Passo 2 — Ajustar imports externos

Existem **exatamente 2 imports** que apontam para fora do módulo. Ajustar os caminhos relativos conforme a estrutura do destino:

### 2a. Supabase Client (6 arquivos)

Buscar por: `../../../../services/supabaseClient`

Arquivos:
- `services/templateService.ts`
- `services/propostaService.ts`
- `services/prefService.ts`
- `index.tsx`
- `MascarasModule.tsx`
- `components/GerarPdfPage.tsx`

Substituir pelo caminho correto do `supabaseClient` no sistema destino. O import espera:
```typescript
import { supabase } from '{caminho}/supabaseClient';
// onde `supabase` é uma instância de createClient() do @supabase/supabase-js
```

### 2b. Layout Component (2 arquivos)

Buscar por: `../../../components/Layout`

Arquivos:
- `index.tsx`
- `MascarasModule.tsx`

Substituir pelo caminho do `Layout` do sistema destino. O import espera:
```typescript
import Layout from '{caminho}/Layout';
// Layout recebe: children, title (string)
// Renderiza: sidebar + header + conteúdo
```

## Passo 3 — Instalar pacotes npm

```bash
npm install jspdf svg2pdf.js pdfjs-dist jszip opentype.js file-saver
npm install -D @types/file-saver @types/opentype.js
```

## Passo 4 — Registrar rotas no App.tsx

Adicionar no router do sistema destino:

```tsx
import PropostaComercial from './src/features/PropostaComercial';
import MascarasModule from './src/features/PropostaComercial/MascarasModule';

// Dentro das rotas protegidas:
<Route path="/propostas" element={<ProtectedRoute><PropostaComercial /></ProtectedRoute>} />
<Route path="/mascaras" element={<ProtectedRoute><MascarasModule /></ProtectedRoute>} />
```

## Passo 5 — Adicionar itens no sidebar (Layout.tsx)

O módulo espera 2 links no menu:
- **"Propostas"** → `/propostas` (admin/projetista: colapsável com sub-items)
- **"Máscaras"** → `/mascaras` (visível para todos)

## Passo 6 — Aplicar migrations no Supabase

**IMPORTANTE:** Aplicar na ordem. Todas as tabelas são prefixadas com `pc_` para não conflitar.

### Tabela `users` (pré-requisito)

O sistema destino deve ter a tabela `users` com pelo menos estas colunas:
```sql
id uuid PRIMARY KEY
is_admin boolean
is_projetista boolean  -- se não existir, a migration FULL_APPLY adiciona
```

### Tabelas criadas pelo módulo

#### `pc_templates_mascara`
```sql
CREATE TABLE public.pc_templates_mascara (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome text NOT NULL,
    formato text NOT NULL DEFAULT 'A4' CHECK (formato IN ('A4', '16:9')),
    url_mascara_pdf text NOT NULL,
    paginas_config jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);
```

#### `pc_templates_backdrop`
```sql
CREATE TABLE public.pc_templates_backdrop (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome text NOT NULL,
    url_imagem text NOT NULL,
    tipo_arquivo text NOT NULL DEFAULT 'PNG' CHECK (tipo_arquivo IN ('PNG', 'JPG', 'SVG')),
    mascara_id uuid REFERENCES public.pc_templates_mascara(id) ON DELETE SET NULL,
    created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);
```

#### `pc_templates_referencia`
```sql
CREATE TABLE public.pc_templates_referencia (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome_item text NOT NULL,
    url_imagem_referencia text NOT NULL,
    cor_holograma text,
    created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);
```

#### `pc_propostas`
```sql
CREATE TABLE public.pc_propostas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome text NOT NULL,
    mascara_id uuid REFERENCES public.pc_templates_mascara(id) ON DELETE SET NULL,
    maquina_id text,
    dados jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'finalizada')),
    created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);
```

#### `pc_user_prefs`
```sql
CREATE TABLE public.pc_user_prefs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    chave text NOT NULL,
    valor jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz DEFAULT timezone('utc', now()) NOT NULL,
    UNIQUE(user_id, chave)
);
```

### Indices
```sql
CREATE INDEX IF NOT EXISTS idx_pc_propostas_mascara ON public.pc_propostas(mascara_id);
CREATE INDEX IF NOT EXISTS idx_pc_propostas_status ON public.pc_propostas(status);
CREATE INDEX IF NOT EXISTS idx_pc_propostas_maquina_id ON public.pc_propostas(maquina_id);
CREATE INDEX IF NOT EXISTS idx_pc_user_prefs_user_chave ON public.pc_user_prefs(user_id, chave);
```

### RLS (Row Level Security)

Habilitar RLS em todas as tabelas `pc_*` e criar policies:

- **Templates (mascara, backdrop, referencia):** SELECT para todos autenticados; INSERT/UPDATE/DELETE para `is_admin = true` ou `is_projetista = true`
- **Propostas:** SELECT/INSERT/UPDATE para todos autenticados (cada user vê todas — filtro por `maquina_id` é no app)
- **User Prefs:** SELECT/INSERT/UPDATE/DELETE apenas para o próprio `user_id = auth.uid()`

### Storage Bucket

Criar bucket **`pc_arquivos`** no Supabase Storage:
- Público: sim (URLs públicas para PDFs e imagens)
- Estrutura de pastas:
  - `templates/mascaras/{uuid}.pdf`
  - `templates/backdrops/{uuid}.{png|jpg|svg}`
  - `templates/referencias/{uuid}.{png|jpg}`
  - `propostas/{uuid}/{filename}`

## Passo 7 — Verificar fontes

Confirmar que `public/fonts/` contém os 8 TTFs listados no Plano A. O `fontLoader.ts` faz fetch de `/fonts/{arquivo}` em runtime — se faltar, o PDF gera mas o texto fica em fonte padrão do jsPDF.

## Passo 8 — Testar

1. Acessar `/mascaras` — deve carregar sem erro
2. Acessar `/propostas` — deve mostrar tela de nova proposta
3. Se admin: verificar que abas "Templates" e "Configuracao" aparecem
4. Criar uma máscara de teste, subir um PDF, verificar que slots são detectados
5. Gerar um PDF de teste

---

# Hardcodes conhecidos (NÃO TOCAR sem necessidade)

| O que | Onde | Risco |
|---|---|---|
| CDN pdfjs v3.11.174 | `briefingParser.ts`, `mascaraParser.ts`, `visualizacaoUtils.ts`, `RecortePlacementModal.tsx` | Quebra se `npm update` mudar a versão do pdfjs-dist |
| `PAGE_H_PT = 595.28` | `mascaraParser.ts` | Correto para A4, falha com outros formatos |
| Cor de slot `#00ff00` | `mascaraParser.ts` | Só detecta retangulos verdes como slots |
| Fetch `/fonts/{file}` | `fontLoader.ts` | Espera fontes em `public/fonts/` |
| Bucket `pc_arquivos` | `templateService.ts`, `propostaService.ts` | Nome fixo do bucket |
| `@ts-nocheck` em ~7 arquivos | Vários componentes | Não remover — expõe erros de compilação sem impacto funcional |

---

# Registro de Alterações deste Documento

| Data | O que mudou |
|---|---|
| 2026-03-09 | Criação inicial com Planos A e B completos |
