// @ts-nocheck
import React, { useState, useEffect } from 'react';
import jsPDF from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';
import { templateService } from '../services/templateService';
import { propostaService } from '../services/propostaService';
import { TemplateMascara, TemplateBackdrop, PaginaConfig, SlotElemento, Proposta } from '../types';
import PdfActionModal from './PdfActionModal';
import { carregarHandle, pedirPermissao, lerArquivos, suportaFSA } from '../utils/pastaHandle';
import { prefService } from '../services/prefService';
import { SlotDefaults, prefKeyForMascara } from './ConfiguracaoPage';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchBase64(url: string): Promise<{ data: string; format: 'PNG' | 'JPEG' }> {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const b64 = (reader.result as string).split(',')[1];
            const format = blob.type.includes('png') ? 'PNG' : 'JPEG';
            resolve({ data: b64, format });
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function adicionarFundo(
    doc: jsPDF,
    backdrop: TemplateBackdrop,
    W: number,
    H: number,
): Promise<void> {
    if (backdrop.tipo_arquivo === 'SVG') {
        const res = await fetch(backdrop.url_imagem);
        const svgText = await res.text();
        const parser = new DOMParser();
        const svgEl = parser.parseFromString(svgText, 'image/svg+xml').documentElement;
        await svg2pdf(svgEl, doc, { x: 0, y: 0, width: W, height: H });
    } else {
        const { data, format } = await fetchBase64(backdrop.url_imagem);
        doc.addImage(data, format, 0, 0, W, H);
    }
}

function hexToRgb(hex: string): [number, number, number] {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex ?? '#000000');
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

// ── Helpers: Script Planta ────────────────────────────────────────────────────

/** Retorna as dimensões naturais (pixels) de um File de imagem (JPG/PNG/SVG). */
async function getImageNaturalSize(file: File): Promise<{ w: number; h: number }> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler dimensões da planta')); };
        img.src = url;
    });
}

/** Calcula posição/tamanho "contain" dentro do slot em mm (maior possível, sem distorção, centralizado). */
function containInSlot(
    slot: SlotElemento,
    imgW: number,
    imgH: number
): { x: number; y: number; w: number; h: number } {
    const slotAsp = slot.w_mm / Math.max(slot.h_mm, 0.001);
    const imgAsp = imgW / Math.max(imgH, 0.001);
    let w, h;
    if (imgAsp > slotAsp) {
        w = slot.w_mm;
        h = w / imgAsp;
    } else {
        h = slot.h_mm;
        w = h * imgAsp;
    }
    return {
        x: slot.x_mm + (slot.w_mm - w) / 2,
        y: slot.y_mm + (slot.h_mm - h) / 2,
        w, h,
    };
}

async function fileToBase64(file: File): Promise<{ data: string; format: 'PNG' | 'JPEG' }> {
    const url = URL.createObjectURL(file);
    const result = await fetchBase64(url);
    URL.revokeObjectURL(url);
    return result;
}

async function grayscaleBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const d = imageData.data;
            for (let i = 0; i < d.length; i += 4) {
                const gray = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
                const light = Math.round(gray * 0.4 + 153); // empurra para branco ~60%
                d[i] = light; d[i + 1] = light; d[i + 2] = light;
            }
            ctx.putImageData(imageData, 0, 0);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/png').split(',')[1]);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Erro ao carregar planta')); };
        img.src = url;
    });
}

function loadCanvasFromUrl(url: string): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            c.getContext('2d')!.drawImage(img, 0, 0);
            resolve(c);
        };
        img.onerror = reject;
        img.src = url;
    });
}

function downscaleCanvas(src: HTMLCanvasElement, maxW: number): HTMLCanvasElement {
    const scale = Math.min(1, maxW / Math.max(src.width, 1));
    if (scale >= 1) return src;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(src.width * scale));
    c.height = Math.max(1, Math.round(src.height * scale));
    c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
    return c;
}

function toGrayArray(canvas: HTMLCanvasElement): Uint8Array {
    const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const g = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < g.length; i++) {
        g[i] = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
    }
    return g;
}

interface OcvMatch { cx_ratio: number; cy_ratio: number; w_ratio: number; h_ratio: number; img_aspect: number; label: string; score: number; }

async function matchTemplate(plantaFile: File, ref: TemplateReferencia): Promise<OcvMatch | null> {
    try {
        const pUrl = URL.createObjectURL(plantaFile);
        const plantaFull = await loadCanvasFromUrl(pUrl);
        URL.revokeObjectURL(pUrl);

        const tmplFull = await loadCanvasFromUrl(ref.url_imagem_referencia);

        const MAX_W = 600;
        const scale = Math.min(1, MAX_W / Math.max(plantaFull.width, 1));
        const planta = downscaleCanvas(plantaFull, MAX_W);
        const tmplW = Math.max(4, Math.round(tmplFull.width * scale));
        const tmpl = downscaleCanvas(tmplFull, tmplW);

        const PW = planta.width, PH = planta.height;
        const TW = tmpl.width, TH = tmpl.height;
        if (TW >= PW || TH >= PH || TW < 2 || TH < 2) return null;

        const pg = toGrayArray(planta);
        const tg = toGrayArray(tmpl);

        const SAMPLE = 2;
        let tmean = 0, cnt = 0;
        for (let ty = 0; ty < TH; ty += SAMPLE) {
            for (let tx = 0; tx < TW; tx += SAMPLE) { tmean += tg[ty * TW + tx]; cnt++; }
        }
        tmean /= Math.max(1, cnt);

        let tSumSq = 0;
        for (let ty = 0; ty < TH; ty += SAMPLE) {
            for (let tx = 0; tx < TW; tx += SAMPLE) {
                const tv = tg[ty * TW + tx] - tmean; tSumSq += tv * tv;
            }
        }
        const tNorm = Math.sqrt(tSumSq);
        if (tNorm === 0) return null;

        let bestNcc = -1, bestX = 0, bestY = 0;
        const STRIDE = 3;

        for (let y = 0; y <= PH - TH; y += STRIDE) {
            for (let x = 0; x <= PW - TW; x += STRIDE) {
                let pmean = 0, pc = 0;
                for (let ty = 0; ty < TH; ty += SAMPLE) {
                    for (let tx = 0; tx < TW; tx += SAMPLE) {
                        pmean += pg[(y + ty) * PW + (x + tx)]; pc++;
                    }
                }
                pmean /= Math.max(1, pc);
                let dotProd = 0, pSumSq = 0;
                for (let ty = 0; ty < TH; ty += SAMPLE) {
                    for (let tx = 0; tx < TW; tx += SAMPLE) {
                        const pv = pg[(y + ty) * PW + (x + tx)] - pmean;
                        const tv = tg[ty * TW + tx] - tmean;
                        dotProd += pv * tv; pSumSq += pv * pv;
                    }
                }
                const ncc = pSumSq > 0 ? dotProd / (Math.sqrt(pSumSq) * tNorm) : 0;
                if (ncc > bestNcc) { bestNcc = ncc; bestX = x; bestY = y; }
            }
        }

        if (bestNcc < 0.65) return null;

        return {
            cx_ratio: (bestX + TW / 2) / PW,
            cy_ratio: (bestY + TH / 2) / PH,
            w_ratio: TW / PW,
            h_ratio: TH / PH,
            img_aspect: tmplFull.width / Math.max(1, tmplFull.height), // aspect ratio original
            label: ref.nome_item,
            score: bestNcc,
        };
    } catch (e) {
        console.warn(`OCV match falhou para "${ref.nome_item}":`, e);
        return null;
    }
}

type PlacedBox = { x: number; y: number; w: number; h: number };

function overlapsAny(box: PlacedBox, placed: PlacedBox[]): boolean {
    for (const p of placed) {
        if (box.x < p.x + p.w && box.x + box.w > p.x &&
            box.y < p.y + p.h && box.y + box.h > p.y) return true;
    }
    return false;
}

function drawPlantaAnnotations(
    doc: jsPDF,
    drawRegion: { x: number; y: number; w: number; h: number }, // área real da planta no PDF
    matches: Array<{ match: OcvMatch; ref: TemplateReferencia; imgB64: string; imgFormat: 'PNG' | 'JPEG' }>
) {
    const placed: PlacedBox[] = [];
    const ANGLES = [-Math.PI / 2, -Math.PI / 4, 0, Math.PI / 4, Math.PI / 2, Math.PI * 3 / 4, Math.PI, -Math.PI * 3 / 4];

    for (const { match, ref, imgB64, imgFormat } of matches) {
        // Mapeia coordenadas do match para a região real da planta (não o slot inteiro)
        const cx = drawRegion.x + match.cx_ratio * drawRegion.w;
        const cy = drawRegion.y + match.cy_ratio * drawRegion.h;
        const mw = Math.max(3, match.w_ratio * drawRegion.w);
        const mh = Math.max(3, match.h_ratio * drawRegion.h);

        // Overlay da isca (colorida) — aspect ratio preservado (contain dentro do match box)
        const asp = match.img_aspect;
        let dispW = mw, dispH = mh;
        if (mw / Math.max(mh, 0.001) > asp) {
            dispW = mh * asp; // limitado pela altura
        } else {
            dispH = mw / Math.max(asp, 0.001); // limitado pela largura
        }
        doc.addImage(imgB64, imgFormat, cx - dispW / 2, cy - dispH / 2, dispW, dispH, undefined, 'FAST');

        // Borda colorida ao redor do overlay (mesmas dimensões do dispW/dispH)
        const [br, bg, bb] = hexToRgb(ref.cor_holograma ?? '#d22323');
        doc.setDrawColor(br, bg, bb);
        doc.setLineWidth(0.4);
        doc.rect(cx - dispW / 2, cy - dispH / 2, dispW, dispH, 'S');

        // Tamanho do label baseado no texto
        doc.setFontSize(6);
        doc.setFont('helvetica', 'bold');
        const LABEL_W = Math.min(doc.getTextWidth(ref.nome_item.toUpperCase()) + 3, 40);
        const LABEL_H = 4.5;
        const DIST = Math.max(dispW, dispH) / 2 + 4;

        // Testa 8 ângulos para posição do label — escolhe o primeiro sem sobreposição
        let lx = cx - LABEL_W / 2;
        let ly = cy - DIST - LABEL_H;
        for (let ai = 0; ai < ANGLES.length; ai++) {
            const candX = cx + Math.cos(ANGLES[ai]) * DIST - LABEL_W / 2;
            const candY = cy + Math.sin(ANGLES[ai]) * DIST;
            const clampedX = Math.max(drawRegion.x, Math.min(drawRegion.x + drawRegion.w - LABEL_W, candX));
            const clampedY = Math.max(drawRegion.y, Math.min(drawRegion.y + drawRegion.h - LABEL_H, candY));
            const box: PlacedBox = { x: clampedX, y: clampedY, w: LABEL_W, h: LABEL_H };
            if (!overlapsAny(box, placed) || ai === ANGLES.length - 1) {
                lx = clampedX; ly = clampedY;
                placed.push(box);
                break;
            }
        }

        // Seta: linha do centro do label ao centro do match
        doc.setDrawColor(br, bg, bb);
        doc.setLineWidth(0.35);
        doc.line(lx + LABEL_W / 2, ly + LABEL_H / 2, cx, cy);

        // Caixa do label (fundo branco + borda colorida)
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(br, bg, bb);
        doc.setLineWidth(0.25);
        doc.rect(lx, ly, LABEL_W, LABEL_H, 'FD');

        // Texto do label
        doc.setFontSize(6);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(br, bg, bb);
        doc.text(ref.nome_item.toUpperCase(), lx + 1.5, ly + LABEL_H - 1.3);
    }
}

// ── Componente ────────────────────────────────────────────────────────────────

export default function GerarPdfPage({ onGoToNova }: { onGoToNova?: () => void } = {}) {
    const [mascara, setMascara] = useState<TemplateMascara | null>(null);
    const [backdrops, setBackdrops] = useState<TemplateBackdrop[]>([]);
    const [proposta, setProposta] = useState<Proposta | null>(null);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [progress, setProgress] = useState('');
    const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
    const [pdfName, setPdfName] = useState('');
    const [arquivosLocais, setArquivosLocais] = useState<File[]>([]);
    const [needsPermission, setNeedsPermission] = useState(false);
    const [error, setError] = useState('');
    const [pastaHandle, setPastaHandle] = useState<FileSystemDirectoryHandle | null>(null);
    const [debugMode, setDebugMode] = useState(false);
    const [slotDefaults, setSlotDefaults] = useState<SlotDefaults>({});
    const [referenciasOCV, setReferenciasOCV] = useState<TemplateReferencia[]>([]);

    useEffect(() => { loadData(); }, []);

    async function loadData() {
        try {
            setLoading(true);
            const [mascaras, bd, propostas, refs] = await Promise.all([
                templateService.getMascaras(),
                templateService.getBackdrops(),
                propostaService.getPropostas(),
                templateService.getReferencias().catch(() => []),
            ]);
            setReferenciasOCV(refs as TemplateReferencia[]);
            // Sempre usa o 1º de cada lista
            const mc = mascaras[0] ?? null;
            setMascara(mc);
            setBackdrops(bd);
            setProposta(propostas[0] ?? null);

            if (mc) {
                const savedDefs = await prefService.loadPref(prefKeyForMascara(mc.id)).catch(() => null);
                setSlotDefaults((savedDefs as SlotDefaults) ?? {});
            }

            if (suportaFSA()) {
                const handle = await carregarHandle().catch(() => null);
                if (handle) {
                    setPastaHandle(handle);
                    const perm = await (handle as any).queryPermission({ mode: 'read' });
                    if (perm === 'granted') {
                        const files = await lerArquivos(handle);
                        setArquivosLocais(files);
                        setNeedsPermission(false);
                    } else {
                        setNeedsPermission(true);
                    }
                }
            }

        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }

    async function handleAllowFolder() {
        if (!pastaHandle) return;
        try {
            const granted = await pedirPermissao(pastaHandle);
            if (granted) {
                const files = await lerArquivos(pastaHandle);
                setArquivosLocais(files);
                setNeedsPermission(false);
                setError('');
            } else {
                setError('Permissão negada para ler a pasta do projeto.');
            }
        } catch (e: any) {
            setError(`Erro ao acessar pasta: ${e.message}`);
        }
    }


    // ── Geração ───────────────────────────────────────────────────────────────

    async function gerarPdf() {
        if (!mascara) return;
        setGenerating(true);
        setError('');
        setPdfBlob(null);
        setProgress('Iniciando...');

        try {
            const W = 297, H = 210;
            const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

            // Ordena as páginas da máscara
            const paginasConfig = [...(mascara.paginas_config ?? [])].sort((a, b) => a.pagina - b.pagina);

            // ── Renders (busca local, ordenados pelo nome crescente) ─────────

            let renderUrls: string[] = [];
            if (proposta) {
                const renderNames: string[] = proposta.dados?.renders ?? [];

                if (renderNames.length > 0) {
                    // Se a pasta não está carregada, tenta pedir acesso agora
                    let arquivos = arquivosLocais;
                    if (arquivos.length === 0 && pastaHandle) {
                        setProgress('Aguardando acesso à pasta...');
                        const granted = await pedirPermissao(pastaHandle);
                        if (granted) {
                            arquivos = await lerArquivos(pastaHandle);
                            setArquivosLocais(arquivos);
                        }
                    }

                    if (arquivos.length === 0) {
                        throw new Error('Não foi possível acessar a pasta do projeto. Selecione a pasta novamente na aba Nova Proposta.');
                    }

                    // Ordena pelo nome crescente (10.jpg < 11.jpg < 12.jpg...)
                    const sorted = [...renderNames].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

                    for (const renderName of sorted) {
                        const localFile = arquivos.find(f => f.name === renderName);
                        if (localFile) {
                            renderUrls.push(URL.createObjectURL(localFile));
                        } else {
                            throw new Error(`Imagem "${renderName}" não encontrada na pasta local. Verifique se o arquivo existe na pasta selecionada.`);
                        }
                    }
                }
            }

            // ── Auto-fill a partir do briefing ───────────────────────────────

            function buildBriefingMap(): Record<string, string> {
                const b = proposta?.dados?.briefing;

                // Gerar data atual (Mês e Ano) em PT-BR para a capa
                const agora = new Date();
                const meses = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
                const mesExtenso = meses[agora.getMonth()];
                const anoAtual = agora.getFullYear().toString();

                const cliente = (b?.cliente ?? '').trim().toUpperCase();
                const evento = (b?.evento ?? '').trim().toUpperCase();

                // Extrai tamanhoEstande dos nomes de arquivo salvos na pasta
                let tamanho = '';
                for (const nome of (proposta?.dados?.pasta?.arquivos ?? [])) {
                    const m = nome.match(/(\d+)[,.](\d+)m/i);
                    if (m) { tamanho = `${m[1]},${m[2]}m`; break; }
                }

                const data = b?.data ?? '';
                const local = (b?.local ?? '').toUpperCase();
                const nStand = b?.numeroStand ?? '';
                const area = b?.areaStand ? `${b?.areaStand} m²` : '';
                const comercial = (b?.comercial ?? '').toUpperCase();
                const forma = (b?.formaConstrutiva ?? tamanho).toUpperCase();

                // Nomes semânticos v2 — alinhados com 20260306_pc_slots_fix_where.sql
                return {
                    capa_linha1: [cliente, evento].filter(Boolean).join(' : '),
                    capa_linha2: `${mesExtenso} : ${anoAtual}`,
                    header_numero: b?.numero ?? '',
                    header_stand: nStand,
                    footer_cliente: cliente,
                    footer_comercial: comercial,
                    footer_evento: evento,
                    footer_n_stand: nStand,
                    footer_forma: forma,
                    footer_area: area,
                    footer_data: data,
                    footer_local: local,
                    footer_email: b?.email ?? '',
                };
            }

            // ── Mapa de textos por página ─────────────────────────────────────
            // Auto-fill do briefing + override por valores manuais da proposta

            const autoMap = buildBriefingMap();

            function buildTextMap(pageConfig: PaginaConfig | null): Record<string, string> {
                if (!pageConfig) return {};
                const map: Record<string, string> = {};
                const pg = proposta?.dados?.paginas?.find(p => p.pagina === pageConfig.pagina);

                for (const slot of pageConfig.slots ?? []) {
                    const slotDef = slotDefaults[slot.id];
                    const mode = slotDef?.mode ?? (slot.tipo === 'texto' ? 'text' : 'text');

                    if (mode === 'script') {
                        if (slotDef?.scriptName === 'hoje') {
                            map[slot.nome] = new Date().toLocaleDateString('pt-BR');
                        } else if (slotDef?.scriptName === 'cliente_evento') {
                            const b = proposta?.dados?.briefing;
                            const cli = (b?.cliente ?? '').trim();
                            const eve = (b?.evento ?? '').trim();
                            map[slot.nome] = [cli, eve].filter(Boolean).join(' · ');
                        } else if (slotDef?.scriptName === 'mes_ano') {
                            const agora = new Date();
                            const meses = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
                            map[slot.nome] = `${meses[agora.getMonth()]} | ${agora.getFullYear()}`;
                        } else if (slotDef?.scriptName === '01') {
                            map[slot.nome] = proposta?.dados?.memorial ?? '';
                        }
                        // script 'projeto' é tratado no loop de páginas (imagem), não aqui
                        continue;
                    }

                    const manual = pg?.slots?.[slot.id];
                    const configDefault = slotDef?.value ?? '';

                    // Field mode → briefing[fieldKey] > manual (ignora value residual)
                    if (mode === 'field' && slotDef?.fieldKey) {
                        const rawVal = (proposta?.dados?.briefing as any)?.[slotDef.fieldKey];
                        const resolved = (rawVal ? String(rawVal).trim().toUpperCase() : '')
                            || (manual ? String(manual).trim() : '');
                        if (resolved) map[slot.nome] = resolved;
                        continue;
                    }

                    const auto = slot.tipo === 'texto' ? (autoMap[slot.nome] || '') : '';

                    // Pula slot sem nenhum valor disponível
                    if (!manual && !auto && !configDefault) continue;

                    // Prioridade: manual > briefing auto > config default
                    map[slot.nome] = (manual !== undefined && manual !== null && String(manual).trim() !== '')
                        ? String(manual)
                        : auto || configDefault;
                }
                return map;
            }

            function buildFontSizeMap(pageConfig: PaginaConfig | null): Record<string, number> {
                if (!pageConfig) return {};
                const pg = proposta?.dados?.paginas?.find(p => p.pagina === pageConfig.pagina);
                const map: Record<string, number> = {};
                for (const slot of pageConfig.slots ?? []) {
                    const fromProposta = pg?.fontSizes?.[slot.id];
                    const fromConfig = slotDefaults[slot.id]?.fontSize;

                    if (fromProposta !== undefined) {
                        // Heurística de limpeza: se o valor salvo for exatamente o fallback padrão original do template
                        // e houver uma configuração global ativa, assumimos que o valor salvo foi um auto-save indesejado.
                        const fallbackSize = slot.font_size ?? 12;
                        if (fromProposta === fallbackSize && fromConfig !== undefined) {
                            map[slot.id] = fromConfig;
                        } else {
                            map[slot.id] = fromProposta;
                        }
                    } else if (fromConfig !== undefined) {
                        map[slot.id] = fromConfig;
                    }
                }
                return map;
            }


            // ── Função auxiliar Script 01 (Descritivo Tabulado) ───────────────

            function renderDescritivo01(doc: jsPDF, lines: string[], slot: SlotElemento, fontSizeMap: Record<string, number> = {}): string[] {
                const configColor = slotDefaults[slot.id]?.color;
                const [r, g, b] = hexToRgb(configColor ?? slot.color ?? '#000000');
                doc.setTextColor(r, g, b);

                const defaultSize = fontSizeMap[slot.id] ?? slotDefaults[slot.id]?.fontSize ?? slot.font_size ?? 10;
                let configFontFamily = slotDefaults[slot.id]?.fontFamily ?? 'helvetica';
                if (configFontFamily === 'century-gothic') configFontFamily = 'helvetica';

                let currentY = slot.y_mm;
                const lineHeight = defaultSize * 0.35; // mm per line approx (tighter)
                const lineSpacing = 0.5; // Espaçamento menor entre linhas
                const maxY = slot.y_mm + slot.h_mm;

                // Definir larguras/posições das colunas (relativas ao X inicial)
                const X_START = slot.x_mm;
                const COL_QTD = X_START + 12;
                const COL_UNID = X_START + 25;
                const COL_DESC = X_START + 40;

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (currentY > maxY - lineHeight) {
                        return lines.slice(i); // Retorna as linhas excedentes para a próxima página
                    }

                    // Checa se a linha tem tabs (indicando que é um item da lista)
                    if (line.includes('\t')) {
                        // Linha Normal: Item técnico -> ID \t Qtd \t Unid \t Desc
                        doc.setFontSize(defaultSize - 1); // ligeiramente menor que o título
                        doc.setFont(configFontFamily, 'normal');

                        let parts = line.split('\t').map(p => p.trim());

                        // Heurística para linhas sem ID (ex: "100 \t m2 \t Revestimento...")
                        // Se tem apenas 3 partes, ou se a primeira palavra não tem um ponto separador (ex '1.1') e a segunda parte parece uma unidade de medida..
                        if (parts.length === 3 || (parts.length > 1 && !parts[0].includes('.') && isNaN(Number(parts[0].replace(',', '.'))) === false)) {
                            // Empurra as colunas pra direita: [vazio, Qtd, Unid, Descrição]
                            parts = ['', parts[0], parts[1], parts.slice(2).join(' ')];
                        }

                        // ID (left)
                        if (parts[0]) doc.text(parts[0], X_START, currentY + lineHeight);

                        // Qtd (left)
                        if (parts[1]) doc.text(parts[1], COL_QTD, currentY + lineHeight);

                        // Unid (left)
                        if (parts[2]) doc.text(parts[2], COL_UNID, currentY + lineHeight);

                        // Desc (left) - Corta se for muito longa
                        if (parts[3]) {
                            const maxW = slot.w_mm - (COL_DESC - X_START); // Espaço restante
                            let desc = parts[3];
                            // Tentativa simples de elipse se passar do limite visual
                            // Idealmente usar doc.splitTextToSize, mas manteremos simple.
                            doc.text(desc, COL_DESC, currentY + lineHeight, { maxWidth: maxW - 2 });
                        }

                        // Avança linha para itens normais
                        currentY += lineHeight + lineSpacing;

                    } else {
                        // Linha sem tab: É uma Categoria (ex: "Mobiliário")
                        doc.setFontSize(defaultSize);
                        doc.setFont(configFontFamily, 'bold');

                        // Espaço extra antes da categoria (apenas se não for a primeira linha)
                        if (currentY > slot.y_mm) {
                            currentY += (lineHeight * 0.8);
                        }

                        if (currentY > maxY - lineHeight) break;

                        doc.text(line, COL_DESC, currentY + lineHeight); // Alinhado com a descrição

                        // Avança linha com um pouco mais de respiro DEPOIS da categoria
                        currentY += lineHeight + (lineSpacing * 2);
                    }
                }

                return []; // Todas as linhas couberam nesta página
            }

            // ── Renderizar textos ─────────────────────────────────────────────

            function renderizarTextos(
                slots: SlotElemento[],
                nameToValue: Record<string, string>,
                isCapa = false,
                fontSizeMap: Record<string, number> = {},
                linesOverride?: string[]
            ): string[] {
                let leftOvers: string[] = [];

                for (const slot of slots) {
                    const text = nameToValue[slot.nome] ?? '';
                    const slotDef = slotDefaults[slot.id];

                    // Se estamos numa página de transbordo (linesOverride existe), ignorar todos os slots NÃO-SCRIPT 01
                    if (linesOverride && slotDef?.scriptName !== '01') continue;

                    // Se não tem texto E também não temos linesOverride, pula
                    if (!text && !linesOverride) continue;

                    if (slotDef?.scriptName === '01') {
                        // Passa as linhas de override se existirem, senão quebra o texto novo
                        const linesToRender = linesOverride ?? text.split('\n').map(l => l.trim()).filter(Boolean);
                        leftOvers = renderDescritivo01(doc, linesToRender, slot, fontSizeMap);
                        continue; // Importante: Pula a renderização padrão de texto se for o script 01
                    }

                    if (!text) continue; // Slots normais precisam de texto

                    // Cor: config default > slot definition
                    const configColor = slotDefaults[slot.id]?.color;
                    const [r, g, b] = hexToRgb(configColor ?? slot.color ?? '#000000');
                    doc.setTextColor(r, g, b);

                    // Tamanho: fontSizeMap (proposta/config) > slot.font_size > 10
                    let finalSize = fontSizeMap[slot.id] ?? slotDefaults[slot.id]?.fontSize ?? slot.font_size ?? 10;
                    if (isCapa && !fontSizeMap[slot.id] && !slotDefaults[slot.id]?.fontSize) {
                        finalSize += 8;
                    } else if (slot.nome.startsWith('footer_') && !fontSizeMap[slot.id] && !slotDefaults[slot.id]?.fontSize) {
                        finalSize = 10;
                    }

                    doc.setFontSize(finalSize);

                    // Fonte e estilo: config default > slot definition
                    let configFontFamily = slotDefaults[slot.id]?.fontFamily ?? 'helvetica';
                    const configFontStyle = slotDefaults[slot.id]?.fontStyle ?? slot.font_style ?? 'normal';

                    // Fallback para fontes não-padrão no jsPDF (Century Gothic exigiria .ttf registrado)
                    if (configFontFamily === 'century-gothic') {
                        // Por enquanto fallback para helvetica para evitar erros no jsPDF
                        // mas mantém o valor no estado para futura integração de .ttf
                        configFontFamily = 'helvetica';
                    }

                    doc.setFont(
                        configFontFamily,
                        configFontStyle === 'bold' ? 'bold'
                            : configFontStyle === 'italic' ? 'italic'
                                : 'normal'
                    );

                    // Alinhamento: config default > slot definition
                    const align = (slotDefaults[slot.id]?.align ?? slot.align ?? 'left') as 'left' | 'center' | 'right';
                    const x = align === 'center' ? slot.x_mm + slot.w_mm / 2
                        : align === 'right' ? slot.x_mm + slot.w_mm
                            : slot.x_mm;
                    const y = slot.y_mm + slot.h_mm * 0.75;

                    doc.text(text, x, y, { align });

                    // -- MODO DEBUG: Retângulo e Nome do Slot --
                    if (debugMode) {
                        doc.setDrawColor(255, 0, 255); // Magenta
                        doc.setLineWidth(0.1);
                        doc.rect(slot.x_mm, slot.y_mm, slot.w_mm, slot.h_mm, 'S');

                        doc.setFontSize(6);
                        doc.setTextColor(255, 0, 255);
                        doc.text(`[${slot.nome}]`, slot.x_mm, slot.y_mm - 1);
                    }
                }
                return leftOvers;
            }

            let pageIndex = 0;


            // ── Loop Unificado de Páginas ──────────────────────────────────────

            for (const cfgPagina of paginasConfig) {
                const bd = cfgPagina.backdrop_id
                    ? backdrops.find(b => b.id === cfgPagina.backdrop_id) ?? null
                    : null;

                const textMap = buildTextMap(cfgPagina);
                const fsMap = buildFontSizeMap(cfgPagina);
                const isCapa = cfgPagina.pagina === 1 || cfgPagina.descricao?.toLowerCase().includes('capa');

                // Detecta o slot configurado com o script 'projeto'
                const projetoSlot = (cfgPagina.slots ?? []).find(s => {
                    const def = slotDefaults[s.id];
                    return def?.mode === 'script' && def?.scriptName === 'projeto';
                });

                // Detecta o slot configurado com o script 'planta'
                const plantaSlot = (cfgPagina.slots ?? []).find(s => {
                    const def = slotDefaults[s.id];
                    return def?.mode === 'script' && def?.scriptName === 'planta';
                });

                // Todos os outros slots (exceto projeto e planta)
                const otherSlots = (cfgPagina.slots ?? []).filter(s => s !== projetoSlot && s !== plantaSlot);

                // Repete 1× por render (projeto), 2× (planta: original + anotada), ou 1× normal
                const timesToRepeat = projetoSlot
                    ? Math.max(renderUrls.length, 1)
                    : plantaSlot ? 2 : 1;

                let remainingLines: string[] | undefined = undefined;

                for (let ri = 0; ri < timesToRepeat; ri++) {
                    do {
                        setProgress(`Gerando ${cfgPagina.descricao || `Página ${cfgPagina.pagina}`}${projetoSlot && timesToRepeat > 1 ? ` (${ri + 1}/${timesToRepeat})` : ''}...`);
                        if (pageIndex > 0) doc.addPage();

                        if (bd) {
                            await adicionarFundo(doc, bd, W, H);
                        } else {
                            doc.setFillColor(252, 252, 252);
                            doc.rect(0, 0, W, H, 'F');
                        }

                        // Insere o render no slot de projeto
                        if (projetoSlot && renderUrls[ri]) {
                            try {
                                const { data, format } = await fetchBase64(renderUrls[ri]);
                                doc.addImage(
                                    data,
                                    format,
                                    projetoSlot.x_mm,
                                    projetoSlot.y_mm,
                                    projetoSlot.w_mm,
                                    projetoSlot.h_mm,
                                    undefined,
                                    'FAST'
                                );
                            } catch (imgErr) {
                                console.warn(`Render ${ri + 1} não carregado:`, imgErr);
                            }
                        }

                        // Insere a planta (original ou cinza anotada) — contain sem distorção
                        if (plantaSlot) {
                            const plantaFile = arquivosLocais.find(f => /^planta\.(jpg|jpeg|png|svg)$/i.test(f.name)) ?? null;
                            if (plantaFile) {
                                const isSvg = /\.svg$/i.test(plantaFile.name);

                                // Dimensões naturais para calcular contain
                                const dims = await getImageNaturalSize(plantaFile).catch(() => ({ w: plantaSlot.w_mm, h: plantaSlot.h_mm }));
                                const region = containInSlot(plantaSlot, dims.w, dims.h);

                                if (ri === 0) {
                                    // Página A: planta original (contain)
                                    if (isSvg) {
                                        const svgText = await plantaFile.text();
                                        const parser = new DOMParser();
                                        const svgEl = parser.parseFromString(svgText, 'image/svg+xml').documentElement;
                                        // Tenta extrair dims do viewBox para contain correto
                                        const vb = svgEl.getAttribute('viewBox');
                                        if (vb) {
                                            const parts = vb.split(/[\s,]+/).map(parseFloat);
                                            if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
                                                const svgRegion = containInSlot(plantaSlot, parts[2], parts[3]);
                                                await svg2pdf(svgEl, doc, { x: svgRegion.x, y: svgRegion.y, width: svgRegion.w, height: svgRegion.h });
                                            } else {
                                                await svg2pdf(svgEl, doc, { x: region.x, y: region.y, width: region.w, height: region.h });
                                            }
                                        } else {
                                            await svg2pdf(svgEl, doc, { x: region.x, y: region.y, width: region.w, height: region.h });
                                        }
                                    } else {
                                        const { data, format } = await fileToBase64(plantaFile);
                                        doc.addImage(data, format, region.x, region.y, region.w, region.h, undefined, 'FAST');
                                    }
                                } else {
                                    // Página B: cinza claro + anotações OpenCV (contain)
                                    setProgress('Convertendo planta para cinza...');
                                    const grayData = await grayscaleBase64(plantaFile);
                                    doc.addImage(grayData, 'PNG', region.x, region.y, region.w, region.h, undefined, 'FAST');
                                    // Coleta todos os matches válidos com suas imagens
                                    type MatchEntry = { match: OcvMatch; ref: TemplateReferencia; imgB64: string; imgFormat: 'PNG' | 'JPEG' };
                                    const plantaMatches: MatchEntry[] = [];
                                    for (const ref of referenciasOCV) {
                                        setProgress(`Analisando isca: ${ref.nome_item}...`);
                                        const match = await matchTemplate(plantaFile, ref);
                                        if (match) {
                                            const imgData = await fetchBase64(ref.url_imagem_referencia).catch(() => null);
                                            if (imgData) plantaMatches.push({ match, ref, imgB64: imgData.data, imgFormat: imgData.format });
                                        }
                                    }
                                    if (plantaMatches.length > 0) {
                                        // Passa region (área real desenhada) para mapear coordenadas corretamente
                                        drawPlantaAnnotations(doc, region, plantaMatches);
                                    }
                                }
                            }
                        }

                        // Renderiza os outros slots normalmente
                        remainingLines = renderizarTextos(otherSlots, textMap, isCapa, fsMap, remainingLines);
                        pageIndex++;
                    } while (remainingLines && remainingLines.length > 0);
                }
            }

            // Libera a memória das URLs temporárias geradas localmente
            renderUrls.forEach(url => URL.revokeObjectURL(url));

            setProgress('Finalizando...');
            const blob = doc.output('blob');
            const nome = proposta
                ? `${proposta.nome.replace(/\s+/g, '_')}.pdf`
                : `Proposta_${mascara.nome.replace(/\s+/g, '_')}.pdf`;
            setPdfBlob(blob);
            setPdfName(nome);
            setProgress('');

        } catch (e: any) {
            setError(`Erro ao gerar PDF: ${e.message}`);
            setProgress('');
        } finally {
            setGenerating(false);
        }
    }

    // ── Render ────────────────────────────────────────────────────────────────

    if (loading) {
        return <div className="text-sm text-gray-400 py-10 text-center">Carregando...</div>;
    }

    if (!mascara) {
        return (
            <div className="max-w-4xl mx-auto">
                <div className="p-5 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-sm">
                    Nenhuma máscara cadastrada. Adicione uma na aba <strong>Templates</strong>.
                </div>
            </div>
        );
    }

    const paginasConfig = [...(mascara.paginas_config ?? [])].sort((a, b) => a.pagina - b.pagina);

    // Conta renders
    const rendersSalvos = proposta?.dados?.renders?.length ?? 0;
    const rendersNaPasta = (proposta?.dados?.pasta?.arquivos ?? [])
        .filter((f: string) => /^\d+\.(jpg|jpeg|png)$/i.test(f)).length;
    const renderCount = rendersSalvos > 0 ? rendersSalvos : rendersNaPasta;

    // Cálculo dinâmico do total de páginas considerando as repetições de projeto e planta
    let totalPages = 0;
    for (const p of paginasConfig) {
        const hasProjeto = p.slots?.some(s => {
            const def = slotDefaults[s.id];
            return def?.mode === 'script' && def?.scriptName === 'projeto';
        });
        const hasPlanta = p.slots?.some(s => {
            const def = slotDefaults[s.id];
            return def?.mode === 'script' && def?.scriptName === 'planta';
        });
        totalPages += hasProjeto ? (renderCount || 1) : hasPlanta ? 2 : 1;
    }

    return (
        <div className="max-w-4xl mx-auto">

            {/* Header */}
            <div className="mb-5 pl-1 flex items-start justify-between gap-3">
                <div>
                    <h1 className="text-xl font-bold text-gray-900 tracking-tight">Gerar PDF</h1>
                    <p className="text-sm text-gray-400 mt-0.5">
                        Máscara: <strong className="text-gray-600">{mascara.nome}</strong>
                        {proposta && <> · Proposta: <strong className="text-gray-600">{proposta.nome}</strong></>}
                        {!proposta && <span className="text-amber-500 ml-1">· Sem proposta (só fundos)</span>}
                    </p>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1">
                    <button
                        onClick={loadData}
                        disabled={loading}
                        className="flex items-center gap-1.5 text-xs text-gray-500 border border-gray-200 rounded px-3 py-1.5 hover:border-gray-400 hover:text-gray-700 disabled:opacity-40 transition-colors"
                    >
                        <span className={loading ? 'animate-spin inline-block' : ''}>⟳</span>
                        Recarregar
                    </button>
                    {proposta?.dados?.briefing && (
                        <span className={`text-[11px] font-mono ${proposta.dados.briefing.cliente ? 'text-emerald-600' : 'text-red-400'}`}>
                            {proposta.dados.briefing.cliente
                                ? `✓ ${proposta.dados.briefing.cliente}`
                                : '✗ cliente=null'
                            }
                        </span>
                    )}
                    {!proposta?.dados?.briefing && proposta && (
                        <span className="text-[11px] text-red-400 font-mono">✗ sem briefing</span>
                    )}
                </div>
            </div>

            {/* Erro */}
            {error && (
                <div className="mb-5 flex items-start justify-between gap-3 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
                    <span>{error}</span>
                    <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 shrink-0">✕</button>
                </div>
            )}

            {/* Info proposta */}
            {proposta && (
                <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 flex items-center gap-3">
                    <span className="text-2xl">📋</span>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-700 truncate">{proposta.nome}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                            {rendersSalvos > 0
                                ? <><span className="text-emerald-600 font-semibold">{rendersSalvos} render(s) anexados</span> · criada em {new Date(proposta.created_at).toLocaleDateString('pt-BR')}</>
                                : rendersNaPasta > 0
                                    ? <span className="text-amber-600 font-semibold">⚠ {rendersNaPasta} render(s) na pasta — ainda não salvos no projeto. Vá em Nova Proposta e clique <strong>Salvar Dados da Proposta</strong>.</span>
                                    : <span className="text-red-500">Sem renders — selecione a pasta na aba Nova Proposta</span>
                            }
                        </p>
                        {!proposta.dados?.briefing && (
                            <p className="text-xs text-red-500 mt-1">⚠ Sem briefing — textos não serão preenchidos. Verifique o PDF briefing na pasta.</p>
                        )}
                        {proposta.dados?.briefing && (
                            <p className="text-xs text-emerald-600 mt-1">
                                ✓ Briefing: {proposta.dados.briefing.cliente ?? '?'} · {proposta.dados.briefing.evento ?? '?'}
                            </p>
                        )}
                    </div>
                    {renderCount > 0 && (
                        <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded ${rendersSalvos > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                            {renderCount} render(s){rendersSalvos === 0 && ' ⚠'}
                        </span>
                    )}
                </div>
            )}

            {/* Estrutura */}
            <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
                <h2 className="text-sm font-bold text-gray-700 mb-3">
                    Estrutura — {totalPages} página(s)
                </h2>
                <div className="space-y-2">

                    {paginasConfig.map((p, i) => {
                        const bd = p.backdrop_id ? backdrops.find(b => b.id === p.backdrop_id) : null;
                        const hasProjeto = p.slots?.some(s => {
                            const def = slotDefaults[s.id];
                            return def?.mode === 'script' && def?.scriptName === 'projeto';
                        });
                        const hasPlanta = p.slots?.some(s => {
                            const def = slotDefaults[s.id];
                            return def?.mode === 'script' && def?.scriptName === 'planta';
                        });
                        const n = hasProjeto ? (renderCount || 1) : hasPlanta ? 2 : 1;

                        return (
                            <div key={i} className={`flex items-center gap-3 p-3 border rounded-lg ${hasProjeto ? 'border-blue-100 bg-blue-50/40' : hasPlanta ? 'border-green-100 bg-green-50/40' : 'border-gray-100 bg-gray-50/50'}`}>
                                <span className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${hasProjeto ? 'bg-blue-100 text-blue-600' : hasPlanta ? 'bg-green-100 text-green-600' : 'bg-orange-100 text-orange-600'}`}>
                                    {p.pagina}
                                </span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-700">
                                        {p.descricao || `Página ${p.pagina}`}
                                        {hasProjeto && n > 1 && <span className="ml-1.5 text-xs font-normal text-blue-600">(×{n} renders)</span>}
                                        {hasPlanta && <span className="ml-1.5 text-xs font-normal text-green-600">(original + análise)</span>}
                                    </p>
                                    <p className="text-[11px] text-gray-400">
                                        {p.slots?.filter(s => s.tipo === 'texto').length ?? 0} slot(s) texto
                                        {hasProjeto && ' + projeto'}
                                        {hasPlanta && ' + planta'}
                                    </p>
                                </div>
                                <span className={`text-[11px] px-2 py-0.5 rounded font-semibold shrink-0 ${bd ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-500'}`}>
                                    {bd ? `${bd.nome} · ${bd.tipo_arquivo}` : 'Sem fundo ⚠'}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Botão */}
            <div className="bg-white border border-gray-200 rounded-lg p-5">
                {needsPermission ? (
                    <div className="flex flex-col gap-2">
                        <p className="text-sm font-semibold text-amber-700">A pasta local precisa ser reconectada.</p>
                        <button
                            onClick={handleAllowFolder}
                            className="bg-amber-600 w-fit text-white px-6 py-2 rounded text-sm font-bold hover:bg-amber-700 transition-colors"
                        >
                            🔑 Conceder Acesso à Pasta
                        </button>
                    </div>
                ) : (
                    <>
                        <button
                            onClick={gerarPdf}
                            disabled={generating}
                            className="bg-orange-600 text-white px-10 py-3 rounded-lg text-sm font-bold hover:bg-orange-700 disabled:opacity-40 transition-colors flex items-center gap-2"
                        >
                            {generating
                                ? <><span className="animate-spin inline-block">⟳</span> {progress || 'Gerando...'}</>
                                : `⬇ Gerar PDF (${totalPages} pág.)`
                            }
                        </button>

                        <div className="mt-4 flex items-center gap-2 p-2 bg-magenta-50/10 border border-dashed border-gray-200 rounded-lg">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={debugMode}
                                    onChange={e => setDebugMode(e.target.checked)}
                                    className="w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                                />
                                <span className="text-xs font-semibold text-gray-600">
                                    Modo Debug (Mostrar Nomes e Áreas dos Slots)
                                </span>
                            </label>
                            <span className="text-[10px] text-gray-400">
                                — Use para verificar o posicionamento dos campos.
                            </span>
                        </div>

                        {!proposta && (
                            <p className="text-xs text-gray-400 mt-2">Sem proposta: gera apenas com os fundos.</p>
                        )}
                    </>
                )}
            </div>

            {pdfBlob && (
                <PdfActionModal blob={pdfBlob} fileName={pdfName} onClose={() => setPdfBlob(null)} />
            )}
        </div>
    );
}
