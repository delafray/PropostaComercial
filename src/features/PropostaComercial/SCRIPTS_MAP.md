# Mapa de Scripts - Proposta Comercial

Este documento serve como guia para todos os scripts dinâmicos utilizados nos slots da Proposta Comercial. Sempre que precisar alterar um formato ou lógica de preenchimento, mencione o nome do script abaixo.

---

## 1. Hoje (`hoje`)
- **Objetivo:** Insere a data atual do sistema.
- **Formato:** `DD/MM/AAAA` (Ex: 06/03/2026)
- **Modo:** Texto (Suporta cor, fonte, alinhamento).

## 2. Cliente · Evento (`cliente_evento`)
- **Objetivo:** Combina o nome do Cliente e do Evento vindos do briefing.
- **Formato:** `{Cliente} · {Evento}`
- **Fallback:** Se o briefing estiver vazio, mostra apenas o separador ou espaços em branco.
- **Modo:** Texto (Suporta cor, fonte, alinhamento).

## 3. Mês | Ano (`mes_ano`)
- **Objetivo:** Gera o mês atual por extenso em maiúsculo seguido do ano.
- **Formato:** `MÊS | ANO` (Ex: MARÇO | 2026)
- **Modo:** Texto (Suporta cor, fonte, alinhamento).

## 4. Descritivo Técnico (`01`)
- **Objetivo:** Renderiza o conteúdo do memorial descritivo (.txt) da pasta do projeto alinhado em 4 colunas clássicas.
- **Formato Tabular:** (ID | Quantidade | Unidade | Descrição).
- **Regras de Negócio:**
  - Linhas sem `TAB` (tabulação) são tratadas como **Categorias** e texturizadas em **Negrito**.
  - Linhas com `TAB` (tabulação) são separadas e suas partes distribuídas pelas 4 colunas.
- **Modo:** Automático (Cor e Tamanho podem ser personalizados na aba Configuração).

## 5. Render (`render`)
- **Objetivo:** Renderiza a imagem do slot capturada do componente de renderização 3D/Interior.
- **Modo:** Imagem (Não possui ajustes de texto).

---

## Como pedir alterações:
Basta dizer: *"No script **cliente_evento**, mude o separador para uma seta"* ou *"Crie um novo script que pegue o valor do campo X..."*.
