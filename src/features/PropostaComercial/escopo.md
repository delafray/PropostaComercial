**⛔ REGRA N1:** JAMAIS apague/mova arquivos fora de `C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\` — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.

﻿# Escopo: Sistema de Proposta Comercial

---

## ✅ ÚLTIMA TAREFA CONCLUÍDA

**Revisão de qualidade + 8 bug fixes (2026-03-07)**

Fixes aplicados e testados:
1. Memory leak: `revokeObjectURL` movido para `finally` em `GerarPdfPage.tsx`
2. Campos debug `_tokens`/`_diag` removidos de `briefingParser.ts` (não vazam mais pro banco)
3. Null guard em `prefService.ts` — `getUser()` não explode mais se `data` for null
4. Log de erro em `templateService.deleteFileByUrl` — falhas de storage agora visíveis no console
5. Conversão TTF→base64 otimizada para O(n) com chunks de 8KB em `fontLoader.ts`
6. Limite de 50 iterações no `do/while` de overflow do descritivo em `GerarPdfPage.tsx`
7. Race condition em `propostaService.upsertProposta` — aceita `existingId` para skip do select
8. Sort de renders com NaN corrigido em `projetoParser.ts` — arquivos sem número vão para o fim

---

## 🤖 PROTOCOLO PARA IAs — LEIA ANTES DE QUALQUER COISA

### PRINCÍPIO FUNDAMENTAL: Quem Define os Slots é o Usuário

> ⚠️ **NUNCA** use `s.tipo === 'imagem'` (ou qualquer campo `tipo`) para decidir comportamento de um slot na geração do PDF.

O usuário define o que cada slot faz através da aba **Configurações** da aplicação. A fonte da verdade é sempre:
```
slotDefaults[slot.id] → campos `mode` e `scriptName`
```

---

### 📋 PROTOCOLO: Como Adicionar um Novo Script

Quando o usuário pedir um novo script, siga estes passos **nesta ordem**:

| Passo | Arquivo | O que fazer |
|---|---|---|
| 1 | `ConfiguracaoPage.tsx` → `SCRIPT_OPTIONS` | Adicionar `{ name, label, description }` |
| 2 | `GerarPdfPage.tsx` → `buildTextMap()` | Lógica de **texto** (produz string), ex: `hoje`, `mes_ano` |
| 2 (alt) | `GerarPdfPage.tsx` → Loop principal | Lógica de **imagem/página** (duplica páginas), ex: `projeto` |
| 3 | `ConfiguracaoPage.tsx` → `showStyle` | Ocultar estilo se não fizer sentido para o script |
| 4 | `SCRIPTS_MAP.md` | **Documentar com todos os detalhes** |

> ⭐ **O `SCRIPTS_MAP.md` é o mapa oficial de todos os scripts.** O usuário vai trabalhar nos scripts ao longo do tempo. Sempre que implementar ou alterar um script, atualize o `SCRIPTS_MAP.md`.

---

### 🔄 Iteração de Scripts (Comportamento Esperado)

O usuário pode voltar ao mesmo script várias vezes para refinamentos (ex: mudar ordenação, alterar como a imagem é inserida, adicionar uma borda, etc.). Por isso:

1. Sempre consulte o `SCRIPTS_MAP.md` para entender o estado atual antes de editar.
2. Após qualquer alteração, atualize a documentação do script em `SCRIPTS_MAP.md`.
3. Scripts são **vivos** — nascem simples e crescem com uso.

---

### 🏗️ Arquitetura dos Renders (Fonte dos dados de imagem)

- **No banco** (`dados.renders`): apenas os **nomes dos arquivos** (`['10.jpg', '11.jpg', ...]`)
- **Físico**: arquivos ficam **no computador do usuário**, na pasta do projeto
- **Leitura**: via **File System Access API** (`pastaHandle`), sem upload para a nuvem
- **Ao gerar PDF**: o sistema pede permissão de acesso à pasta automaticamente se necessário

---

### 🔐 Pontos de Restauração Git

Se algo quebrar, os branches de segurança no GitHub são:

| Branch | Estado |
|---|---|
| `backup-estavel-a14afc7` | Backup original (pré-limpeza) |
| `limpo` | Pós-limpeza de código legado |
| `ponto-estavel-projeto` | ✅ Script `projeto` validado e funcional |

Para restaurar: `git checkout ponto-estavel-projeto`

---



## 0. Instruções para IAs Futuras (Handover)
> **MENSAGEM DO ARQUITETO:**
> Este módulo está sendo construído de forma **Iterativa, Lenta e Sequencial**. Não tente criar soluções monolíticas nem injetar dependências massivas de uma vez.
>
> *   **Nossa Metodologia:** 1) O humano pede um tijolo; 2) Nós analisamos se fere o isolamento; 3) Criamos mini-planos locais; 4) Só codificamos com o 'De Acordo' do humano.
> *   **Regra de Ouro (Isolamento + Portabilidade):** Todo o Módulo "PropostaComercial" está sendo injetado numa pasta de contexto própria (`src/features/PropostaComercial`). Todas as tabelas no Supabase iniciam com **`pc_`**. O sistema mestre "Galeria de Fotos" **não pode ser afetado** e vice-versa.
> *   **⚠️ REGRA CRÍTICA — Módulo Transplantável:** Este módulo foi projetado para ser **extraído e transplantado para outro sistema no futuro**, sem refatoração profunda. Isso significa:
>     *   **NUNCA misturar código** deste módulo com o sistema "Galeria de Fotos" (App.tsx, Layout.tsx, services/ globais, etc.).
>     *   A única dependência externa permitida é o cliente Supabase (`supabaseClient`), que será substituído pelo equivalente do sistema de destino na hora do transplante.
>     *   Todo o resto (tipos, serviços, componentes) deve viver **100% dentro de `src/features/PropostaComercial/`**.
> *   **Autonomia da IA (Autorização Total):** Este sistema é ambiente de **teste**. A IA tem **autorização total** para criar, editar e deletar qualquer arquivo dentro de `C:\Users\ronal\Documents\Antigravity\Proposta_Comercial` sem pedir confirmação prévia.

---

## 1. Contexto do Negócio
- **Profissão:** Designer de projetos.
- **Processo atual:** Apresenta propostas comerciais que possuem uma estrutura/layout sempre igual.
- **Ferramenta atual:** CorelDRAW.
- **Dor/Problema:** O trabalho é altamente manual — precisa redigitar dados do cliente no CorelDRAW para gerar cada proposta.

## 2. Solução Implementada
- Sistema gera propostas automaticamente sobre uma "máscara" (template SVG de fundo).
- Dados textuais (nome do cliente, evento, etc.) são preenchidos em slots configuráveis.
- Renders (imagens 3D do projeto) são lidos da pasta local do usuário e inseridos automaticamente.
- A proposta final é gerada como PDF via jsPDF (A4 paisagem, 297×210mm).

## 3. Arquivos de Entrada Padrão
1. **Renders (Imagens 3D):** Arquivos nomeados numericamente (`10.jpg`, `11.jpg`...). Ordenação crescente — menor número = maior prioridade.
2. **Briefing:** Dados textuais (cliente, evento, local, data, etc.).
3. **Planta Baixa:** Para análise futura com OpenCV.
4. **Memorial Descritivo (TXT):** Texto tabular com colunas: ID, Quantidade, Unidade, Descrição. Gerado pelo script `01`.
5. **Template Vetorial (Máscara SVG):** Fundo das páginas — leve e com resolução infinita.

## 4. Estrutura do Banco de Dados (Supabase)

| Tabela | Função |
|---|---|
| `pc_templates_backdrop` | Fundos das páginas (SVG/PNG/JPG) |
| `pc_templates_mascara` | Máscaras com `paginas_config` (slots por página) |
| `pc_templates_referencia` | Iscas para OpenCV (futuro) |
| `pc_propostas` | Propostas salvas com briefing, renders e pasta local |
| `pc_user_prefs` | Preferências do usuário (última pasta, slot defaults, etc.) |

## 5. Regras de Geração de Páginas (Renders)
- O script `projeto` clona a página para cada render.
- Ordenação numérica crescente estrita: `10 < 11 < 12...`
- Os arquivos ficam **locais no computador** — o banco guarda apenas o nome.

## 6. Motor OpenCV (Futuro — Não Implementado)
- Análise de Planta Baixa com visão computacional client-side.
- Busca de referências (ex: Mesa Amarela) suportando rotações.
- Algoritmo anti-colisão de etiquetas com bounding boxes.

## 7. Gerenciamento de Templates
1. **Fundos (Backdrops):** Imagens visuais (SVG/PNG/JPG) para o fundo das páginas.
2. **Máscaras:** PDF com réguas matemáticas — define slots (posição, tamanho, tipo) em cada página.
3. **Referências OpenCV:** Recortes de imagem para varredura de planta baixa (futuro).
