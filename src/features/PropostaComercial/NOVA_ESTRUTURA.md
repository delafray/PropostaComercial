**⛔ REGRA N1:** JAMAIS apague/mova arquivos fora de `C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\` — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.

# Nova Estrutura — Módulo Proposta Comercial

> Arquivo de requisitos registrados antes da implementação.
> Cada tópico será marcado ✅ quando implementado e aprovado.

---

## Tópicos Registrados

### Tópico 1 — Preservação da tela "Máscaras" (MascarasPage)
- A tela acessada pelo menu lateral "Propostas > Máscaras" deve permanecer **exatamente como está** no fim do processo.
- Inclui: Pasta do Projeto, última pasta usada, botão Selecionar Pasta, input de fonte, botão Gerar PDF, card da proposta encontrada na pasta, seletor de Máscara ativa.
- Nenhuma alteração funcional ou visual nessa tela.

### Tópico 2 — Preservação do fluxo "Editar Máscara"
- O sub-item **"Editar Máscara"** no menu lateral deve permanecer **exatamente como está**.
- Inclui: modal de seleção de máscara → navega para aba Templates com sessão de edição ativa.
- Nenhuma alteração funcional ou visual nesse fluxo.

### Tópico 3 — Sistema Multi-Módulo de Proposta Comercial
- O sistema atual tem **um único módulo** de Proposta Comercial.
- O novo sistema terá **múltiplos módulos independentes** de Proposta Comercial.
- Cada módulo é **completamente isolado** e contém tudo que o módulo atual tem:
  - Suas próprias Máscaras PDF
  - Seus próprios Fundos
  - Suas próprias Iscas OpenCV
  - Suas próprias configurações de páginas e slots
  - Suas próprias abas: Registro de Projeto | Gerar PDF | Templates | Configuração
  - Seus próprios sub-itens: Máscaras | Nova Máscara | Editar Máscara
- **Fluxo de acesso:**
  1. `/propostas` → tela de lista com todos os módulos de Proposta Comercial do usuário
  2. Clicar em um módulo → abre aquele módulo completo e isolado (todas as abas/sub-abas)
  3. Criar novo → cria um módulo novo do zero com configuração própria
- Nenhum módulo herda dados, máscara, fundo ou configuração de outro.

### Tópico 4 — O que é um "Módulo" (terminologia)
- No sistema, o que o usuário chama de **"Máscara"** É o módulo completo de Proposta Comercial.
- Cada módulo ("Máscara") contém internamente:
  - Seus próprios PDFs de máscara (sub-aba "Máscaras PDF")
  - Seus próprios fundos (sub-aba "Fundos")
  - Suas próprias iscas OpenCV (sub-aba "Iscas OpenCV")
  - Sua própria configuração de páginas e slots
  - Todas as abas: Registro de Projeto | Gerar PDF | Templates | Configuração
- A terminologia do menu lateral:
  - **"Nova Máscara"** = criar um novo módulo completo (nome + formato A4/16:9 → abre completamente vazio)
  - **"Editar Máscara"** = selecionar um módulo existente e entrar nele para editar Templates
  - **"Máscaras"** (MascarasPage) = tela de geração rápida de PDF usando o módulo ativo selecionado
- Criar "Nova Máscara" abre um TemplateManager completamente limpo — o usuário configura tudo do zero: faz upload de PDFs de máscara, cadastra fundos, define páginas/slots, etc.
- Cada módulo tem as **mesmas funcionalidades** que o sistema atual, porém **totalmente independente**.

### Tópico 5 — Arquitetura de Dados: O que é isolado vs. o que é global

#### GLOBAL (compartilhado entre todos os módulos)
- **Scripts** (pv_texto, eletrica, programacao_visual, projetista, etc.) — são funções do motor de geração. Se um script for alterado, muda o comportamento em **todos os módulos** que o utilizam.
- **Motor de geração de PDF** — o engine (`GerarPdfPage`) é único e compartilhado.
- **Parser de pasta** — o mecanismo de leitura de pasta (renders, briefing, planta, altura, logo, descritivo) é compartilhado.

#### POR MÓDULO (isolado, pertence a uma "Máscara" específica)
- PDFs de máscara enviados (define o mapeamento matemático X/Y dos slots)
- Fundos (backgrounds por página)
- Iscas OpenCV
- Configuração de páginas e slots (quais slots existem, qual script está atribuído a cada slot)
- Nome e formato (A4 / 16:9)

#### POR SESSÃO / PROJETO (temporário — carregado da pasta)
- Quando o usuário seleciona uma pasta, o sistema lê e salva temporariamente no banco:
  - Renders (imagens numeradas)
  - Briefing PDF (ex: `9182.pdf`)
  - Planta baixa
  - Altura do estande
  - Logo do cliente
  - Descritivo (`.txt`)
- Esses dados ficam **disponíveis para todos os módulos** usarem na geração do PDF.
- O fluxo de carregamento de pasta é o mesmo — não muda com a multi-módulo.

#### Consequência prática
- Criar um novo módulo → ele **já conhece todos os scripts** (são globais no código).
- O usuário só precisa configurar: qual máscara PDF usar, quais fundos, quais slots, qual script por slot.
- Dados do projeto (briefing, renders, etc.) são carregados uma vez e usados por qualquer módulo.

### Tópico 6 — Isolamento por Módulo: Confirmado pelo código atual

**Pergunta:** Ao selecionar outro módulo no dropdown "Máscara ativa", o sistema carrega os dados daquele módulo sem misturar com outro?

**Resposta: SIM — confirmado pelo código.**

#### O que JÁ é isolado por módulo (`mascara_id`) hoje:
- `slotDefaults` — carregado via `prefKeyForMascara(mc.id)` → cada módulo tem suas próprias configurações de fonte, scripts por slot
- `paginas_config` — pertence ao registro da máscara no banco (`pc_templates_mascara`), independente por módulo
- Fundos (`pc_templates_backdrop`) — associados por módulo via `backdrop_ids`
- Iscas OpenCV (`pc_templates_referencia`) — associadas por módulo
- `TemplateManager` e `ConfiguracaoPage` — recebem `mascaraId` como prop, sempre carregam dados do módulo correto

#### Fluxo confirmado no código (`MascarasPage.tsx`):
1. Ao trocar o dropdown "Máscara ativa" → chama `selecionarMascara(mc)`
2. Salva o ID da nova máscara ativa na preferência por máquina (`mascara_ativa_${maquinaId}`)
3. Carrega `slotDefaults` do novo módulo via `prefKeyForMascara(mc.id)`
4. O botão "Gerar PDF" usa `mascaraAtiva.paginas_config` → configuração do módulo ativo
5. **Zero mistura entre módulos nas configurações.**

#### Observação técnica (não é bug, é comportamento atual aceito):
- O card de proposta em MascarasPage busca `propostaService.getPropostas()` e usa `propostas[0]` — não filtra por `mascara_id`.
- Isso é consistente com o Tópico 5: dados do projeto (briefing, renders) são globais/temporários, disponíveis para qualquer módulo usar.
- **Não deve ser alterado** (Tópico 1 — MascarasPage intacta).

### Tópico 7 — "Editar Máscara": Isolamento confirmado por módulo

**Pergunta:** Ao selecionar um módulo via "Editar Máscara", os dados carregados são exclusivamente daquele módulo?

**Resposta: SIM — já funciona assim. Confirmado pelo código.**

#### Fluxo atual (já correto):
1. Usuário clica "Editar Máscara" → `EditarMascaraModal` lista TODOS os módulos cadastrados
2. Usuário seleciona um módulo → `mascaraIdParaEditar` recebe o ID escolhido
3. `TemplateManager` recebe o ID → **filtra e exibe apenas aquele módulo** (`mascaras.filter(m => m.id === mascaraIdParaEditar)`)
4. `ConfiguracaoPage` recebe o ID → **carrega configuração apenas daquele módulo** (`mascaras.find(m => m.id === mascaraId)`)
5. Todas as operações (adicionar slot, deletar slot, salvar páginas) são escopo do `mascaraId` — zero interferência com outros módulos

#### Consequência para o novo sistema multi-módulo:
- Quando novos módulos forem criados, eles aparecem automaticamente na lista do "Editar Máscara"
- Selecionar qualquer módulo da lista abre **exclusivamente** os dados daquele módulo
- **Nenhuma alteração necessária nesse fluxo** — já está correto e isolado

### Tópico 8 — Segurança dentro da janela de edição: Análise de botões soltos

**Preocupação:** Dentro da janela de edição de um módulo, existe algum botão que possa criar acidentalmente outro módulo?

#### PROTEGIDO (já correto no código):
- Botão "➕ Nova Máscara" → **JÁ ESTÁ OCULTO** quando `mascaraIdParaEditar` está ativo (linha 705: `!showMcForm && !mascaraIdParaEditar`) ✅
- Lista de máscaras → **JÁ ESTÁ FILTRADA** para mostrar APENAS o módulo em edição ✅
- Banner "Modo edição — apenas a máscara selecionada está visível." é exibido ✅
- **Não existe nenhum caminho acidental para criar outro módulo de dentro da janela de edição.**

#### PROBLEMA ENCONTRADO — Fundos não filtrados por módulo:
- No editor de páginas, o dropdown "Fundo fixo" de cada página mostra **TODOS os fundos de TODOS os módulos** (sem filtro por `mascaraIdParaEditar`).
- Na aba "Fundos", todos os fundos de todos os módulos aparecem juntos.
- No formulário de upload de novo fundo, não há vínculo automático com o módulo em edição.
- **Risco:** ao crescer para múltiplos módulos, o usuário pode acidentalmente selecionar o fundo do Módulo B para uma página do Módulo A.

#### O que PRECISA ser corrigido (no novo sistema multi-módulo):
1. Dropdown "Fundo fixo" → filtrar para mostrar apenas fundos do módulo sendo editado (`mascaraIdParaEditar`)
2. Aba "Fundos" em modo edição → mostrar apenas fundos vinculados ao módulo ativo
3. Upload de novo fundo em modo edição → atribuir automaticamente `mascara_id` do módulo ativo (sem dropdown de escolha)
4. Para trocar módulo → **única forma correta: sair e usar "Editar Máscara" no menu lateral**

#### REGRA OBRIGATÓRIA (confirmada pelo usuário):
- **Todo módulo tem seus próprios fundos, separados dos outros módulos. Isso é obrigatório, sem exceção.**
- Fundos NÃO são globais nem compartilhados entre módulos.
- Um fundo pertence a exatamente UM módulo (`mascara_id` obrigatório, nunca `null` no contexto multi-módulo).

### Tópico 9 — Regra Final de Isolamento (confirmação definitiva)

Cada módulo é **completamente isolado**. Os únicos elementos compartilhados entre todos os módulos são:

#### COMPARTILHADO (global):
1. **Scripts** — funções do motor de geração (pv_texto, eletrica, programacao_visual, etc.)
2. **Dados importados da pasta do usuário** — briefing, renders, planta baixa, altura do estande, logo, descritivo

#### TUDO O MAIS é isolado por módulo — incluindo obrigatoriamente:
- PDFs de máscara
- Fundos (backgrounds)
- Iscas OpenCV
- Configuração de páginas e slots
- Scripts atribuídos a cada slot
- Preferências de fonte e configuração

**Nenhum outro dado, template, fundo ou configuração é compartilhado entre módulos.**

