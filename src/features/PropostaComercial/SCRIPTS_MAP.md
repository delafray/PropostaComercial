# Mapa de Scripts - Proposta Comercial

Este documento é a referência oficial de todos os scripts usados nos slots. Para pedir alterações ou novos scripts, mencione o nome exato (ex: `projeto`, `hoje`).

---

## SCRIPT: `projeto` ⭐ (Imagens de Render)

- **Objetivo:** Insere as imagens de render do projeto neste slot. Gera uma página por render.
- **Atribuição:** Na aba Configurações, selecione qualquer slot → clique em **Script** → escolha **"Projeto (Renders)"**.
- **Fonte dos dados:** Arquivos locais do computador, referenciados pelo nome salvo no banco (`dados.renders`).
- **Ordenação:** Pelo nome do arquivo em ordem crescente numérica (`10.jpg → 11.jpg → 12.jpg...`).
- **Comportamento de página:**
  - Com 1 render: gera 1 página.
  - Com N renders: gera N páginas. **Cada página é um clone exato da original**, trocando apenas a imagem do slot de projeto.
- **Imagem:** Ocupa o máximo possível das dimensões do slot (`x_mm`, `y_mm`, `w_mm`, `h_mm`).
- **Modo:** Sem ajustes de texto (cor, fonte, alinhamento são ocultados quando este script está ativo).

---

## SCRIPT: `hoje`

- **Objetivo:** Insere a data atual do sistema.
- **Formato:** `DD/MM/AAAA` (Ex: 06/03/2026)
- **Modo:** Texto (suporta cor, fonte, alinhamento).

---

## SCRIPT: `cliente_evento`

- **Objetivo:** Combina o nome do Cliente e do Evento vindos do briefing.
- **Formato:** `{Cliente} · {Evento}`
- **Fallback:** Se o briefing estiver vazio, mostra string vazia.
- **Modo:** Texto (suporta cor, fonte, alinhamento).

---

## SCRIPT: `mes_ano`

- **Objetivo:** Gera o mês atual por extenso em maiúsculo seguido do ano.
- **Formato:** `MÊS | ANO` (Ex: MARÇO | 2026)
- **Modo:** Texto (suporta cor, fonte, alinhamento).

---

## SCRIPT: `01` (Descritivo Técnico)

- **Objetivo:** Renderiza o conteúdo do memorial descritivo (`.txt`) da pasta do projeto.
- **Formato Tabular:** `ID | Quantidade | Unidade | Descrição`
- **Regras:**
  - Linhas **sem TAB** → tratadas como **Categorias** (negrito).
  - Linhas **com TAB** → distribuídas pelas 4 colunas.
- **Transbordamento:** Se o conteúdo não couber na página, gera páginas adicionais automaticamente.
- **Modo:** Automático (cor e tamanho personalizáveis na aba Configuração).

---

---

## SCRIPT: `planta` (Planta Baixa + Análise OpenCV)

- **Objetivo:** Insere a planta baixa do projeto e gera uma segunda página com análise automática de símbolos.
- **Fonte dos dados:** Arquivo `planta.jpg`, `planta.png` ou `planta.svg` da pasta local do projeto.
- **Comportamento de página:**
  - **Página A (original):** A planta é inserida no slot exatamente como foi importada, sem alterações.
  - **Página B (análise):** Mesma página, porém a planta é convertida para **cinza claro** e para cada isca OpenCV cadastrada nos templates:
    1. O sistema busca o símbolo da isca dentro da planta (NCC — Normalized Cross-Correlation, sem dependência externa).
    2. Se encontrar match acima do limiar de confiança (0.65): **sobrepõe a imagem da isca colorida** na posição encontrada.
    3. Desenha uma **borda colorida** ao redor do match (cor definida em `cor_holograma` da isca; fallback `#d22323`).
    4. Desenha **label com o nome da isca** em caixa branca com borda colorida.
    5. Desenha uma **seta** ligando o centro do label ao centro do match.
    6. Se houver múltiplas iscas, os labels são posicionados testando 8 ângulos ao redor do match para **evitar sobreposição**.
- **Sem iscas cadastradas:** A página B é gerada apenas com a planta cinza (sem anotações).
- **SVG:** Suportado na página A via `svg2pdf`. Para página B (canvas), SVG é convertido via `<img>` no canvas do browser.

---

## SCRIPT: `altura_estande`

- **Objetivo:** Insere a altura do estande extraída do nome de arquivo na pasta do projeto.
- **Fonte dos dados:** `proposta.dados.pasta.tamanhoEstande` — salvo automaticamente ao selecionar/trocar/reabrir a pasta.
- **Detecção:** Qualquer arquivo cujo nome contenha o padrão `\d+[,.]\d+m` (ex: `altura_3,50m.png`).
- **Formato:** `"3,50m"` (vírgula BR + sufixo m).
- **Fallback:** Vazio se nenhum arquivo com o padrão for encontrado na pasta.
- **Modo:** Texto (suporta cor, fonte, alinhamento).

---

## SCRIPT: `imagem_estande` (PNG com Cota Arquitetural)

- **Objetivo:** Insere o arquivo PNG de altura do estande no slot, cropado verticalmente, com cota arquitetural desenhada à esquerda.
- **Fonte dos dados:**
  - Imagem: arquivo local cujo nome contenha padrão `\d+[,.]\d+m` (ex: `altura_3,50m.png`).
  - Texto da cota: `proposta.dados.pasta.tamanhoEstande` (ex: `"3,50m"`).
- **Requisito:** Só funciona com **PNG**. Se o arquivo não for PNG, o slot fica vazio silenciosamente.
- **Processamento:**
  1. Lê pixels via canvas.
  2. **Crop vertical:** Remove linhas de topo e base totalmente transparentes (alpha ≤ 10). Largura mantida.
  3. Insere a imagem cropada no slot (`containInSlot` — sem distorção).
- **Cota arquitetural:**
  - Detecta a **primeira coluna com pixel visível** (ignora transparência lateral esquerda).
  - Linha vertical azul (`#00AEEF`) a `4mm` à esquerda do conteúdo visível.
  - Traços horizontais (topo/base) de `3mm`.
  - Texto `tamanhoEstande` rotacionado 90°, centralizado na linha.
- **Modo:** Sem controles de estilo (ocultados quando ativo).

---

## Como pedir alterações:
Basta dizer: *"No script **projeto**, quero que a imagem seja centralizada no slot"* ou *"Crie um novo script chamado X que faça Y"*.
