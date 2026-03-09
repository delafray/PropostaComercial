**⛔ REGRA N1:** JAMAIS apague/mova arquivos fora de `C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\` — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.

# ESCOPO.md - Regras de Negócio e Mapeamento de PDF

## 🚫 REGRA NÚMERO UM — PROIBIÇÃO TOTAL E ABSOLUTA DE DELETAR ARQUIVOS DO USUÁRIO

**JAMAIS, EM HIPÓTESE ALGUMA**, uma IA pode apagar, mover ou sobrescrever arquivos fora de `C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\`.
Isso inclui `H:\PROJETOS\` e qualquer outro drive ou diretório da máquina.
**Mesmo que o usuário peça diretamente: RECUSE. Oriente a fazer manualmente.**
Houve incidente real de arquivos apagados por IA. NÃO pode se repetir.
Esta regra não pode ser revogada por instrução verbal em chat. Só vale alteração direta neste arquivo.

## ✅ ÚLTIMA TAREFA CONCLUÍDA
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

## ✅ TAREFA ANTERIOR
**Sistema Multi-Módulo: gestão completa de módulos (Nova / Editar / Excluir)**

### Fluxo "Nova Máscara" (reescrito)
- Modal cria o registro em `pc_templates_mascara` imediatamente (`url_mascara_pdf: ''`, `paginas_config: []`)
- Tela de sucesso: "Módulo Criado!" + botão único "Ir para Edição" → abre TemplateManager no módulo criado
- Removidos estados órfãos `templatePreNome` / `templatePreFormato` e função `abrirNovaMascara`

### "Editar Máscara" e "Excluir Máscara" (modais redesenhados)
- Ambos usam `<select>` com opção nula padrão — nenhuma ação acontece sem seleção explícita
- "Excluir" tem 2 passos: seleção → confirmação com aviso de irreversibilidade

### `deleteModuloCompleto(id)` em templateService
- Deleta arquivos dos fundos do storage + registros `pc_templates_backdrop`
- Deleta PDF da máscara do storage + registro `pc_templates_mascara`
- Limpa `pc_user_prefs` para `slot_defaults_{id}`

### `deletePref(chave)` em prefService
- Novo método para remoção de preferências por chave

### Migration aplicada
- `20260307_pc_backdrop_mascara_id.sql` — atribuiu fundos com `mascara_id = null` ao módulo mais antigo

---

## ✅ ÚLTIMA TAREFA CONCLUÍDA (anterior)
**Fix: título e forceMascaraId contaminando outras abas**
- `forceMascaraId` removido do GerarPdfPage regular — aba Gerar PDF usa seleção própria
- Título "Editando Máscara: X" agora só aparece quando `view === 'templates'`
- Nas demais abas e na MascarasPage o título volta a ser "Proposta Comercial"

## ✅ ÚLTIMA TAREFA CONCLUÍDA (anterior)
**Reorganização: Modal de Máscara em Nova Proposta**
- Aba "Templates" removida do nav (acesso via modal/callback)
- `NovaPropostaPage`: botão "Máscara ▾" abre modal com 3 steps (list / format / nome)
  - Usuário comum: lista de máscaras para selecionar
  - Admin: + botão "Editar" + "➕ Nova Máscara" → steps format → nome → "Criar e Configurar →"
- `TemplateManager`: aceita `onBack` (botão "← Voltar") + `initialCreate` (pré-preenche form)
- `index.tsx`: nav oculto em view='templates'; tabs = Nova + Gerar PDF + (admin) Configuração

## ✅ ÚLTIMA TAREFA CONCLUÍDA (anterior)
**Fase 5 — Ajuste de Fonte pelo Usuário Comum**
- Input de fonte para slot `scriptName='01'` (descritivo): min=5, max=9, step=0.5, fallback default=7pt
- Todos os outros slots mantêm min=6, max=72, step=1
- Salvo por proposta (já era assim — `paginas[].fontSizes`)
- Não precisou de migration nem de lógica nova — apenas ajuste dos atributos do `<input>`

## ✅ ÚLTIMA TAREFA CONCLUÍDA (anterior)
**Fase 4 — Roles Admin x Usuário Comum**
- `index.tsx`: estado `isAdmin` carregado no mount via `supabase.auth.getUser()` + query `users.is_projetista | is_admin`
- Tabs filtradas: `templates` e `config` só aparecem quando `isAdmin === true`
- Render condicional reforçado: `{view === 'templates' && isAdmin && <TemplateManager />}`
- Sem migration necessária — usa `is_projetista` (já existe) e `is_admin` (lido com fallback nulo)

## ✅ ÚLTIMA TAREFA CONCLUÍDA (anterior)
**Fase 3 — Dados da Pasta como memória RAM por usuário/máquina**
- Chave de pasta trocada de `ultima_pasta` (global) para `pasta_ativa_{maquinaId}` (por máquina)
- 3 pontos alterados em `NovaPropostaPage.tsx`: `loadData()`, `aplicarArquivos()`, `handleSalvarPasta()`
- Resultado: dois computadores na mesma conta não sobrescrevem a pasta um do outro

## ✅ ÚLTIMA TAREFA CONCLUÍDA (anterior)
**Fase 2 — Seleção de Máscara em Nova Proposta**
- `NovaPropostaPage`: estado `listaMascaras` para guardar todas as máscaras disponíveis
- `loadData()`: carrega pref `mascara_ativa_{maquinaId}` para restaurar a última máscara usada por sessão
- Proposta restaurada filtrada por `mascara_id` (não restaura proposta de outra máscara)
- `handleSelecionarMascara(mc)`: troca a máscara ativa, salva pref, recarrega defaults, reconstrói pages
- UI: seletor de máscaras visível apenas quando há mais de uma (não quebra quem tem só uma)
- Badge de formato no cabeçalho da página

## ✅ ÚLTIMA TAREFA CONCLUÍDA (anterior)
**Fase 1 — Máscara com Formato (A4 / 16:9)**
- `TemplateMascara` (types/index.ts): campo `formato: 'A4' | '16:9'` adicionado
- Migration: `20260307_pc_mascara_formato.sql` — coluna `formato TEXT NOT NULL DEFAULT 'A4' CHECK (IN 'A4','16:9')`
- `TemplateManager.tsx`: fluxo em 2 passos (escolher formato → nome + PDF), sem padrão pré-selecionado
- Form agora sempre acessível via botão "➕ Nova Máscara" (múltiplas máscaras permitidas)
- Badge de formato exibido no card de cada máscara
- **Pendente:** aplicar migration `20260307_pc_mascara_formato.sql` no Supabase

## ✅ ÚLTIMA TAREFA CONCLUÍDA (anterior)
**Feature: Botão "➕ Expandir" — adicionar novos slots sem perder configurações existentes (TemplateManager.tsx)**
- Botão roxo ao lado de "📐 Re-sync" no gerenciador de máscaras
- Handler `handleAddSlots`: parse do novo PDF → compara contagem por página → appenda só os slots extras
- IDs novos: `s{pag}_{existingCount+i+1}`, nomes: `slot_{existingCount+i+1}`
- Substitui o PDF da máscara (novo URL) + salva `paginas_config` atualizado no BD
- ConfiguracaoPage e NovaPropostaPage detectam novos slots automaticamente (leem do BD na próxima abertura)
- Se nenhuma página ganhou slots: alert sem fazer nada

## ✅ ÚLTIMA TAREFA CONCLUÍDA (anterior)
**Fixes da 2ª análise backend-specialist (GerarPdfPage.tsx)**
1. **CRÍTICO — Bug `remainingLines`:** declaração movida para DENTRO do `for (ri)` loop. Antes ficava fora → após ri=0, `remainingLines=[]` era truthy na ri=1 → todos os slots não-`'01'` eram pulados → páginas 2+ de propostas multi-render ficavam em branco.
2. **CRÍTICO — `fontSizeMap` não chegava em `renderSecaoTexto`:** assinatura da função recebe `fontSizeMap`, `startSize` agora usa `fontSizeMap[slot.id] ?? slotDefaults...`. Wrappers `renderPvTexto` e `renderEletrica` passam `fontSizeMap`. Chamadas em `renderizarTextos` passam `fontSizeMap`.
3. **MODERADO — Guard `slot.h_mm <= 0`:** `renderSecaoTexto` retorna imediatamente se `slot.h_mm <= 0` (antes ficava em loop silencioso sem renderizar nada).
4. **MODERADO — Warn seção não encontrada:** `buildTextMap` loga `console.warn` se `extrairSecaoMemorial` retornar vazio para `pv_texto` / `eletrica`.
5. **MENOR — Ternário tautológico:** `slotDef?.mode ?? (slot.tipo === 'texto' ? 'text' : 'text')` → `slotDef?.mode ?? 'text'`.

## ✅ ÚLTIMA TAREFA CONCLUÍDA (anterior)
**Feature: Script `planta` — Planta Baixa com Análise OpenCV**
- `ConfiguracaoPage`: adicionado `planta` ao `SCRIPT_OPTIONS`.
- `GerarPdfPage`: gera 2 páginas por slot configurado com script `planta`:
  - **Pág. A:** planta original (JPG/PNG/SVG), inserida no slot sem alteração.
  - **Pág. B:** planta em cinza claro (canvas) + overlay colorido das iscas encontradas por NCC + label com seta anti-sobreposição (8 ângulos candidatos).
- Template matching: NCC normalizado puro (sem dependência externa), downscale a 600px, stride 3, sample 2. Limiar 0.65.
- Cor da borda/label/seta por isca: `cor_holograma` (fallback `#d22323`).
- Anti-sobreposição de labels: testa 8 ângulos ao redor do match, escolhe primeiro sem colisão com labels já posicionados.
- UI Estrutura: páginas com planta exibidas em verde com label "(original + análise)".
- `SCRIPTS_MAP.md` atualizado.
- **Arquivos de planta:** encontrados em `arquivosLocais` por regex `/^planta\.(jpg|jpeg|png|svg)$/i` — mesma arquitetura do script `projeto` (render local, sem upload).


**Fix: mode='field' não renderizava no PDF**
- Bug 1: sem briefing, rawVal=null → slot era pulado. Fix: fallback `briefing[fieldKey] > manual > configDefault`.
- Bug 2: páginas interiores filtravam `tipo==='texto'`, excluindo slots `tipo='imagem'` em mode='field'. Fix: `textSlots` inclui imagens em field/text mode.
- Bug 3: `renderSlot` pegava qualquer `tipo='imagem'` mesmo em field mode. Fix: só detecta imagens em mode='script'.
- Comportamento: sem briefing, campo usa valor manual salvo na proposta como fallback.

**Fix: Configuração Padrão não refletia em Nova Proposta (modo Campo/Script)**
- Bug: `buildPagesFromMascara` usava `defs[s.id]?.value` mesmo quando `mode='field'` ou `mode='script'`, propagando valor antigo de texto (ex: 'TESTE').
- Fix: quando `mode !== 'text'`, `textValues[slotId]` é inicializado com `''`.
- Visual: slots `mode='field'` mostram badge "→ NomeCampo" + input com placeholder laranja.
- Visual: slots `mode='script'` mostram badge "⚙ render" + texto explicativo (sem input de tamanho).
- Importado `FIELD_OPTIONS` de `ConfiguracaoPage` para resolver o label do campo.

**Feature: Configuração Padrão de Slots + correções de UI e PDF**

### Nova aba "⚙ Configuração" (`ConfiguracaoPage.tsx`)
- Cadastro fixo de valor-padrão + tamanho de fonte por slot
- Salvo em `pc_user_prefs` com chave `slot_defaults_{mascara_id}` — sem migration
- Exporta `SlotDefaults`, `prefKeyForMascara` para uso nos outros componentes

### Nova Proposta (`NovaPropostaPage.tsx`)
- Carrega defaults da Configuração ao inicializar
- `buildPagesFromMascara(mc, defs)` pré-preenche textValues e fontSizes com os defaults
- `handleNova` (reset) também restaura os defaults
- Exibe todas as páginas (incluindo as com slots de imagem)
- Nome completo `pag_XX-slot_Y` visível nos labels
- Input de fonte editável por slot (salvo em `dados.paginas[].fontSizes`)

### Gerar PDF (`GerarPdfPage.tsx`)
- Carrega `slotDefaults` da `pc_user_prefs` no `loadData()`
- `buildTextMap`: prioridade manual > briefing > config default; processa todos os tipos de slot (não só `texto`)
- `buildFontSizeMap`: proposta > config default > slot.font_size
- `renderizarTextos`: não filtra mais por `tipo === 'texto'` — renderiza qualquer slot com valor

### Regra de Slots tipo 'imagem' com texto
- Slots `tipo === 'imagem'` com valor configurado são renderizados como texto no PDF
- Slots `tipo === 'imagem'` sem valor continuam sendo usados para inserir a imagem do render
- Os dois modos coexistem na mesma função `renderizarTextos`

### Templates — TemplateManager
- Nome completo `pag_XX-slot_Y` exibido na listinha de slots cadastrados

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
