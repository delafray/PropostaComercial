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
    angle_deg: number = 0,
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

    // Rotaciona os pontos do path em torno de (x_mm, y_mm) no sistema Y-down (visual CCW)
    // Em coords Y-down: x' = cx + dx*cos + dy*sin  |  y' = cy - dx*sin + dy*cos
    let commands: typeof path.commands = path.commands;
    if (angle_deg !== 0) {
        const theta = angle_deg * Math.PI / 180;
        const cosT  = Math.cos(theta);
        const sinT  = Math.sin(theta);
        const rotPt = (px: number, py: number): [number, number] => {
            const dx = px - x_mm, dy = py - y_mm;
            return [x_mm + dx * cosT + dy * sinT, y_mm - dx * sinT + dy * cosT];
        };
        commands = commands.map((cmd: any) => {
            if (cmd.type === 'M' || cmd.type === 'L') {
                const [rx, ry] = rotPt(cmd.x ?? 0, cmd.y ?? 0);
                return { ...cmd, x: rx, y: ry };
            } else if (cmd.type === 'C') {
                const [rx1, ry1] = rotPt(cmd.x1 ?? 0, cmd.y1 ?? 0);
                const [rx2, ry2] = rotPt(cmd.x2 ?? 0, cmd.y2 ?? 0);
                const [rx,  ry ] = rotPt(cmd.x  ?? 0, cmd.y  ?? 0);
                return { ...cmd, x1: rx1, y1: ry1, x2: rx2, y2: ry2, x: rx, y: ry };
            } else if (cmd.type === 'Q') {
                const [rx1, ry1] = rotPt(cmd.x1 ?? 0, cmd.y1 ?? 0);
                const [rx,  ry ] = rotPt(cmd.x  ?? 0, cmd.y  ?? 0);
                return { ...cmd, x1: rx1, y1: ry1, x: rx, y: ry };
            }
            return cmd; // 'Z'
        });
    }

    const sf: number = (doc as any).internal.scaleFactor;
    const pageH: number = (doc as any).internal.pageSize.getHeight();
    const [r, g, b] = color;

    const pathOps = pathParaOpsPdf(commands as any[], sf, pageH);
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
 * Substitui hrefs relativos de <image> no SVG por data URIs base64.
 *
 * Problema: svg2pdf não consegue resolver caminhos relativos de imagens
 * quando o SVG é processado como string (sem base URL). Esta função
 * converte cada `<image href="foto.jpg">` em
 * `<image href="data:image/jpeg;base64,...">` usando os arquivos da pasta
 * do projeto já lidos via File System Access API.
 *
 * Deve ser chamada ANTES de preprocessarSvg e inlinearCssSvg.
 * Assume que normalizarImagensSvg já rodou (href normalizado do xlink:href).
 */
export async function inlinearImagensSvg(svgText: string, arquivos: File[]): Promise<string> {
    if (!arquivos.length) return svgText;
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgEl = xmlDoc.documentElement;
    if (svgEl.querySelector('parsererror')) return svgText;

    const images = svgEl.querySelectorAll('image');
    if (!images.length) return svgText;

    let modified = false;
    for (const img of images) {
        const href = img.getAttribute('href')
                  || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
                  || img.getAttribute('xlink:href')
                  || '';
        if (!href || href.startsWith('data:')) continue;

        // Extrai apenas o nome do arquivo (ignora caminho relativo)
        const filename = href.split(/[/\\]/).pop() ?? href;
        const file = arquivos.find(f => f.name === filename);
        if (!file) continue;

        const dataUri = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
        img.setAttribute('href', dataUri);
        modified = true;
    }

    return modified ? new XMLSerializer().serializeToString(svgEl) : svgText;
}

/**
 * Normaliza atributos href de elementos <image> no SVG.
 *
 * Problema: muitos editores (Inkscape, CorelDraw, Illustrator) geram SVGs
 * com imagens embutidas em `xlink:href` (SVG 1.1). O svg2pdf.js lê apenas
 * o atributo `href` (SVG 2). Sem essa normalização, imagens visíveis no
 * browser simplesmente somem no PDF.
 *
 * Faz apenas uma coisa: para cada <image> sem `href`, copia o valor de
 * `xlink:href` para `href`. Preserva tudo o mais intacto.
 */
export function normalizarImagensSvg(svgText: string): string {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgEl = xmlDoc.documentElement;
    if (svgEl.querySelector('parsererror')) return svgText;

    const images = svgEl.querySelectorAll('image');
    if (!images.length) return svgText;

    let modified = false;
    for (const img of images) {
        if (!img.getAttribute('href')) {
            const xlinkHref = img.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
                           || img.getAttribute('xlink:href');
            if (xlinkHref) {
                img.setAttribute('href', xlinkHref);
                modified = true;
            }
        }
    }

    return modified ? new XMLSerializer().serializeToString(svgEl) : svgText;
}

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

/**
 * Converte regras CSS de blocos <style> em atributos inline nos elementos SVG.
 *
 * Problema: svg2pdf.js tem suporte parcial a CSS classes — elementos que
 * definem fill/stroke via classe (.st0 { fill: #ccc }) podem perder cor.
 * Esta função resolve aplicando as regras diretamente como style inline
 * antes de entregar o SVG ao svg2pdf.
 *
 * Preserva atributos inline já existentes (não sobrescreve).
 */
export function inlinearCssSvg(svgText: string): string {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgEl = xmlDoc.documentElement;

    // Aborta se o SVG não parseou corretamente
    if (svgEl.querySelector('parsererror')) return svgText;

    const styleEls = svgEl.querySelectorAll('style');
    if (!styleEls.length) return svgText;

    // Extrai regras CSS dos blocos <style> (ignora @rules como @font-face)
    const rules: Array<{ selector: string; props: Record<string, string> }> = [];

    for (const styleEl of styleEls) {
        const cssText = styleEl.textContent ?? '';
        // Captura: seletor { declarações } — pula linhas que começam com @
        const ruleRe = /([^@{}][^{}]*)\{([^}]*)\}/g;
        let m: RegExpExecArray | null;
        while ((m = ruleRe.exec(cssText)) !== null) {
            const selector = m[1].trim();
            if (!selector) continue;
            const props: Record<string, string> = {};
            for (const decl of m[2].split(';')) {
                const colon = decl.indexOf(':');
                if (colon < 0) continue;
                const prop = decl.slice(0, colon).trim();
                const val  = decl.slice(colon + 1).trim();
                if (prop && val) props[prop] = val;
            }
            if (Object.keys(props).length) rules.push({ selector, props });
        }
    }

    if (!rules.length) return svgText;

    // Aplica as regras como style inline (sem sobrescrever inline já existente)
    for (const { selector, props } of rules) {
        try {
            const els = svgEl.querySelectorAll(selector);
            for (const el of els) {
                for (const [prop, val] of Object.entries(props)) {
                    if (!(el as HTMLElement).style.getPropertyValue(prop)) {
                        (el as HTMLElement).style.setProperty(prop, val);
                    }
                }
            }
        } catch {
            // Seletor inválido ou não suportado — ignora silenciosamente
        }
    }

    return new XMLSerializer().serializeToString(svgEl);
}
