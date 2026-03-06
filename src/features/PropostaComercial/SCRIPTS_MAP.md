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

## Como pedir alterações:
Basta dizer: *"No script **projeto**, quero que a imagem seja centralizada no slot"* ou *"Crie um novo script chamado X que faça Y"*.
