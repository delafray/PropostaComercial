import type jsPDF from 'jspdf';

/**
 * Fontes disponíveis para embedding no PDF.
 * Arquivos ficam em /public/fonts/ — servidos estaticamente pelo Vite.
 *
 * Mapeamento:
 *   'helvetica'      → Arial (equivalente métrico no Windows, evita substituição no CorelDraw)
 *   'century-gothic' → Century Gothic (fonte real, sem fallback)
 */

type FontStyle = 'normal' | 'bold' | 'italic' | 'bolditalic';

interface FontFile {
    family: string;   // nome interno do jsPDF
    style: FontStyle;
    file: string;     // arquivo em /public/fonts/
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

/** Cache para não baixar o mesmo arquivo duas vezes na mesma sessão */
const _cache = new Map<string, string>();

async function ttfToBase64(file: string): Promise<string> {
    if (_cache.has(file)) return _cache.get(file)!;
    const res = await fetch(`/fonts/${file}`);
    if (!res.ok) throw new Error(`Fonte não encontrada: /fonts/${file} (${res.status})`);
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    _cache.set(file, b64);
    return b64;
}

/**
 * Registra todas as fontes no documento jsPDF.
 * Deve ser chamado UMA VEZ após criar o `doc`, antes de qualquer `setFont`.
 */
export async function registrarFontes(doc: jsPDF): Promise<void> {
    for (const { family, style, file } of FONT_MAP) {
        try {
            const b64 = await ttfToBase64(file);
            // vfsName precisa ser único por arquivo
            doc.addFileToVFS(file, b64);
            doc.addFont(file, family, style);
        } catch (e) {
            console.warn(`[fontLoader] Falha ao registrar ${family}/${style}:`, e);
            // Continua — jsPDF usará o fallback interno para essa fonte
        }
    }
}

/**
 * Retorna o nome de família normalizado para uso no jsPDF.
 * Qualquer família não mapeada cai para 'helvetica' (que está registrada como Arial).
 */
export function normalizarFamilia(fontFamily: string | undefined): string {
    const f = (fontFamily ?? '').toLowerCase().trim();
    if (f === 'century-gothic') return 'century-gothic';
    return 'helvetica';
}
