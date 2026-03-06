# Prompt Master: Mapeamento Dinâmico de PDFs e Configuração de Slots Semânticos (v2)

> **Objetivo Final:** Ensinar a IA a arquitetar um sistema de geração de PDFs onde os campos não são "fixos" no código, mas baseados em **Slots Semânticos**. Isso permite que o usuário altere layouts (Máscaras) no banco de dados sem quebrar o preenchimento automático de dados vindos de um Briefing (Excel/JSON) e permite a configuração de valores padrão (Defaults) e tamanhos de fonte customizados por usuário.

---

## 🛑 1. O Problema: Acoplamento Rígido (Hardcoding)

Sistemas comuns tentam renderizar PDFs assim:
```tsx
doc.text(`Cliente: ${dados.cliente}`, 10, 20);
```
Se a posição do cliente mudar no design, ou se o nome do campo no banco mudar, o PDF sai errado ou em branco.

## 🛠️ 2. A Solução: Arquitetura de 3 Camadas Ouro

Para um sistema profissional (como o Proposta Comercial RBarros), dividimos a lógica em:

### Camada A: O Briefing Parser (O Tradutor)
Um utilitário que lê dados brutos (de uma planilha ou form) e os converte em nomes "Semânticos" padronizados (ex: `footer_cliente`, `header_numero`).

```typescript
// briefingParser.ts
export const SLOT_NOME_MAP = {
  "CLIENTE": "footer_cliente",
  "EVENTO": "footer_evento",
  "Nº PROPOSTA": "header_numero"
};
```

### Camada B: Preferências de Usuário (Defaults e Fontes)
Um sistema que salva em `JSONB` no Supabase (`pc_user_prefs`) quais são os valores padrão de cada slot para cada modelo de máscara.

- **Chave de Preferência:** `slot_defaults_{mascara_id}`
- **O que guarda:** `{ "footer_cliente": { value: "Exemplo", fontSize: 10 } }`

### Camada C: O Motor de Renderização (GerarPdfPage.tsx)
O motor não procura por "Cliente". Ele percorre a lista de slots que a máscara atual possui e tenta preencher usando uma **Hierarquia de Prioridade**:
1. **Manual:** O que o usuário digitou na tela agora.
2. **Briefing:** O que foi extraído automaticamente do arquivo carregado.
3. **Config:** O valor padrão salvo nas configurações do usuário.
4. **Fallback:** O valor original cadastrado no template.

---

## 🎨 3. Lógica de Renderização Híbrida (Texto e Imagem)

Ensinamos a IA a tratar slots de `imagem` como slots de `texto` caso eles possuam um valor textual. Isso permite usar o mesmo slot para "Assinatura" ou "Logo" (Imagem) ou para um aviso de "CONFIDENCIAL" (Texto) dependendo do preenchimento.

```tsx
// renderizarTextos()
const textValue = buildTextMap(slot.nome_semantico);
if (textValue) {
  doc.setFontSize(buildFontSizeMap(slot.nome_semantico));
  doc.text(textValue.toUpperCase(), slot.pos_x, slot.pos_y);
}
```

## 🚀 4. Por que isso é Superior?
1. **Zero Manutenção:** Se você criar uma máscara nova com 50 slots, o código de geração de PDF não muda 1 linha sequer.
2. **UX Premium:** O usuário configura a fonte uma vez na aba "Configuração" e todos os PDFs futuros saem perfeitos.
3. **Flexibilidade B2B:** Permite que diferentes empresas usem o mesmo sistema com padrões de nomes e fontes totalmente distintos apenas via banco de dados.

---

*(Este blueprint foi gerado após a implementação do Fix de Slots Semânticos v2 e do Sistema de Configurações Padrão).*
