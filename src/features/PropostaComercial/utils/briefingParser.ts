import * as pdfjsLib from 'pdfjs-dist';
import { TemplateMascara, BriefingData } from '../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export interface PageFormData {
    textValues: Record<string, string>;
    fontSizes: Record<string, number>;
}

// Mapeamento SEMÂNTICO (o que o usuário tinha antes de eu quebrar)
const SLOT_NOME_MAP: Record<string, string[]> = {
    'cliente': ['capa_linha1'],
    'evento': ['capa_linha2'],
    'numero': ['capa_numero_proposta'],
    'data': ['capa_data'],
};

export async function parseBriefingPdf(file: File): Promise<BriefingData> {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const text = content.items.map((it: any) => it.str).join(' ');

    const data: BriefingData = {
        cliente: extract(text, /Cliente:\s*(.*?)(?=\s*Evento:|$)/i) || 'Cliente não detectado',
        evento: extract(text, /Evento:\s*(.*?)(?=\s*Local:|$)/i) || 'Evento não detectado',
        numero: extract(text, /Nº\s*(\d+)/i) || '0000',
        local: extract(text, /Local:\s*(.*?)(?=\s*Data:|$)/i),
        data: extract(text, /Data:\s*(.*?)(?=\s*Cliente:|$)/i),
        contato: null,
        telefone: null,
        email: null,
        comercial: null,
        numeroStand: null,
        areaStand: null,
        formaConstrutiva: null,
    };

    return data;
}

function extract(text: string, regex: RegExp): string | null {
    const m = text.match(regex);
    return m ? m[1].trim() : null;
}

export function autoMapBriefing(briefing: BriefingData, mascara: TemplateMascara): PageFormData[] {
    return mascara.paginas_config.map(pagina => {
        const textValues: Record<string, string> = {};

        (pagina.slots ?? []).forEach(slot => {
            if (slot.tipo !== 'texto') return;

            // Busca por nome exato ou mapeamento
            for (const [key, names] of Object.entries(SLOT_NOME_MAP)) {
                if (names.includes(slot.nome)) {
                    textValues[slot.id] = (briefing as any)[key] || '';
                }
            }

            // Fallback: se o nome do slot for igual à chave do briefing
            if (!textValues[slot.id] && (briefing as any)[slot.nome]) {
                textValues[slot.id] = (briefing as any)[slot.nome];
            }
        });

        const fontSizes: Record<string, number> = Object.fromEntries(
            (pagina.slots ?? []).map(s => [s.id, s.font_size ?? 12])
        );

        return { textValues, fontSizes };
    });
}
