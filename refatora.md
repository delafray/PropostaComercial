# Refatoração — PropostaComercial

> Criado em 2026-03-10. Não executar sem testar ponto a ponto.
> Validar com outra IA antes de iniciar qualquer item.

---

## PRIORIDADE 1 — Crítico (quebra manutenção futura)

### 1.1 Quebrar GerarPdfPage.tsx (1.880 linhas)
**Problema:** Um único arquivo contém o motor de PDF, 10+ scripts, 3 modais, 20+ estados.
**Risco atual:** Qualquer alteração pode quebrar algo não relacionado. Impossível de testar.

**Proposta de divisão:**
```
GerarPdfPage.tsx          → orquestrador (< 200 linhas)
scripts/alturaEstande.ts  → script individual
scripts/clienteEvento.ts
scripts/descritivo01.ts
scripts/eletrica.ts
scripts/pvTexto.ts
scripts/planta.ts
scripts/projetista.ts
hooks/usePdfGeneration.ts → lógica async principal (Promise resolvers, progress)
hooks/useSetasFlow.ts     → fluxo do modal de setas
hooks/useRecorteFlow.ts   → fluxo do modal de recorte
```

**Regra:** cada script recebe `(doc, slot, dados)` e retorna void. Plugável.

---

### 1.2 Remover @ts-nocheck (10 arquivos)
**Problema:** TypeScript desabilitado em 78% do módulo. Erros de tipo só aparecem em produção.

**Arquivos afetados:**
- `services/propostaService.ts`
- `services/templateService.ts`
- `services/prefService.ts`
- `components/GerarPdfPage.tsx`
- `components/NovaPropostaPage.tsx`
- `components/ConfiguracaoPage.tsx`
- `components/MascarasPage.tsx`
- `utils/briefingParser.ts`
- `utils/mascaraParser.ts`
- `utils/fontLoader.ts`

**Causa provável:** tipos ausentes para jsPDF e pdfjs-dist.
**Solução:** instalar `@types/jspdf` (se existir) ou declarar tipos mínimos em `types/vendors.d.ts`.
**Atenção:** remover um por um, compilar entre cada remoção. Não remover todos de uma vez.

---

## PRIORIDADE 2 — Importante (fragilidade em produção)

### 2.1 CDN pdfjs hardcoded em 4 lugares
**Problema:** Se o CDN sair do ar, três features param simultaneamente sem aviso.

**Arquivos:**
- `utils/mascaraParser.ts`
- `utils/briefingParser.ts`
- `utils/visualizacaoUtils.ts`
- `components/RecortePlacementModal.tsx`
- `components/SetasPlacementModal.tsx`

**Solução preferida:** configurar pdfjs worker via Vite (ver documentação pdfjs-dist + vite).
**Alternativa simples:** mover a URL para uma constante central em `utils/pdfjsConfig.ts` — pelo menos falha num lugar só.

**Atenção:** mudança no worker config pode quebrar parsers. Testar cada parser após mudança.

---

### 2.2 Centralizar constantes hardcoded
**Problema:** mesmas constantes espalhadas em múltiplos arquivos.

**Criar:** `utils/constants.ts`
```typescript
export const PAGE_W_MM = 297;
export const PAGE_H_MM = 210;
export const PAGE_H_PT = 595.28;
export const ARROW_COLOR = '#A8518A';
export const SLOT_COLOR_GREEN = '#00ff00';
export const PDF_RASTER_DPI = 200;
export const ARROW_PX_PER_MM = 10;
```

---

### 2.3 Anti-padrão: Promise Resolver em useState
**Problema:** `useState<((pos) => void) | null>` armazena funções em state React — viola contrato do React, causa re-renders desnecessários.

**Ocorre em:**
- `GerarPdfPage.tsx` — `recorteResolve` e `setasResolve`

**Alternativa:** usar `useRef` para armazenar o resolver (não causa re-render):
```typescript
const recorteResolveRef = useRef<((pos) => void) | null>(null);
```
**Nota:** funciona como está — corrigir só junto com a quebra do GerarPdfPage.

---

## PRIORIDADE 3 — Qualidade (bom ter)

### 3.1 Código duplicado nos modais de máscara
**Problema:** NovaMascaraModal, ExcluirMascaraModal, EditarMascaraModal têm ~300 linhas de boilerplate similar em `index.tsx`.
**Solução:** extrair componente genérico `MascaraFormModal`.

### 3.2 Timeout excessivo em rasterizarSvg
**Problema:** `setTimeout 15000ms` para cleanup de blob URL é muito longo — pode acumular em máquinas lentas.
**Solução:** reduzir para 5000ms.

### 3.3 Silent failures sem log
**Problema:** alguns blocos `catch {}` silenciam erros sem `console.warn`.
**Exemplo:** `prefService.deletePref` — erro não é crítico, mas deveria logar.
**Solução:** padrão mínimo `catch (e) { console.warn('[contexto]', e); }`.

### 3.4 Viewport PDF duplicado nos modais
**Problema:** `RecortePlacementModal` e `SetasPlacementModal` calculam escala para ~720px de forma idêntica.
**Solução:** extrair `usePdfViewport(pdfBlob, pageNumber, targetWidth)` hook compartilhado.

---

## O QUE NÃO TOCAR

Estes itens parecem bugs mas são comportamentos intencionais — **não alterar**:

- `@ts-nocheck` em `fontLoader.ts` — remover expõe erros de tipo do opentype.js sem solução fácil
- `PAGE_H_PT = 595.28` hardcoded — correto para A4, só falha com outros formatos (não usados)
- CDN pdfjs hardcoded — risco conhecido, correção exige config Vite (risco de quebrar parsers)
- `maquinaId.ts` — fingerprint não é confiável, mas funcionalidade é usada
- `BODY_L`, `HEAD_D` etc. em `SetasPlacementModal` — proporções extraídas do SVG do CorelDraw do usuário, não alterar

---

## ORDEM SUGERIDA DE EXECUÇÃO

1. [ ] Centralizar constantes (`constants.ts`) — baixo risco, alto impacto
2. [ ] CDN pdfjs → constante central (`pdfjsConfig.ts`) — baixo risco
3. [ ] Quebrar GerarPdfPage em scripts isolados — maior risco, testar cada script
4. [ ] Substituir Promise resolvers por `useRef`
5. [ ] Remover `@ts-nocheck` um por um (compilar entre cada remoção)
6. [ ] Extrair hook `usePdfViewport`
7. [ ] Extrair `MascaraFormModal`

---

## NOTAS PARA VALIDAÇÃO POR OUTRA IA

- O código usa jsPDF v2.x — verificar se `@types/jspdf` existe antes de sugerir remoção de @ts-nocheck
- `opentype.js` pode não ter tipos — pode precisar de `declare module 'opentype.js'`
- `pdfjs-dist` tem tipos próprios mas às vezes conflitam com a versão usada
- O padrão Promise resolver em useState **funciona** — não é um bug, é uma escolha discutível
- Antes de quebrar GerarPdfPage, mapear todas as variáveis compartilhadas entre scripts (ex: `doc`, `slot`, `localBriefing`, `projeto`) para definir a interface correta
