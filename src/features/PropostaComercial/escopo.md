# Escopo: Sistema de Proposta Comercial

---
## ⏳ MIGRATIONS PENDENTES (aplicar na outra IA com acesso Supabase)

1. `supabase/migrations/20260306_pc_user_prefs.sql` — **OBRIGATÓRIA para o botão "💾 Salvar Pasta" funcionar**
   - Cria tabela `pc_user_prefs` (user_id, chave, valor jsonb) com RLS
2. `supabase/migrations/20260305_pc_mascara_slots.sql` — **OPCIONAL** (redundante, o botão "🔍 Detectar Slots" faz o mesmo dinamicamente)

---

## ✅ TAREFAS CONCLUÍDAS NESTA SESSÃO (2026-03-06)

### NovaPropostaPage.tsx — Estado atual completo
1. **Seletor de Pasta** — `<input webkitdirectory>` + `parsePasta(files)` → diagnóstico 6 slots (Renders, Briefing, Planta, Memorial, Tamanho, Logo)
2. **Auto-fill** — nome da proposta recebe nome da pasta; renders se distribuem nos slots de imagem ao selecionar máscara
3. **Slot de imagem UI** — mostra `📷 filename.jpg` verde quando preenchido + "Trocar"; label pontilhado quando vazio
4. **Machine fingerprint** — `utils/maquinaId.ts` → UUID em `localStorage` como ID do computador
5. **dados.pasta** — ao salvar proposta, `dados.pasta = { nome, maquina_id, arquivos[] }` vai junto no JSONB do Supabase
6. **Botão "💾 Salvar Pasta"** — aparece ao lado de "Trocar Pasta" quando pasta carregada; chama `prefService.savePref('ultima_pasta', ...)`
7. **Banner "Última pasta salva"** — aparece no topo do card quando nenhuma pasta está carregada na sessão; tem botão "Re-selecionar"

### Novos arquivos criados
- `utils/maquinaId.ts` — `getMaquinaId()` via localStorage
- `services/prefService.ts` — `savePref(chave, valor)` e `loadPref(chave)` via UPSERT em `pc_user_prefs`
- `supabase/migrations/20260306_pc_user_prefs.sql` — tabela de preferências do usuário

### TemplateManager.tsx — Já tinha de sessão anterior
- Botão "🔍 Detectar Slots" em cada máscara com barra de progresso verde (0→100%)
- `mascaraParser.ts` com callback `onProgress(pct, label)` (faixa 20-90%)

---

## ⏳ PRÓXIMO TIJOLO SUGERIDO

**Aba "Gerar PDF"** — listar propostas salvas e gerar o PDF final:
- Listar `pc_propostas` com status, data e nome
- Ao abrir proposta: detectar se `dados.pasta.maquina_id !== getMaquinaId()` → mostrar banner amarelo "Arquivos selecionados em outro computador. Re-selecionar pasta?"
- Gerar PDF via jsPDF: máscara (fundo) + imagens dos renders nos slots de imagem + textos nos slots de texto

---

## 0. Instruções para IAs Futuras (Handover)
> **MENSAGEM DO ARQUITETO (IA ORIGINAL):**
> Este módulo está sendo construído de forma **Iterativa, Lenta e Sequencial**. Não tente criar soluções monolíticas nem injetar dependências massivas de uma vez.
>
> *   **Nossa Metodologia:** 1) O humano pede um tijolo; 2) Nós analisamos se fere o isolamento; 3) Criamos mini-planos locais; 4) Só codificamos com o 'De Acordo' do humano.
> *   **Regra de Ouro (Isolamento + Portabilidade):** Todo o Módulo "PropostaComercial" está sendo injetado numa pasta de contexto própria (`src/features/PropostaComercial`). Todas as tabelas no Supabase iniciam com **`pc_`**. O sistema mestre "Galeria de Fotos" **não pode ser afetado** e vice-versa.
> *   **⚠️ REGRA CRÍTICA — Módulo Transplantável:** Este módulo foi projetado para ser **extraído e transplantado para outro sistema no futuro**, sem refatoração profunda. Isso significa:
>     *   **NUNCA misturar código** deste módulo com o sistema "Galeria de Fotos" (App.tsx, Layout.tsx, services/ globais, etc.).
>     *   A única dependência externa permitida é o cliente Supabase (`supabaseClient`), que será substituído pelo equivalente do sistema de destino na hora do transplante.
>     *   Todo o resto (tipos, serviços, componentes) deve viver **100% dentro de `src/features/PropostaComercial/`**.
>     *   O humano fará uma refatoração/adaptação pontual no momento do transplante. Nossa responsabilidade é garantir que a pasta seja **auto-contida e portável**.
> *   **Workflow de Migrations Supabase:** Esta IA **não executa** as migrations diretamente no Supabase. O fluxo é: (1) Esta IA gera o arquivo `.sql` na pasta `supabase/migrations/`; (2) O humano repassa o SQL para uma **outra IA que tem acesso direto ao Supabase** para executar. Os arquivos `.sql` ficam salvos como referência histórica.
> *   **Autonomia da IA (Autorização Total):** Este sistema é ambiente de **teste**. A IA tem **autorização total** para criar, editar e deletar qualquer arquivo dentro de `C:\Users\ronal\Documents\Antigravity\Proposta_Comercial` sem pedir confirmação prévia. O isolamento do módulo `PropostaComercial` é uma **decisão arquitetural** (portabilidade futura), não uma restrição de permissão.
> 
> **Onde paramos (Status Atual):**
> *   **Fase 1 (Arquitetura e BD):** ✅ Concluída. Desenhamos a base de dados em 3 pilares (`pc_templates_backdrop`, `pc_templates_mascara`, `pc_templates_referencia`) e disparamos as migrations no Supabase com suas Policies de acesso RLS.
> *   **Fase 2 (UI):** 🟡 Em Progresso.
>     *   ✅ `TemplateManager` refatorado para **3 abas** (Máscaras PDF / Fundos / Iscas OpenCV).
>     *   ✅ `types/index.ts` — 3 interfaces corretas: `TemplateMascara`, `TemplateBackdrop`, `TemplateReferencia`.
>     *   ✅ `templateService.ts` — CRUD completo para os 3 pilares.
>     *   ✅ Migration `20260305_pc_templates_rework_4.sql` — adiciona `tipo_arquivo` e `mascara_id` (FK) em `pc_templates_backdrop`.
>     *   ✅ Migration `20260305_pc_templates_rework_5.sql` — adiciona `paginas_config jsonb` em `pc_templates_mascara`.
>     *   ✅ `utils/pdfUtils.ts` — detecta contagem de páginas do PDF via leitura de bytes (sem dependência externa).
>     *   ✅ Editor de comportamento por página: ao subir uma Máscara, o sistema detecta automaticamente o nº de páginas e cria um editor inline onde o usuário descreve o comportamento de cada página.
>     *   **⚠️ Migrations 4 e 5 ainda não aplicadas no Supabase** — repassar para a outra IA executar.
>     *   ✅ `SlotElemento` em `types/index.ts` — campos: nome, tipo (texto/imagem), x_mm, y_mm, w_mm, h_mm + opções de texto (font_size, font_style, color, align).
>     *   ✅ `PaginaConfig` agora contém `slots: SlotElemento[]`.
>     *   ✅ `TemplateManager.tsx` — editor de slots inline por página (adicionar/excluir com coordenadas em mm e opções tipográficas).
>     *   ✅ `NovaPropostaPage.tsx` — tela de geração: selecionar máscara → configurar páginas (fundo + valores dos slots) → gerar PDF via jsPDF A4 Paisagem (297×210mm).
>     *   ✅ `index.tsx` — navegação interna: aba "Nova Proposta" (padrão) + aba "Templates".
>     *   **⏳ Próximo passo:** definir slots nas páginas da máscara cadastrada e gerar o primeiro PDF de teste.
> *   **Motor OpenCV:** Ainda não codificado (apenas planejado nos algoritmos matemáticos e anti-colisão aqui abaixo).
- **Profissão:** Designer de projetos.
- **Processo atual:** Apresenta propostas comerciais que possuem uma estrutura/layout sempre igual.
- **Ferramenta atual:** CorelDRAW.
- **Dor/Problema:** O trabalho é altamente manual. É preciso abrir um PDF base do cliente, ler os dados (Nome, Empresa, Evento, Cliente) e redigitar tudo manualmente dentro do CorelDRAW para gerar a proposta.

## 2. Solução Esperada (Automação)
- O sistema deve extrair ou receber esses dados de alguma forma para não ter que digitar tudo de novo.
- A proposta deve ser gerada magicamente ou com o mínimo de esforço, reaproveitando essas informações coletadas.
- A proposta final será montada sobre uma "máscara" (um template base com o padrão da empresa).
- Cada tipo de dado (nome do cliente, contato, etc.) terá uma posição, fonte e tamanho de fonte específicos em cima dessa máscara.

## 3. Arquivos de Entrada Padrão
O sistema receberá ou processará os seguintes tipos de arquivos/dados para gerar a proposta:
1. **Briefing:** Documento de onde serão extraídos todos os dados textuais (nome do evento, cliente, etc.).
2. **Renders (Imagens 3D):** Serão arquivos nomeados sequencialmente (ex: `01`, `02`, `03`...). O arquivo `01` será sempre tratado como a imagem principal da proposta.
3. **Planta Baixa:** Terá um prompt/regra específica que será fornecida depois.
4. **Arquivo TXT (Diagramação / Memorial Descritivo):** Conterá os textos estruturados referentes aos itens do projeto.
5. **Template Vetorial (Máscara):** A imagem de fundo da proposta será consumida no formato `.svg` (ex: `Tamplante_tela_inicial_01.svg`). Isso garantirá que o PDF final fique extremamente leve e com resolução gráfica infinita/perfeita, sem usar imagens JPG/PNG pesadas para o fundo.
4. **Arquivo TXT (Diagramação / Memorial Descritivo):** Conterá os textos estruturados referentes aos itens do projeto.
   - **Formato:** O arquivo possui alta estruturação em blocos categóricos (Ex: `Marcenaria`, `Elétrica`, `Mobiliário`).
   - **Colunas identificadas:** Número do Item, Quantidade, Unidade de Medida (m², Unid., m), Descrição e Notas Adicionais.
   - **Status para Automação:** Perfeito! Como os dados são tabulares, o sistema poderá extraí-los, organizá-los em tabelas elegantes e paginá-los automaticamente na proposta final.

## 4. Estrutura do Documento Gerado (Exemplo de Capa)
Com base no exemplo de capa analisado:
- **Logo do Cliente** (CME DO BRASIL)
- **Nome do Evento** (EXPOSIBRAM 2026)
- **Data e Local** (24 a 35 de agosto de 2026, Belo Horizonte - MG) (*Nota: o dia "35" foi um erro de digitação no exemplo original que a automação ajudará a evitar!*)
- **Número do Projeto/Anexo** (Anexo I, Número 2026-0288)
- **Detalhes Estruturais** (STAND - Ee28 - 5,0x5,0m - 25m²)
Cada um desses itens terá estilos de fonte e posições exatas sobrepostas à máscara laranja/padrão.

## 5. Regras de Geração e Paginação (Renders)
- O sistema lerá os arquivos de Renders (ex: `10.jpg`, `11.jpg`, `25.jpg`...).
- **Ordenação Numérica Estrita:** A nomenclatura dos arquivos será a diretriz de prioridade. O sistema sempre ordenará numericamente de forma crescente. O arquivo com o *menor número absoluto* (mesmo que seja o `10`) terá sempre a prioridade máxima (irá para o primeiro Slot ou Capa).
- **Preenchimento de Slots:** A máscara da proposta (Template SVG) define quantos *espaços reservados* para fotos existem na tela (ex: 1, 3, 5). 
- O sistema fará a "distribuição" preenchendo os espaços disponíveis. Ex: Se a tela comporta 3 imagens e temos 6 arquivos do `10` ao `15` disponíveis, a tela 1 receberá (10.jpg, 11.jpg, 12.jpg) e o sistema gerará a tela 2 para receber (13.jpg, 14.jpg, 15.jpg).
## 6. Tratamento da Planta Baixa (Analisador Óptico)
- A planta baixa será analisada por um motor de **Visão Computacional 100% Client-Side** usando `OpenCV.js`.
- O objetivo é criar uma ferramenta onde o usuário forneça 1 imagem de referência (ex: Mesa Amarela) e a Planta grande.
- O sistema procurará pela referência (suportando rotações de ângulos via Tática Rotacional de Template ou Feature Matching).
- **Processamento:** Todo o cálculo de reconhecimento será feito num Web Worker (para não travar a UI).
  3. **Algoritmo Anti-Colisão (Etiquetas):** O sistema calculará inteligentemente onde posicionar a seta e o nome do produto (Ex: "Refletor De LED padrão"). 
     - **Dinâmica Espacial:** O sistema usará verificação de "Bounding Boxes" no Canvas para projetar as setas apenas em áreas vazias.
     - **Orientação Flexível:** A linha/seta pode ser desenhada para **cima**, para **baixo**, para a **esquerda** ou para a **direita**, dependendo de onde o algoritmo encontrar espaço vazio ao redor do objeto, evitando sempre sobrepor a imagem, textos ou delimitações da planta original.
     - **Escala de Densidade Inteligente:** Se o algoritmo encontrar de 1 a 3 objetos espalhados, os nomes e linhas serão gerados em tamanho de destaque (grandes). Se o sistema encontrar uma alta densidade (Ex: 30 refletores na planta), o algoritmo matematicamente reduzirá o tamanho da fonte e o comprimento das setas progressivamente. A prioridade é **Zero Poluição Visual**, garantindo legibilidade elegante indepentente da densidade do projeto.

## 7. Gerenciamento e Cadastro de Templates
O usuário terá uma interface (ou estrutura de dados) para fazer o cadastro e amarração de diferentes templates. Existirão duas categorias principais no sistema:
1. **Templates de Fundo (Backdrops):** Imagens visuais puras (PNG, JPG) ou vetores (SVG) que servem apenas como "Papel de Parede" base para as páginas das propostas.
2. **Templates de Máscara (Regras de Diagramação via PDF):** Arquivo único em PDF fornecido pelo Setor de Marketing detalhando as réguas matemáticas. É este cadastro que vai dizer para o sistema: "Bote a foto 1 no X:100 Y:200", criando buracos e limites.
3. **Templates de Correspondência (Visão Computacional OpenCV):** Cadastros focados nas "íscas" que o robô vai buscar (ex: o recorte em imagem da Mesa Amarela, ou o contorno exato do Refletor). Servirão exclusivamente para varredura de Plantas Baixas e injeção do pin/etiqueta anti-colisão.
