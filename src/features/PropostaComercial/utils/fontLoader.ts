import type jsPDF from 'jspdf';
import opentype from 'opentype.js';

// ── Font registry ──────────────────────────────────────────────────────────────

type FontStyle = 'normal' | 'bold' | 'italic' | 'bolditalic';

interface FontFile {
    family: string;
    style: FontStyle;
    file: string;
}

const FONT_MAP: FontFile[] = [
    { family: 'helvetica',      style: 'normal',     file: 'Arial.ttf' },
    { family: 'helvetica',      style: 'bold',       file: 'ArialBold.ttf' },
    { family: 'helvetica',      style: 'italic',     file: 'ArialItalic.ttf' },
    { family: 'helvetica',      style: 'bolditalic', file: 'ArialBoldItalic.ttf' },
    { family: 'century-gothic', style: 'normal',     file: 'CenturyGothic.ttf' },
    { family: 'century-gothic', style: 'bold',       file: 'CenturyGothicBold.ttf' },
    { family: 'century-gothic', style: 'italic',     file: 'CenturyGothicItalic.ttf' },
    { family: 'century-gothic', style: 'bolditalic', file: 'CenturyGothicBoldItalic.ttf' },
];

// ── Caches ─────────────────────────────────────────────────────────────────────

const _b64Cache = new Map<string, string>();            // file → base64 (jsPDF embedding)
const _otCache  = new Map<string, opentype.Font>();     // "family/style" → Font

// ── jsPDF font registration ────────────────────────────────────────────────────

async function ttfToBase64(file: string): Promise<string> {
    if (_b64Cache.has(file)) return _b64Cache.get(file)!;
    const res = await fetch(`/fonts/${file}`);
    if (!res.ok) throw new Error(`Fonte não encontrada: /fonts/${file} (${res.status})`);
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    _b64Cache.set(file, b64);
    return b64;
}

/**
 * Registra todas as fontes no documento jsPDF (embedding real).
 * Deve ser chamado UMA VEZ após criar o `doc`.
 */
export async function registrarFontes(doc: jsPDF): Promise<void> {
    for (const { family, style, file } of FONT_MAP) {
        try {
            const b64 = await ttfToBase64(file);
            doc.addFileToVFS(file, b64);
            doc.addFont(file, family, style);
        } catch (e) {
            console.warn(`[fontLoader] Falha ao registrar ${family}/${style}:`, e);
        }
    }
}

/**
 * Normaliza o nome da família para os registrados no jsPDF.
 * Qualquer família não mapeada → 'helvetica' (Arial embutido).
 */
export function normalizarFamilia(fontFamily: string | undefined): string {
    const f = (fontFamily ?? '').toLowerCase().trim();
    if (f === 'century-gothic') return 'century-gothic';
    return 'helvetica';
}

// ── OpenType: carregamento de fontes ──────────────────────────────────────────

function resolverFontStyle(style: string): FontStyle {
    if (style === 'bold') return 'bold';
    if (style === 'italic') return 'italic';
    if (style === 'bolditalic') return 'bolditalic';
    return 'normal';
}

async function carregarOpentypeFont(family: string, style: string): Promise<opentype.Font | null> {
    const fs = resolverFontStyle(style);
    const key = `${family}/${fs}`;
    if (_otCache.has(key)) return _otCache.get(key)!;
    const entry = FONT_MAP.find(f => f.family === family && f.style === fs);
    if (!entry) return null;
    try {
        const res = await fetch(`/fonts/${entry.file}`);
        if (!res.ok) return null;
        const font = opentype.parse(await res.arrayBuffer());
        _otCache.set(key, font);
        return font;
    } catch {
        return null;
    }
}

/** Expõe o carregamento de fontes para callers externos (e.g. word-wrap antes de renderizar). */
export async function carregarFonteVetor(family: string, style: string): Promise<opentype.Font | null> {
    return carregarOpentypeFont(family, style);
}

// ── OpenType: word-wrap ────────────────────────────────────────────────────────

/**
 * Quebra `text` em linhas que caibam dentro de `maxWidth_mm` usando métricas reais da fonte.
 */
export function wrapTextoMm(
    font: opentype.Font,
    text: string,
    maxWidth_mm: number,
    sizeMm: number,
): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (font.getAdvanceWidth(candidate, sizeMm) > maxWidth_mm && current) {
            lines.push(current);
            current = word;
        } else {
            current = candidate;
        }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [text];
}

// ── OpenType: texto → vetores no PDF ──────────────────────────────────────────

/**
 * Converte os comandos de path do opentype.js para operadores PDF brutos.
 * jsPDF usa: origem top-left, y cresce para baixo, unidades em mm.
 * PDF interno usa: origem bottom-left, y cresce para cima, unidades em pontos.
 * Conversão: pdfX = x_mm * sf  |  pdfY = (pageH_mm - y_mm) * sf
 */
function pathParaOpsPdf(
    commands: Array<{ type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }>,
    sf: number,
    pageH: number,
): string[] {
    const ops: string[] = [];
    let cx = 0, cy = 0;

    for (const cmd of commands) {
        const { type, x = 0, y = 0, x1 = 0, y1 = 0, x2 = 0, y2 = 0 } = cmd;

        if (type === 'M') {
            ops.push(`${(x * sf).toFixed(4)} ${((pageH - y) * sf).toFixed(4)} m`);
            cx = x; cy = y;

        } else if (type === 'L') {
            ops.push(`${(x * sf).toFixed(4)} ${((pageH - y) * sf).toFixed(4)} l`);
            cx = x; cy = y;

        } else if (type === 'C') {
            ops.push(
                `${(x1 * sf).toFixed(4)} ${((pageH - y1) * sf).toFixed(4)} ` +
                `${(x2 * sf).toFixed(4)} ${((pageH - y2) * sf).toFixed(4)} ` +
                `${(x * sf).toFixed(4)} ${((pageH - y) * sf).toFixed(4)} c`
            );
            cx = x; cy = y;

        } else if (type === 'Q') {
            // Quadrática → cúbica: P1 = P0 + 2/3*(ctrl-P0), P2 = P3 + 2/3*(ctrl-P3)
            const bx1 = cx + 2 / 3 * (x1 - cx);
            const by1 = cy + 2 / 3 * (y1 - cy);
            const bx2 = x  + 2 / 3 * (x1 - x);
            const by2 = y  + 2 / 3 * (y1 - y);
            ops.push(
                `${(bx1 * sf).toFixed(4)} ${((pageH - by1) * sf).toFixed(4)} ` +
                `${(bx2 * sf).toFixed(4)} ${((pageH - by2) * sf).toFixed(4)} ` +
                `${(x * sf).toFixed(4)} ${((pageH - y) * sf).toFixed(4)} c`
            );
            cx = x; cy = y;

        } else if (type === 'Z') {
            ops.push('h');
        }
    }
    return ops;
}

/**
 * Renderiza UMA linha de texto como curvas vetoriais no jsPDF.
 *
 * @param doc       Documento jsPDF
 * @param text      Texto (linha única)
 * @param x_mm      Âncora X em mm (mesmo significado que o `x` do doc.text com `align`)
 * @param y_mm      Baseline em mm
 * @param family    'helvetica' | 'century-gothic'
 * @param style     'normal' | 'bold' | 'italic'
 * @param size_pt   Tamanho em pontos (como em doc.setFontSize)
 * @param color     [R, G, B] 0-255
 * @param align     Alinhamento (igual ao { align } do doc.text)
 * @returns true se renderizou como vetor, false se falhou (caller deve usar doc.text como fallback)
 */
export async function renderTextoVetor(
    doc: any,
    text: string,
    x_mm: number,
    y_mm: number,
    family: string,
    style: string,
    size_pt: number,
    color: [number, number, number],
    align: 'left' | 'center' | 'right' = 'left',
): Promise<boolean> {
    if (!text?.trim()) return true;

    const font = await carregarOpentypeFont(family, style);
    if (!font) return false;

    const sizeMm = size_pt * (25.4 / 72);

    // Ajusta X conforme alinhamento
    let startX = x_mm;
    if (align !== 'left') {
        const w = font.getAdvanceWidth(text, sizeMm);
        startX = align === 'center' ? x_mm - w / 2 : x_mm - w;
    }

    const path = font.getPath(text, startX, y_mm, sizeMm);
    if (!path.commands.length) return true;

    const sf: number = (doc as any).internal.scaleFactor;
    const pageH: number = (doc as any).internal.pageSize.getHeight();
    const [r, g, b] = color;

    const pathOps = pathParaOpsPdf(path.commands as any[], sf, pageH);
    if (!pathOps.length) return true;

    // q/Q: salva e restaura o estado gráfico para não vazar cor de fill para o próximo elemento
    (doc as any).internal.write([
        'q',
        `${(r / 255).toFixed(4)} ${(g / 255).toFixed(4)} ${(b / 255).toFixed(4)} rg`,
        ...pathOps,
        'f',
        'Q',
    ].join('\n'));

    return true;
}

// ── SVG preprocessing ──────────────────────────────────────────────────────────

/**
 * Remove referências de fonte do SVG antes de passar para o svg2pdf.
 * Elimina @font-face e font-family de estilos e atributos inline,
 * impedindo que o svg2pdf embutia fontes externas no PDF.
 */
export function preprocessarSvg(svgText: string): string {
    let s = svgText;

    // Remove blocos @font-face completos (single e multi-line)
    s = s.replace(/@font-face\s*\{[^}]*\}/gi, '');

    // Remove declarações font-family dentro de blocos CSS
    s = s.replace(/font-family\s*:\s*[^;}"'\n]+[;]?/gi, '');

    // Remove atributo font-family inline em elementos XML
    s = s.replace(/\sfont-family="[^"]*"/gi, '');
    s = s.replace(/\sfont-family='[^']*'/gi, '');

    return s;
}
