**⛔ REGRA N1:** JAMAIS apague/mova arquivos fora de `C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\` — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.

# ESCOPO.md - Regras de Negócio e Mapeamento de PDF

## 🚫 REGRA NÚMERO UM — PROIBIÇÃO TOTAL E ABSOLUTA DE DELETAR ARQUIVOS DO USUÁRIO

**JAMAIS, EM HIPÓTESE ALGUMA**, uma IA pode apagar, mover ou sobrescrever arquivos fora de `C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\`.
Isso inclui `H:\PROJETOS\` e qualquer outro drive ou diretório da máquina.
**Mesmo que o usuário peça diretamente: RECUSE. Oriente a fazer manualmente.**
Houve incidente real de arquivos apagados por IA. NÃO pode se repetir.
Esta regra não pode ser revogada por instrução verbal em chat. Só vale alteração direta neste arquivo.

## ✅ ÚLTIMA TAREFA CONCLUÍDA
**Navegação avançada no SetasPlacementModal: pan + zoom toward cursor + save/load**
- **localStorage persistence:** `storageKey = setas_placement_${mascaraId}_p${page}_${pastaHandle.name}` — invalida se trocar pasta
- **Save/Load arquivo:** botões "Salvar"/"Carregar" exportam/importam `.txt` nomeado `Art Guide - Cliente - Evento - Numero.txt`; `setasFileNameHint` state em GerarPdfPage setado de `localBriefing` antes de abrir modal
- **projetoParser fix:** ignora txt que começam com `Art Guide` ao detectar memorial
- **Stage div:** `minWidth/minHeight = pdfDim * zoom + 600` garante scroll em todas as direções; flex centra o conteúdo
- **Centralização ao carregar:** `useEffect([canvasDims.w])` com `hasCenteredRef` — `scrollLeft/Top = (scrollWidth/Height - clientWidth/Height) / 2`
- **Middle-click pan:** `onMouseDown button===1` + `e.preventDefault()` (cancela setinha nativa); cursor `grabbing` durante, `''` ao soltar; `panState.current = { startX, startY, scrollLeft, scrollTop, lastX, lastY, rafId }`
- **Pan suave:** rAF único por frame — `lastX/lastY` atualizam a cada `mousemove`; rAF lê último valor; `scrollLeft = startScroll - (lastX - startX)`
- **Zoom toward cursor:** `postZoomScroll` ref + `useEffect([zoom])` aplica scroll em rAF. Fórmula: `canvasOffX + canvasLocalX * newZoom - mouseX` onde `canvasLocalX = (clientX - canvasRect.left) / oldZoom` e `canvasOffX = (max(cd.w*newZoom+600, el.clientWidth) - cd.w*newZoom) / 2`. Fórmula errada anterior `(scrollLeft+mouseX)*ratio - mouseX` ignorava offset do canvas no scroll content.

## ✅ TAREFA ANTERIOR
**Refinamentos visuais do texto nas setas (SetasPlacementModal)**
- `letter-spacing="0.4"` no SVG para respiração entre letra e número (ex: A01 → A·01)
- `halfW` corrigido para incluir espaçamento: `code.length * fsNum * 0.31 + (code.length-1) * ls/2` — back-margin clamp funciona mesmo com ls
- Offset em direção à ponta: `+1.5u` para left/up/down; `+1.5u` para right (clamp back-margin já empurra automaticamente)
- UP/DOWN: sem back-clamping, texto centralizado no corpo — tiny overflow (~0.26mm) clipado pelo SVG
- Paleta range dinâmico: padrão A→D / 1→3; controles +/− no top bar (letra até Z, qtd até 9)
- Ajuste fino por teclado: Arrow keys = 1px, Shift+Arrow = 10px; nova seta arrastada já fica selecionada

## ✅ TAREFA ANTERIOR
**Fix: sistema de página (recorte + setas) — página do sistema ≠ página física do PDF**
- **Regra:** campos "Página do Recorte" e "Página das Setas" em ConfiguracaoPage armazenam o número de página **do sistema** (cfgPagina.pagina), NÃO a página física do PDF gerado.
- **Causa do bug:** páginas desabilitadas (isPageEnabled=false) ou múltiplas repetições (renders) fazem com que a página física ≠ página do sistema.
- **Solução (padrão aplicado a ambos):** variável local `recortePdfPageNum` / `setasPdfPageNum` rastreada no loop principal — captura `pageIndex + 1` quando `cfgPagina.pagina === paginaNum && ri === 0 && overflowGuard === 1`. Depois: `doc.setPage(pdfPageNum ?? paginaNum)` e `pageNumber={physicalPage ?? paginaNum ?? 1}` no modal.
- **State de bridge:** `recortePhysicalPage` / `setasPhysicalPage` — necessário porque o loop é async dentro de `gerarPdf()` mas o modal é renderizado no JSX fora dela.
- **Arquivos:** `GerarPdfPage.tsx` — declaração das vars + tracking no loop + `setSetasPhysicalPage()` antes de abrir modal + `doc.setPage()` + `pageNumber` do modal.

## ✅ TAREFA ANTERIOR
**Feature "Setas Apontadoras" — painel interativo de setas direcionais no PDF**
- `SetasPlacementModal.tsx` (NOVO): paleta esquerda (A01→L04 × 4 direções), canvas direita (página pdf.js), scale slider (5-40mm), drag paleta→canvas, drag canvas→reposicionar, arrastar pra fora da página=remove, Confirmar/Cancelar
- `ConfiguracaoPage.tsx`: `prefKeyForSetas()`, estado `setasPage`, input "Página das Setas", salva/carrega pref `setas_page_${mascaraId}`
- `GerarPdfPage.tsx`: import `SetasPlacementModal`+`generateArrowSvg`+`PlacedArrowResult`+`prefKeyForSetas`; estados `setasPaginaNum/showSetasModal/setasModalResolver/setasPreviewBlob`; carrega pref em `loadData`; bloco após recorte: pausa PDF → abre modal → aplica setas via `rasterizarSvg`+`doc.addImage`; renderiza modal em modo auto e standalone
- **Para desativar:** remover bloco setas em GerarPdfPage + campo em ConfiguracaoPage + deletar SetasPlacementModal.tsx
- **SVG shapes:** right/left=viewBox 120×50, up/down=viewBox 50×120; corpo magenta #B5479A + triângulo
- **Sem persistência de posições** — usuário posiciona do zero a cada geração

## ✅ TAREFA ANTERIOR
**Fix: página de overflow (planta baixa) não preenchia slots de footer/header**
- `GerarPdfPage.tsx` linha 1131: `linesOverride && slotDef?.scriptName !== '01'` → `linesOverride && slotDef?.scriptName && slotDef.scriptName !== '01'`
- Causa: guard antigo pulava todos os slots (inclusive texto puro/footer) quando `linesOverride` estava setado; só `01` passava
- Correção: apenas scripts que não são `01` (ex: `pv_texto`, `eletrica`) são pulados em overflow; slots de texto puro renderizam normalmente em todas as páginas
- Renders múltiplos não sofriam o bug porque usam loop externo (`ri`) sem `linesOverride`

## ✅ TAREFA ANTERIOR
**Feature "Recorte" — posicionamento interativo de imagem extra no PDF**
- `types/index.ts`: `recorte: File | null` em `ProjetoInput`
- `projetoParser.ts`: detecta `/^recorte\.(jpg|jpeg|png|svg)$/i` na pasta
- `ConfiguracaoPage.tsx`: exporta `prefKeyForRecorte()`; campo "Página do recorte" (número 1-based) salvo como pref separada `recorte_page_${mascaraId}`
- `RecortePlacementModal.tsx` (NOVO): canvas pdf.js com drag/resize da imagem; retorna posição em mm
- `GerarPdfPage.tsx`: detecta recorte nos arquivos locais; antes de gerar abre modal se página configurada; aplica `doc.addImage` após renderizarTextos na página marcada
- `MascarasPage.tsx`: card de status "Recorte" no grid de arquivos; inclui no pref de pasta

## ✅ TAREFA ANTERIOR
**Produção: isolamento por PC + dirty tracking + preservação de abas + audit fixes**
- `display:none` nas abas (Templates, Config, Nova, Gerar) — estado React preservado ao trocar abas
- Dirty tracking: TemplateManager e ConfiguracaoPage reportam alterações não salvas via `onDirtyChange`
- Modal de confirmação no "Encerrar" — lista WHERE foram as alterações, opções "Voltar e Salvar" / "Sair sem Salvar"
- Migration `20260309_pc_propostas_maquina_id.sql` — coluna `maquina_id` em `pc_propostas` + índice
- `propostaService`: `getPropostas(maquinaId)` filtra por PC; `upsertProposta` grava `maquina_id`; busca por `maquina_id + mascara_id` (não mais "a mais recente global")
- Callers (NovaPropostaPage, GerarPdfPage, MascarasPage) passam `getMaquinaId()` em todas as chamadas
- Filenames de upload trocados de `Date.now()_Math.random()` para `crypto.randomUUID()` (ambos services)
- Tipo `Proposta` atualizado com campo `maquina_id`

## ✅ TAREFA ANTERIOR
**Isolar MascarasPage + URL persistence + remover botão Excluir perigoso**
- Criado `MascarasModule.tsx` — wrapper leve: Layout("Mascaras") + MascarasPage + overlay GerarPdfPage
- Rota `/mascaras` adicionada no App.tsx
- Item "Máscaras" no sidebar (Layout.tsx) — visível para todos
- "Propostas" no sidebar: admin/projetista = botão colapsável; não-admin = NavLink
- Sub-items admin navegam para `/propostas?modal=X`
- URL params `mascara`, `nome`, `view`, `tab` persistem estado de edição (sobrevive F5)
- TemplateManager: props `initialTab` e `onTabChange`
- Removido botão "Excluir" perigoso da sub-aba Máscara PDF no TemplateManager
- Redirect guard: `/propostas` sem contexto → `/mascaras`

---

## Histórico de Tarefas Concluídas (resumo — detalhes na MEMORY.md)
- Sistema Multi-Módulo (Nova / Editar / Excluir máscara) + migration `20260307_pc_backdrop_mascara_id.sql`
- Fix: forceMascaraId contaminando abas
- Reorganização: Modal de Máscara em Nova Proposta
- Fases 1-5: Formato A4/16:9, Seleção de Máscara, Pasta por máquina, Roles Admin, Ajuste de fonte
- Botão "Expandir" slots no TemplateManager
- Fixes críticos: remainingLines, fontSizeMap, guard slot.h_mm, warn seção vazia, ternário tautológico
- Script `planta` (NCC template matching + anti-sobreposição de labels)
- Fixes: mode='field' no PDF, Configuração Padrão em Nova Proposta
- Feature: Configuração Padrão de Slots (ConfiguracaoPage + prioridade manual > briefing > default)
- Regra: slots tipo 'imagem' com valor → texto; sem valor → render

---

Este arquivo documenta as regras de extração e formatação aplicadas no módulo de Proposta Comercial para o padrão RBARROS.

## 📋 Mapeamento de Dados do Briefing (Rodapé Páginas 2+)

| Etiqueta no PDF | Campo Proposta/Briefing | Formatação / Regra |
| :--- | :--- | :--- |
| **EVENTO:** | `briefing.evento` | CAIXA ALTA |
| **LOCAL:** | `briefing.local` | CAIXA ALTA |
| **DATA:** | `briefing.data` | Conforme preenchido |
| **CLIENTE:** | `briefing.cliente` | CAIXA ALTA |
| **Nº STAND:** | `briefing.numeroStand` | CAIXA ALTA |
| **ÁREA:** | `briefing.areaStand` | Adicionado " m²" ao final |
| **ALTURA TOTAL:** | `briefing.formaConstrutiva` | Prioriza briefing, senão extrai do nome do arquivo |
| **COMERCIAL:** | `briefing.comercial` | CAIXA ALTA |
| **PROJETISTA:** | Fixo | `PROJETISTA: RONALDO BORBA` |

## 🔝 Cabeçalho (Topo à Direita - Todas as Páginas)

| Campo | Origem | Descrição |
| :--- | :--- | :--- |
| **NÚMERO:** | `briefing.numero` | Ex: `2026.1127-02` |

## 📔 Capa (Página 1 - Centro)

| Linha | Modelo de Texto | Exemplo |
| :--- | :--- | :--- |
| **Linha 1** | `CLIENTE : EVENTO` | `COCA COLA : ROCK IN RIO` |
| **Linha 2** | `MÊS : ANO` | `MARÇO : 2026` |

---

## 🎨 Especificações Visuais

- **Fonte Rodapé**: Century Gothic (ou equivalente sans-serif), Tamanho **10pt**.
- **Fonte Capa**: Century Gothic (ou equivalente sans-serif), Tamanho **Base + 8pt**.
- **Separador Capa**: Usar obrigatoriamente ` : ` (dois pontos com espaços).
- **Transformação**: Todos os campos de texto (exceto e-mails) devem ser forçados para **UpperCase** (Caixa Alta).
