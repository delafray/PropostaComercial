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
import { supabase } from '../../../../services/supabaseClient';
import { SlotDefaults, prefKeyForMascara } from './ConfiguracaoPage';
import { registrarFontes, normalizarFamilia, renderTextoVetor, wrapTextoMm, carregarFonteVetor, preprocessarSvg, inlinearCssSvg, normalizarImagensSvg } from '../utils/fontLoader';

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

/**
 * Converte SVG para JPEG via canvas.
 * Elimina fontes externas embutidas pelo svg2pdf, tornando o PDF limpo para CorelDraw.
 */
async function rasterizarSvg(svgText: string, wMm: number, hMm: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const DPI = 200;
        const MM_TO_PX = DPI / 25.4;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(wMm * MM_TO_PX);
        canvas.height = Math.round(hMm * MM_TO_PX);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const img = new Image();
        const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        img.onload = () => {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/jpeg', 0.92).split(',')[1]);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Falha ao rasterizar SVG do backdrop')); };
        img.src = url;
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
        try {
            // Preprocessa o SVG (remove @font-face e font-family) → svg2pdf vetorial puro, sem fontes externas
            const svgLimpo = preprocessarSvg(svgText);
            const parser = new DOMParser();
            const svgEl = parser.parseFromString(svgLimpo, 'image/svg+xml').documentElement;
            await svg2pdf(svgEl, doc, { x: 0, y: 0, width: W, height: H });
        } catch {
            // Fallback: rasteriza para JPEG se o svg2pdf falhar
            try {
                const jpegB64 = await rasterizarSvg(svgText, W, H);
                doc.addImage(jpegB64, 'JPEG', 0, 0, W, H);
            } catch {
                // Último recurso: svg2pdf sem preprocessing
                const parser = new DOMParser();
                const svgEl = parser.parseFromString(svgText, 'image/svg+xml').documentElement;
                await svg2pdf(svgEl, doc, { x: 0, y: 0, width: W, height: H });
            }
        }
    } else {
        const { data, format } = await fetchBase64(backdrop.url_imagem);
        doc.addImage(data, format, 0, 0, W, H);
    }
}

function hexToRgb(hex: string): [number, number, number] {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex ?? '#000000');
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

/** Extrai do memorial a seção pelo título (case-insensitive).
 *  Retorna só as linhas de itens (com TAB), sem o título e sem o próximo título. */
function extrairSecaoMemorial(memorial: string, titulo: string): string {
    const lines = memorial.split('\n').map(l => l.trim()).filter(Boolean);
    const idx = lines.findIndex(l => !l.includes('\t') && l.toLowerCase().includes(titulo.toLowerCase()));
    if (idx === -1) return '';
    const items: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
        if (!lines[i].includes('\t')) break;
        items.push(lines[i]);
    }
    return items.join('\n');
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

/**
 * Script imagem_estande: carrega o PNG de altura do estande, cropa transparência
 * topo/base, detecta borda esquerda do conteúdo visível e desenha cota arquitetural.
 */
async function renderImagemEstande(
    doc: jsPDF,
    slot: SlotElemento,
    file: File,
    tamanhoText: string,
): Promise<void> {
    // 1. Carrega o PNG em canvas para ler pixels
    const originalCanvas = await new Promise<HTMLCanvasElement>((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            c.getContext('2d')!.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            resolve(c);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Falha ao carregar imagem do estande')); };
        img.src = url;
    });

    const ctx = originalCanvas.getContext('2d')!;
    const W = originalCanvas.width;
    const H = originalCanvas.height;
    const px = ctx.getImageData(0, 0, W, H).data;

    function rowHasContent(y: number): boolean {
        for (let x = 0; x < W; x++) {
            if (px[(y * W + x) * 4 + 3] > 10) return true;
        }
        return false;
    }

    function colHasContent(x: number): boolean {
        for (let y = 0; y < H; y++) {
            if (px[(y * W + x) * 4 + 3] > 10) return true;
        }
        return false;
    }

    // 2. Detecta crop vertical (topo/base)
    let topRow = 0;
    while (topRow < H - 1 && !rowHasContent(topRow)) topRow++;
    let bottomRow = H - 1;
    while (bottomRow > topRow && !rowHasContent(bottomRow)) bottomRow--;

    const croppedH = bottomRow - topRow + 1;

    // 3. Detecta borda esquerda do conteúdo visível (para posicionar a cota)
    let leftCol = 0;
    while (leftCol < W - 1 && !colHasContent(leftCol)) leftCol++;

    // 4. Cria canvas cropado verticalmente (largura mantida)
    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = W;
    croppedCanvas.height = croppedH;
    croppedCanvas.getContext('2d')!.drawImage(originalCanvas, 0, topRow, W, croppedH, 0, 0, W, croppedH);
    const croppedB64 = croppedCanvas.toDataURL('image/png').split(',')[1];

    // 5. Posiciona imagem no slot (contain, sem distorção)
    const imgRegion = containInSlot(slot, W, croppedH);
    doc.addImage(croppedB64, 'PNG', imgRegion.x, imgRegion.y, imgRegion.w, imgRegion.h, undefined, 'FAST');

    // 6. Desenha cota arquitetural
    if (!tamanhoText) return;

    // Mapeia leftCol para mm dentro da região da imagem colocada
    const leftContentX_mm = imgRegion.x + (leftCol / W) * imgRegion.w;

    const COTA_OFFSET_MM = 4;   // distância da cota à borda visível da imagem (mm)
    const TICK_LEFT_MM   = 1.5; // comprimento do traço à esquerda da linha (mm)
    const TICK_RIGHT_MM  = 5;   // comprimento do traço à direita da linha, em direção à imagem (mm)

    const cotaX      = leftContentX_mm - COTA_OFFSET_MM;
    const cotaTop    = imgRegion.y;
    const cotaBottom = imgRegion.y + imgRegion.h;

    doc.setDrawColor(0, 174, 239);
    doc.setLineWidth(0.3);

    // Linha vertical
    doc.line(cotaX, cotaTop, cotaX, cotaBottom);
    // Traço horizontal superior (mais longo para a direita)
    doc.line(cotaX - TICK_LEFT_MM, cotaTop, cotaX + TICK_RIGHT_MM, cotaTop);
    // Traço horizontal inferior (mais longo para a direita)
    doc.line(cotaX - TICK_LEFT_MM, cotaBottom, cotaX + TICK_RIGHT_MM, cotaBottom);

    // Texto rotacionado 90° como vetor puro (sem texto real no PDF → compatível com CorelDraw)
    const PT_MM = 25.4 / 72;
    const textX = cotaX - 5 * PT_MM; // = cotaX - 5pt (~1.8mm à esquerda da linha)
    // Correção vertical: baseline da fonte fica acima do centro visual → empurra +1mm para baixo
    const textY = (cotaTop + cotaBottom) / 2 + 1;
    await renderTextoVetor(doc, tamanhoText, textX, textY, 'helvetica', 'bold', 9, [0, 174, 239], 'center', 90);
}

/** Remove todos os elementos <image> do SVG via DOM (para a camada vetorial — imagens já estão no raster de baixo). */
function svgSemImageElements(svgText: string): string {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgEl = xmlDoc.documentElement;
    if (svgEl.querySelector('parsererror')) return svgText;
    const imgs = Array.from(svgEl.querySelectorAll('image'));
    if (!imgs.length) return svgText;
    for (const img of imgs) img.remove();
    return new XMLSerializer().serializeToString(svgEl);
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

async function drawPlantaAnnotations(
    doc: jsPDF,
    drawRegion: { x: number; y: number; w: number; h: number }, // área real da planta no PDF
    matches: Array<{ match: OcvMatch; ref: TemplateReferencia; imgB64: string; imgFormat: 'PNG' | 'JPEG' }>
) {
    const placed: PlacedBox[] = [];
    const ANGLES = [-Math.PI / 2, -Math.PI / 4, 0, Math.PI / 4, Math.PI / 2, Math.PI * 3 / 4, Math.PI, -Math.PI * 3 / 4];

    for (const { match, ref, imgB64, imgFormat } of matches) {
        const cx = drawRegion.x + match.cx_ratio * drawRegion.w;
        const cy = drawRegion.y + match.cy_ratio * drawRegion.h;
        const mw = Math.max(3, match.w_ratio * drawRegion.w);
        const mh = Math.max(3, match.h_ratio * drawRegion.h);

        // Overlay da isca (colorida)
        const asp = match.img_aspect;
        let dispW = mw, dispH = mh;
        if (mw / Math.max(mh, 0.001) > asp) {
            dispW = mh * asp;
        } else {
            dispH = mw / Math.max(asp, 0.001);
        }
        doc.addImage(imgB64, imgFormat, cx - dispW / 2, cy - dispH / 2, dispW, dispH, undefined, 'FAST');

        const [br, bg, bb] = hexToRgb(ref.cor_holograma ?? '#d22323');
        doc.setDrawColor(br, bg, bb);
        doc.setLineWidth(0.4);
        doc.rect(cx - dispW / 2, cy - dispH / 2, dispW, dispH, 'S');

        // Calcula largura do label usando métricas do jsPDF (apenas para posicionamento)
        doc.setFontSize(6);
        doc.setFont('helvetica', 'bold');
        const LABEL_W = Math.min(doc.getTextWidth(ref.nome_item.toUpperCase()) + 3, 40);
        const LABEL_H = 4.5;
        const DIST = Math.max(dispW, dispH) / 2 + 4;

        // Posição do label: testa 8 ângulos
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

        // Seta e caixa do label
        doc.setDrawColor(br, bg, bb);
        doc.setLineWidth(0.35);
        doc.line(lx + LABEL_W / 2, ly + LABEL_H / 2, cx, cy);
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(br, bg, bb);
        doc.setLineWidth(0.25);
        doc.rect(lx, ly, LABEL_W, LABEL_H, 'FD');

        // Texto do label como vetor
        const labelY = ly + LABEL_H - 1.3;
        const ok = await renderTextoVetor(doc, ref.nome_item.toUpperCase(), lx + 1.5, labelY, 'helvetica', 'bold', 6, [br, bg, bb]);
        if (!ok) {
            doc.setFontSize(6);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(br, bg, bb);
            doc.text(ref.nome_item.toUpperCase(), lx + 1.5, labelY);
        }
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

            setProgress('Carregando fontes...');
            await registrarFontes(doc);

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

            // Busca campo projetista do usuário logado (para script 'projetista')
            let nomeProjetista = '';
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (user) {
                    const { data: userRow, error: userErr } = await supabase
                        .from('users')
                        .select('projetista')
                        .eq('id', user.id)
                        .maybeSingle();
                    if (userErr) console.error('[projetista] erro Supabase:', userErr);
                    nomeProjetista = userRow?.projetista ?? '';
                }
            } catch (e) { console.error('[projetista] exceção:', e); }

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
                        } else if (slotDef?.scriptName === 'altura_estande') {
                            map[slot.nome] = proposta?.dados?.pasta?.tamanhoEstande ?? '';
                        } else if (slotDef?.scriptName === 'projetista') {
                            map[slot.nome] = nomeProjetista;
                        } else if (slotDef?.scriptName === 'pv_texto') {
                            map[slot.nome] = extrairSecaoMemorial(proposta?.dados?.memorial ?? '', 'impressão digital');
                        } else if (slotDef?.scriptName === 'eletrica') {
                            map[slot.nome] = extrairSecaoMemorial(proposta?.dados?.memorial ?? '', 'elétrica');
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

            async function renderDescritivo01(doc: jsPDF, lines: string[], slot: SlotElemento, fontSizeMap: Record<string, number> = {}): Promise<string[]> {
                const configColor = slotDefaults[slot.id]?.color;
                const [r, g, b] = hexToRgb(configColor ?? slot.color ?? '#000000');

                // Paleta de acento para títulos de categoria — cicla entre cores harmônicas
                const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
                // Cor suave para coluna de ID: clareada se texto escuro, escurecida se texto claro
                const idColor: [number, number, number] = luminance < 128
                    ? [Math.round(r + (255 - r) * 0.45), Math.round(g + (255 - g) * 0.45), Math.round(b + (255 - b) * 0.45)]
                    : [Math.round(r * 0.55), Math.round(g * 0.55), Math.round(b * 0.55)];
                const accentPalette: Array<[number, number, number]> = luminance < 128
                    ? [ // texto escuro → acentos ricos/densos
                        [29,  78, 216],  // blue-700
                        [21, 128,  61],  // green-700
                        [185, 28,  28],  // red-700
                        [180, 83,   9],  // amber-700
                        [15, 118, 110],  // teal-700
                    ]
                    : [ // texto claro → acentos suaves/pastel
                        [147, 197, 253], // blue-300
                        [134, 239, 172], // green-300
                        [252, 165, 165], // red-300
                        [252, 211,  77], // amber-300
                        [103, 232, 249], // cyan-300
                    ];
                let categoryIndex = 0;

                const defaultSize = fontSizeMap[slot.id] ?? slotDefaults[slot.id]?.fontSize ?? slot.font_size ?? 10;
                const configFontFamily = normalizarFamilia(slotDefaults[slot.id]?.fontFamily);

                let currentY = slot.y_mm;
                const lineHeight = defaultSize * 0.35;
                const lineSpacing = 0.1;
                const maxY = slot.y_mm + slot.h_mm;

                // Carrega fonte para word-wrap da coluna de descrição
                const fontVetor = await carregarFonteVetor(configFontFamily, 'normal');
                const sizeMmNormal = (defaultSize - 1) * (25.4 / 72);
                const gap6pt = 6 * (25.4 / 72);
                const X_START = slot.x_mm;

                // Pré-passo: mede largura máxima de cada coluna curta nos dados reais
                let maxW0 = 0, maxW1 = 0, maxW2 = 0;
                if (fontVetor) {
                    for (const line of lines) {
                        if (!line.includes('\t')) continue;
                        let ps = line.split('\t').map(p => p.trim());
                        if (ps.length === 3 || (ps.length > 1 && !ps[0].includes('.') && !isNaN(Number(ps[0].replace(',', '.'))))) {
                            ps = ['', ps[0], ps[1], ps.slice(2).join(' ')];
                        }
                        if (ps[0]) maxW0 = Math.max(maxW0, fontVetor.getAdvanceWidth(ps[0], sizeMmNormal));
                        if (ps[1]) maxW1 = Math.max(maxW1, fontVetor.getAdvanceWidth(ps[1], sizeMmNormal));
                        if (ps[2]) maxW2 = Math.max(maxW2, fontVetor.getAdvanceWidth(ps[2], sizeMmNormal));
                    }
                }

                const gap9pt = 9 * (25.4 / 72);
                const COL_QTD  = X_START + (maxW0 > 0 ? maxW0 + gap9pt : 0); // 9pt após ID
                const COL_UNID = COL_QTD  + (maxW1 > 0 ? maxW1 + gap6pt : 0);
                const COL_DESC = COL_UNID + (maxW2 > 0 ? maxW2 + gap6pt : 0);
                const maxDescW = slot.x_mm + slot.w_mm - COL_DESC - 1;

                async function drawCol(text: string, x: number, y: number, style: 'normal' | 'bold', size: number, color: [number, number, number] = [r, g, b]) {
                    const ok = await renderTextoVetor(doc, text, x, y, configFontFamily, style, size, color);
                    if (!ok) {
                        doc.setFontSize(size);
                        doc.setFont(configFontFamily, style);
                        doc.setTextColor(color[0], color[1], color[2]);
                        doc.text(text, x, y);
                    }
                }

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (currentY > maxY - lineHeight) {
                        return lines.slice(i);
                    }

                    if (line.includes('\t')) {
                        let parts = line.split('\t').map(p => p.trim());
                        if (parts.length === 3 || (parts.length > 1 && !parts[0].includes('.') && isNaN(Number(parts[0].replace(',', '.'))) === false)) {
                            parts = ['', parts[0], parts[1], parts.slice(2).join(' ')];
                        }

                        const lineY = currentY + lineHeight;
                        if (parts[0]) await drawCol(parts[0], X_START, lineY, 'normal', defaultSize - 1, idColor);
                        if (parts[1]) await drawCol(parts[1], COL_QTD,  lineY, 'normal', defaultSize - 1);
                        if (parts[2]) await drawCol(parts[2], COL_UNID, lineY, 'normal', defaultSize - 1);

                        const descText = parts.slice(3).join('   ');
                        if (descText) {
                            // Word-wrap com métricas reais da fonte
                            const descLines = fontVetor
                                ? wrapTextoMm(fontVetor, descText, maxDescW, sizeMmNormal)
                                : [descText];
                            for (let dl = 0; dl < descLines.length; dl++) {
                                const descY = lineY + dl * (lineHeight + lineSpacing);
                                // dl === 0: sempre renderiza junto com ID/QTD/UNID (já desenhados sem checagem)
                                if (dl > 0 && descY > maxY - lineHeight) break;
                                await drawCol(descLines[dl], COL_DESC, descY, 'normal', defaultSize - 1);
                            }
                            // Avança pelo número de linhas da descrição
                            currentY += (descLines.length - 1) * (lineHeight + lineSpacing);
                        }

                        currentY += lineHeight + lineSpacing;

                    } else {
                        // Categoria (bold) — cor ciclada da paleta de acento
                        if (currentY > slot.y_mm) currentY += (lineHeight * 0.4);
                        if (currentY > maxY - lineHeight) break;

                        const titleColor = accentPalette[categoryIndex % accentPalette.length];
                        categoryIndex++;
                        await drawCol(line, COL_DESC, currentY + lineHeight, 'bold', defaultSize, titleColor);
                        currentY += lineHeight + lineSpacing;
                    }
                }

                return [];
            }

            // ── Função genérica para scripts de seção do memorial ─────────────

            // numCols = quantas colunas "curtas" antes da descrição
            // pv_texto: 3 (ID, qty, unit) | eletrica: 2 (qty, unit)
            async function renderSecaoTexto(doc: jsPDF, text: string, slot: SlotElemento, titulo: string, numCols: number = 2): Promise<void> {
                if (!text) return;
                const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean);
                const partLines = rawLines.map(l => l.split('\t').map(p => p.trim()).filter(Boolean));

                const configColor = slotDefaults[slot.id]?.color;
                const [r, g, b] = hexToRgb(configColor ?? slot.color ?? '#000000');
                const configFontFamily = normalizarFamilia(slotDefaults[slot.id]?.fontFamily);
                const lineSpacing = 0.1;
                const itemGap = 0.7;
                const startSize: number = slotDefaults[slot.id]?.fontSize ?? 7;
                const minSize = 5;
                const gap3pt = 3 * (25.4 / 72);

                const fontVetor = await carregarFonteVetor(configFontFamily, 'normal');

                // Calcula posições X das colunas curtas para um dado sizeMm
                function computeColX(sizeMm: number): number[] {
                    const cx: number[] = [slot.x_mm];
                    if (fontVetor) {
                        for (let c = 0; c < numCols; c++) {
                            const maxW = Math.max(0, ...partLines.map(p =>
                                p[c] ? fontVetor!.getAdvanceWidth(p[c], sizeMm) : 0
                            ));
                            cx.push(cx[c] + maxW + gap3pt);
                        }
                    } else {
                        const colW = (slot.w_mm * 0.5) / numCols;
                        for (let c = 0; c < numCols; c++) cx.push(cx[c] + colW);
                    }
                    return cx;
                }

                // Auto-shrink: usa largura real da coluna de descrição para wrap preciso
                let finalSize = minSize;
                for (let sz = startSize; sz >= minSize; sz -= 0.5) {
                    const lineH = sz * 0.35;
                    const sizeMm = sz * (25.4 / 72);
                    const cx = computeColX(sizeMm);
                    const descX = cx[numCols] ?? slot.x_mm;
                    const descMaxW = slot.x_mm + slot.w_mm - descX - 1;
                    let totalLines = 1; // título
                    for (const parts of partLines) {
                        const descText = parts.slice(numCols).filter(Boolean).join('  ');
                        totalLines += (descText && fontVetor && descMaxW > 0)
                            ? wrapTextoMm(fontVetor, descText, descMaxW, sizeMm).length
                            : 1;
                    }
                    const totalHeight = totalLines * (lineH + lineSpacing)
                        + itemGap
                        + (partLines.length - 1) * itemGap;
                    finalSize = sz;
                    if (totalHeight <= slot.h_mm) break;
                }

                const lineH = finalSize * 0.35;
                const sizeMm = finalSize * (25.4 / 72);
                const colX = computeColX(sizeMm);
                const descX = colX[numCols] ?? slot.x_mm;
                const descMaxW = slot.x_mm + slot.w_mm - descX - 1;

                let y = slot.y_mm;

                // Título em negrito
                const titleY = y + lineH;
                if (titleY <= slot.y_mm + slot.h_mm) {
                    const okT = await renderTextoVetor(doc, titulo, slot.x_mm, titleY, configFontFamily, 'bold', finalSize, [r, g, b]);
                    if (!okT) {
                        doc.setFontSize(finalSize); doc.setFont(configFontFamily, 'bold');
                        doc.setTextColor(r, g, b); doc.text(titulo, slot.x_mm, titleY);
                    }
                    y += lineH + lineSpacing + itemGap;
                }

                async function renderCampo(txt: string, x: number, yLine: number) {
                    const ok = await renderTextoVetor(doc, txt, x, yLine, configFontFamily, 'normal', finalSize, [r, g, b]);
                    if (!ok) {
                        doc.setFontSize(finalSize); doc.setFont(configFontFamily, 'normal');
                        doc.setTextColor(r, g, b); doc.text(txt, x, yLine);
                    }
                }

                for (let i = 0; i < partLines.length; i++) {
                    const parts = partLines[i];
                    const lineY = y + lineH;
                    if (lineY > slot.y_mm + slot.h_mm) return;

                    // Colunas curtas — cada campo como path separado na posição calculada
                    for (let c = 0; c < numCols && c < parts.length; c++) {
                        if (parts[c]) await renderCampo(parts[c], colX[c], lineY);
                    }

                    // Descrição: une os campos restantes, quebra na largura disponível,
                    // cada linha de quebra fica alinhada em descX
                    const descText = parts.slice(numCols).filter(Boolean).join('  ');
                    if (descText) {
                        const descWrapped = (fontVetor && descMaxW > 0)
                            ? wrapTextoMm(fontVetor, descText, descMaxW, sizeMm)
                            : [descText];
                        for (let dl = 0; dl < descWrapped.length; dl++) {
                            const wlineY = lineY + dl * (lineH + lineSpacing);
                            if (wlineY > slot.y_mm + slot.h_mm) break;
                            await renderCampo(descWrapped[dl], descX, wlineY);
                        }
                        // Avança Y pelo número real de linhas da descrição
                        y += Math.max(1, descWrapped.length) * (lineH + lineSpacing);
                    } else {
                        y += lineH + lineSpacing;
                    }

                    if (i < partLines.length - 1) y += itemGap;
                }
            }

            async function renderPvTexto(doc: jsPDF, text: string, slot: SlotElemento): Promise<void> {
                await renderSecaoTexto(doc, text, slot, 'Programação Visual', 3);
            }

            async function renderEletrica(doc: jsPDF, text: string, slot: SlotElemento): Promise<void> {
                await renderSecaoTexto(doc, text, slot, 'Elétrica', 2);
            }

            // ── Renderizar textos ─────────────────────────────────────────────

            async function renderizarTextos(
                slots: SlotElemento[],
                nameToValue: Record<string, string>,
                isCapa = false,
                fontSizeMap: Record<string, number> = {},
                linesOverride?: string[]
            ): Promise<string[]> {
                let leftOvers: string[] = [];

                for (const slot of slots) {
                    const text = nameToValue[slot.nome] ?? '';
                    const slotDef = slotDefaults[slot.id];

                    if (linesOverride && slotDef?.scriptName !== '01') continue;
                    if (!text && !linesOverride) continue;

                    if (slotDef?.scriptName === '01') {
                        const linesToRender = linesOverride ?? text.split('\n').map(l => l.trim()).filter(Boolean);
                        leftOvers = await renderDescritivo01(doc, linesToRender, slot, fontSizeMap);
                        continue;
                    }

                    if (slotDef?.scriptName === 'pv_texto') {
                        await renderPvTexto(doc, text, slot);
                        continue;
                    }

                    if (slotDef?.scriptName === 'eletrica') {
                        await renderEletrica(doc, text, slot);
                        continue;
                    }

                    if (!text) continue;

                    const configColor = slotDefaults[slot.id]?.color;
                    const [r, g, b] = hexToRgb(configColor ?? slot.color ?? '#000000');

                    let finalSize = fontSizeMap[slot.id] ?? slotDefaults[slot.id]?.fontSize ?? slot.font_size ?? 10;
                    if (isCapa && !fontSizeMap[slot.id] && !slotDefaults[slot.id]?.fontSize) {
                        finalSize += 8;
                    } else if (slot.nome.startsWith('footer_') && !fontSizeMap[slot.id] && !slotDefaults[slot.id]?.fontSize) {
                        finalSize = 10;
                    }

                    const configFontFamily = normalizarFamilia(slotDefaults[slot.id]?.fontFamily);
                    const configFontStyle = slotDefaults[slot.id]?.fontStyle ?? slot.font_style ?? 'normal';
                    const jsPdfStyle = configFontStyle === 'bold' ? 'bold' : configFontStyle === 'italic' ? 'italic' : 'normal';

                    const align = (slotDefaults[slot.id]?.align ?? slot.align ?? 'left') as 'left' | 'center' | 'right';
                    const x = align === 'center' ? slot.x_mm + slot.w_mm / 2
                        : align === 'right' ? slot.x_mm + slot.w_mm
                            : slot.x_mm;
                    const y = slot.y_mm + slot.h_mm * 0.75;

                    // Renderiza como vetor; fallback para doc.text se necessário
                    const ok = await renderTextoVetor(doc, text, x, y, configFontFamily, configFontStyle, finalSize, [r, g, b], align);
                    if (!ok) {
                        doc.setTextColor(r, g, b);
                        doc.setFontSize(finalSize);
                        doc.setFont(configFontFamily, jsPdfStyle);
                        doc.text(text, x, y, { align });
                    }

                    // Modo debug
                    if (debugMode) {
                        doc.setDrawColor(255, 0, 255);
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

                // Detecta o slot configurado com o script 'imagem_estande'
                const imagemEstandeSlot = (cfgPagina.slots ?? []).find(s => {
                    const def = slotDefaults[s.id];
                    return def?.mode === 'script' && def?.scriptName === 'imagem_estande';
                });

                // Detecta o slot configurado com o script 'programacao_visual'
                const pvSlot = (cfgPagina.slots ?? []).find(s => {
                    const def = slotDefaults[s.id];
                    return def?.mode === 'script' && def?.scriptName === 'programacao_visual';
                });

                // Constrói mapa slotId → renderUrl para o script programacao_visual
                // O pvSlot âncora; slots vazios de tamanho similar na mesma página recebem renders subsequentes
                const pvMap = new Map<string, string>();
                const pvClaimedIds = new Set<string>();
                if (pvSlot && renderUrls.length > 0) {
                    const TOL = 10; // mm — tolerância de dimensão
                    const similarEmpty = (cfgPagina.slots ?? []).filter(s => {
                        if (s.id === pvSlot.id) return false;
                        const def = slotDefaults[s.id];
                        const isEmpty = !def || (def.mode !== 'script' && (!def.value));
                        return isEmpty
                            && Math.abs(s.w_mm - pvSlot.w_mm) <= TOL
                            && Math.abs(s.h_mm - pvSlot.h_mm) <= TOL;
                    });
                    const allPv = [pvSlot, ...similarEmpty]
                        .sort((a, b) => a.y_mm !== b.y_mm ? a.y_mm - b.y_mm : a.x_mm - b.x_mm);
                    allPv.forEach((s, i) => {
                        if (i < renderUrls.length) {
                            pvMap.set(s.id, renderUrls[i]);
                            pvClaimedIds.add(s.id);
                        }
                    });
                }

                // Todos os outros slots (exceto projeto, planta, imagem_estande e programacao_visual)
                const otherSlots = (cfgPagina.slots ?? []).filter(s =>
                    s !== projetoSlot && s !== plantaSlot && s !== imagemEstandeSlot && !pvClaimedIds.has(s.id)
                );

                // Repete 1× por render (projeto), 2× (planta: original + anotada se há refs OCV), ou 1× normal
                const timesToRepeat = projetoSlot
                    ? Math.max(renderUrls.length, 1)
                    : plantaSlot ? (referenciasOCV.length > 0 ? 2 : 1) : 1;

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

                                        // Calcula região de contain pelo viewBox (mais preciso que pixel size para SVGs)
                                        const parserTmp = new DOMParser();
                                        const svgElTmp = parserTmp.parseFromString(svgText, 'image/svg+xml').documentElement;
                                        const vb = svgElTmp.getAttribute('viewBox');
                                        let svgRegion = region;
                                        if (vb) {
                                            const parts = vb.split(/[\s,]+/).map(parseFloat);
                                            if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
                                                svgRegion = containInSlot(plantaSlot, parts[2], parts[3]);
                                            }
                                        }

                                        // Camada 1 (baixo): rasteriza o SVG completo → JPEG
                                        // (canvas renderiza tudo, inclusive imagens embutidas)
                                        const jpgRaster = await rasterizarSvg(svgText, svgRegion.w, svgRegion.h);
                                        doc.addImage(jpgRaster, 'JPEG', svgRegion.x, svgRegion.y, svgRegion.w, svgRegion.h, undefined, 'FAST');

                                        // Camada 2 (cima): SVG vetorial sem <image> por cima
                                        // (imagens já estão no raster de baixo; aqui ficam só vetores nítidos)
                                        const svgVetorial = preprocessarSvg(normalizarImagensSvg(inlinearCssSvg(svgSemImageElements(svgText))));
                                        const svgEl = parserTmp.parseFromString(svgVetorial, 'image/svg+xml').documentElement;
                                        try {
                                            await svg2pdf(svgEl, doc, { x: svgRegion.x, y: svgRegion.y, width: svgRegion.w, height: svgRegion.h });
                                        } catch {
                                            // svg2pdf falhou — raster já cobre o conteúdo
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
                                        await drawPlantaAnnotations(doc, region, plantaMatches);
                                    }
                                }
                            }
                        }

                        // Insere imagem do estande com cota arquitetural
                        if (imagemEstandeSlot) {
                            const arquivoEstande = arquivosLocais.find(f => /\d+[,.]\d+m/i.test(f.name));
                            if (arquivoEstande && /\.png$/i.test(arquivoEstande.name)) {
                                const tamanho = proposta?.dados?.pasta?.tamanhoEstande ?? '';
                                try {
                                    await renderImagemEstande(doc, imagemEstandeSlot, arquivoEstande, tamanho);
                                } catch (e) {
                                    console.warn('[imagem_estande] Falha ao renderizar:', e);
                                }
                            }
                        }

                        // Insere imagens do script programacao_visual
                        for (const [slotId, url] of pvMap.entries()) {
                            const pvS = (cfgPagina.slots ?? []).find(s => s.id === slotId);
                            if (!pvS) continue;
                            try {
                                const { data, format } = await fetchBase64(url);
                                doc.addImage(data, format, pvS.x_mm, pvS.y_mm, pvS.w_mm, pvS.h_mm, undefined, 'FAST');
                            } catch (e) {
                                console.warn('[programacao_visual] Falha ao renderizar slot:', slotId, e);
                            }
                        }

                        // Renderiza os outros slots normalmente
                        remainingLines = await renderizarTextos(otherSlots, textMap, isCapa, fsMap, remainingLines);
                        pageIndex++;
                    } while (remainingLines && remainingLines.length > 0);
                }
            }

            // Libera a memória das URLs temporárias geradas localmente
            renderUrls.forEach(url => URL.revokeObjectURL(url));

            setProgress('Finalizando...');
            const blob = doc.output('blob');
            const b = proposta?.dados?.briefing;
            const nomeCliente = (b?.cliente ?? '').trim();
            const nomeEvento  = (b?.evento ?? '').trim();
            const numero      = (b?.numero ?? '').trim();
            const partes = [nomeCliente, nomeEvento, numero].filter(Boolean);
            const nome = partes.length > 0
                ? `${partes.join(' - ')}.pdf`
                : proposta
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
