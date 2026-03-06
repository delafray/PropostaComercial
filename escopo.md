# ESCOPO.md - Regras de Negócio e Mapeamento de PDF

## ✅ ÚLTIMA TAREFA CONCLUÍDA
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
