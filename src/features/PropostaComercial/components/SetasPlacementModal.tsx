// !! REGRA N1: JAMAIS apague/mova arquivos fora de C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\ — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.
// @ts-nocheck
import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Worker via CDN — mesmo padrão de mascaraParser.ts (bug conhecido, não alterar)
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// A4 landscape em mm
const PAGE_W_MM = 297;
const PAGE_H_MM = 210;

// Proporções extraídas do seta.svg do usuário (CorelDRAW)
const TOTAL_L = 20.89;
const TOTAL_W = 13.75;
const BODY_L  = 12.6;
const HEAD_D  = 8.29;
const WING    = 2.66;
const BODY_W  = 8.43;
const TIP     = TOTAL_W / 2;
const ARROW_COLOR = '#A8518A';

const LETTERS_ALL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
// range padrão: A→D, 1→3  (controlado por estado no componente)
type Direction  = 'right' | 'left' | 'up' | 'down';
const DIR_LABEL: Record<Direction, string> = { right:'→', left:'←', up:'↑', down:'↓' };
const DIR_ORDER: Direction[] = ['right','left','up','down'];

export interface PlacedArrowResult {
    code: string;
    direction: Direction;
    x: number;  // mm
    y: number;
    w: number;
    h: number;
    fontSizePt: number;
}

interface PlacedArrow {
    id: string;
    code: string;
    direction: Direction;
    cx: number; // centro em px no canvas
    cy: number;
}

interface Props {
    pdfBlob: Blob;
    pageNumber: number;
    onConfirm: (arrows: PlacedArrowResult[]) => void;
    onCancel: () => void;
    storageKey?: string;
    fileNameHint?: string; // ex: "Art Guide - Cliente - Evento - Numero"
}

interface SavedSetasState {
    arrows: PlacedArrowResult[];
    arrowSizeMm: number;
    fontSizePt: number;
}

export function generateArrowSvg(code: string, direction: Direction, fontSizePt = 18): string {
    const isH = direction === 'left' || direction === 'right';
    const vw = isH ? TOTAL_L : TOTAL_W;
    const vh = isH ? TOTAL_W : TOTAL_L;
    let pathD: string;
    let tx: number, ty: number, rot = '';

    if (direction === 'right') {
        pathD = `M0,${WING} L${BODY_L},${WING} L${BODY_L},0 L${TOTAL_L},${TIP} L${BODY_L},${TOTAL_W} L${BODY_L},${WING+BODY_W} L0,${WING+BODY_W} Z`;
        tx = BODY_L / 2 + 1.5; ty = TIP; // leve offset em direção à ponta (frente)
    } else if (direction === 'left') {
        pathD = `M${TOTAL_L},${WING} L${HEAD_D},${WING} L${HEAD_D},0 L0,${TIP} L${HEAD_D},${TOTAL_W} L${HEAD_D},${WING+BODY_W} L${TOTAL_L},${WING+BODY_W} Z`;
        tx = HEAD_D + BODY_L / 2 - 1.5; ty = TIP; // leve offset em direção à ponta (frente)
    } else if (direction === 'down') {
        pathD = `M${WING},0 L${WING},${BODY_L} L0,${BODY_L} L${TIP},${TOTAL_L} L${TOTAL_W},${BODY_L} L${WING+BODY_W},${BODY_L} L${WING+BODY_W},0 Z`;
        tx = TIP; ty = BODY_L / 2 + 1.5; // leve offset em direção à ponta (frente)
        rot = `rotate(90,${tx},${ty})`;
    } else {
        pathD = `M${WING+BODY_W},${TOTAL_L} L${WING+BODY_W},${HEAD_D} L${TOTAL_W},${HEAD_D} L${TIP},0 L0,${HEAD_D} L${WING},${HEAD_D} L${WING},${TOTAL_L} Z`;
        tx = TIP; ty = HEAD_D + BODY_L / 2 - 1.5; // leve offset em direção à ponta (frente)
        rot = `rotate(-90,${tx},${ty})`;
    }

    const fsNum = (fontSizePt / 18) * BODY_W * 0.85;
    const fs = fsNum.toFixed(2);
    // Impede que o texto saia pelo lado traseiro — overflow só pela frente (ponta)
    const ls = 0.4; // letter-spacing aplicado no SVG
    const halfW = code.length * fsNum * 0.31 + (code.length - 1) * ls / 2;
    const bm = 0.8; // back-margin em unidades viewBox (só horizontal)
    // UP/DOWN: centralizado no corpo — overflow insignificante (~0.36u) clipado pelo SVG
    if (direction === 'right')     tx = Math.max(tx, halfW + bm);
    else if (direction === 'left') tx = Math.min(tx, TOTAL_L - halfW - bm);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}">
<path d="${pathD}" fill="${ARROW_COLOR}"/>
<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif" font-weight="bold" font-size="${fs}" fill="#E6E6E6" letter-spacing="0.4"${rot ? ` transform="${rot}"` : ''}>${code}</text>
</svg>`;
}

function svgToDataUrl(svg: string): string {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/**
 * Desenha uma seta diretamente como vetorial no jsPDF.
 * Sem rasterização — sem fundo branco. Usa polígono + text() do jsPDF.
 * @param doc  instância jsPDF (any para não criar dependência de tipo)
 */
export function drawArrowToDoc(doc: any, arrow: PlacedArrowResult): void {
    const { x, y, w, h, direction, code, fontSizePt } = arrow;

    const isH = direction === 'left' || direction === 'right';
    // Para horizontal: viewBox = TOTAL_L × TOTAL_W; vertical: TOTAL_W × TOTAL_L
    const sx = w / (isH ? TOTAL_L : TOTAL_W); // mm por unidade viewBox (eixo x)
    const sy = h / (isH ? TOTAL_W : TOTAL_L); // mm por unidade viewBox (eixo y)

    // Pontos do polígono em mm (mesma lógica do generateArrowSvg)
    let pts: [number, number][];
    if (direction === 'right') {
        pts = [
            [x,                   y + WING * sy],
            [x + BODY_L * sx,     y + WING * sy],
            [x + BODY_L * sx,     y],
            [x + TOTAL_L * sx,    y + TIP * sy],
            [x + BODY_L * sx,     y + TOTAL_W * sy],
            [x + BODY_L * sx,     y + (WING + BODY_W) * sy],
            [x,                   y + (WING + BODY_W) * sy],
        ];
    } else if (direction === 'left') {
        pts = [
            [x + TOTAL_L * sx,    y + WING * sy],
            [x + HEAD_D * sx,     y + WING * sy],
            [x + HEAD_D * sx,     y],
            [x,                   y + TIP * sy],
            [x + HEAD_D * sx,     y + TOTAL_W * sy],
            [x + HEAD_D * sx,     y + (WING + BODY_W) * sy],
            [x + TOTAL_L * sx,    y + (WING + BODY_W) * sy],
        ];
    } else if (direction === 'down') {
        pts = [
            [x + WING * sx,           y],
            [x + WING * sx,           y + BODY_L * sy],
            [x,                       y + BODY_L * sy],
            [x + TIP * sx,            y + TOTAL_L * sy],
            [x + TOTAL_W * sx,        y + BODY_L * sy],
            [x + (WING + BODY_W) * sx, y + BODY_L * sy],
            [x + (WING + BODY_W) * sx, y],
        ];
    } else { // up
        pts = [
            [x + (WING + BODY_W) * sx, y + TOTAL_L * sy],
            [x + (WING + BODY_W) * sx, y + HEAD_D * sy],
            [x + TOTAL_W * sx,         y + HEAD_D * sy],
            [x + TIP * sx,             y],
            [x,                        y + HEAD_D * sy],
            [x + WING * sx,            y + HEAD_D * sy],
            [x + WING * sx,            y + TOTAL_L * sy],
        ];
    }

    // Movimentos relativos para jsPDF.lines()
    const lines: [number, number][] = [];
    for (let i = 1; i < pts.length; i++) {
        lines.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
    }

    // Preenche polígono
    doc.setFillColor(168, 81, 138); // #A8518A
    doc.lines(lines, pts[0][0], pts[0][1], [1, 1], 'F', true);

    // Texto centralizado no corpo
    let tx: number, ty: number, angle = 0;
    if (direction === 'right') {
        tx = x + (BODY_L / 2 + 1.5) * sx; ty = y + TIP * sy; // leve offset em direção à ponta
    } else if (direction === 'left') {
        tx = x + (HEAD_D + BODY_L / 2 - 1.5) * sx; ty = y + TIP * sy; // leve offset em direção à ponta
    } else if (direction === 'down') {
        tx = x + TIP * sx; ty = y + (BODY_L / 2 + 1.5) * sy; angle = -90; // leve offset em direção à ponta
    } else {
        tx = x + TIP * sx; ty = y + (HEAD_D + BODY_L / 2 - 1.5) * sy; angle = 90; // leve offset em direção à ponta
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSizePt);
    // Impede que o texto saia pelo lado traseiro — overflow só pela frente (ponta)
    const halfW = doc.getTextWidth(code) / 2;
    const bm = 0.8; // back-margin em mm (só horizontal)
    // UP/DOWN: centralizado no corpo — pequeno overflow (~0.26mm) invisível no PDF
    if (direction === 'right')     tx = Math.max(tx, x + halfW + bm);
    else if (direction === 'left') tx = Math.min(tx, x + TOTAL_L * sx - halfW - bm);
    doc.setTextColor(230, 230, 230); // #E6E6E6
    doc.text(code, tx, ty, { align: 'center', baseline: 'middle', angle });
    doc.setTextColor(0, 0, 0); // restaura cor padrão
}

export default function SetasPlacementModal({ pdfBlob, pageNumber, onConfirm, onCancel, storageKey, fileNameHint }: Props) {
    const canvasRef    = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [canvasDims, setCanvasDims]     = useState<{ w: number; h: number }>({ w: 0, h: 0 });
    const [loadingPdf, setLoadingPdf]     = useState(true);
    const [errorPdf, setErrorPdf]         = useState('');
    const [placedArrows, setPlacedArrows] = useState<PlacedArrow[]>([]);
    const [arrowSizeMm, setArrowSizeMm]   = useState(15);
    const [fontSizePt, setFontSizePt]     = useState(18);
    const [maxLetterIdx, setMaxLetterIdx] = useState(3);  // padrão D (índice 3)
    const [maxNumber, setMaxNumber]       = useState(3);  // padrão 3 unidades por letra
    const [zoom, setZoom]                 = useState(1.0);

    const arrowSizeMmRef  = useRef(15);
    const canvasDimsRef   = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
    const placedArrowsRef = useRef<PlacedArrow[]>([]);
    const fontSizePtRef   = useRef(18);
    const zoomRef         = useRef(1.0);
    const hasRestoredRef  = useRef(false); // guard para restaurar só uma vez por sessão
    const hasCenteredRef  = useRef(false); // guard para centralizar scroll só na primeira carga
    const fileInputRef    = useRef<HTMLInputElement>(null);
    const panState        = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
    useEffect(() => { arrowSizeMmRef.current  = arrowSizeMm;  }, [arrowSizeMm]);
    useEffect(() => { canvasDimsRef.current   = canvasDims;   }, [canvasDims]);
    useEffect(() => { placedArrowsRef.current = placedArrows; }, [placedArrows]);
    useEffect(() => { fontSizePtRef.current   = fontSizePt;   }, [fontSizePt]);
    useEffect(() => { zoomRef.current         = zoom;         }, [zoom]);

    // Restaura placement salvo quando o canvas estiver pronto
    useEffect(() => {
        if (!storageKey || !canvasDims.w || hasRestoredRef.current) return;
        hasRestoredRef.current = true;
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) return;
            const saved: SavedSetasState = JSON.parse(raw);
            if (!Array.isArray(saved.arrows) || saved.arrows.length === 0) return;
            // Converte coords mm → px no canvas atual
            const restored: PlacedArrow[] = saved.arrows.map(r => ({
                id:        crypto.randomUUID(),
                code:      r.code,
                direction: r.direction,
                cx: (r.x + r.w / 2) / PAGE_W_MM * canvasDims.w,
                cy: (r.y + r.h / 2) / PAGE_H_MM * canvasDims.h,
            }));
            setPlacedArrows(restored);
            if (typeof saved.arrowSizeMm === 'number') setArrowSizeMm(saved.arrowSizeMm);
            if (typeof saved.fontSizePt  === 'number') setFontSizePt(saved.fontSizePt);
        } catch {
            // JSON inválido — ignora silenciosamente
        }
    }, [storageKey, canvasDims.w]);

    // Centraliza o scroll quando o PDF carrega pela primeira vez
    useEffect(() => {
        if (!canvasDims.w || hasCenteredRef.current) return;
        hasCenteredRef.current = true;
        requestAnimationFrame(() => {
            const el = scrollContainerRef.current;
            if (!el) return;
            el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
            el.scrollTop  = (el.scrollHeight - el.clientHeight) / 2;
        });
    }, [canvasDims.w]);

    // Última seta clicada — recebe foco para ajuste fino por teclado
    const selectedArrowId = useRef<string | null>(null);

    // Scroll container ref — para registrar listener de wheel com passive:false
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        function onWheel(e: WheelEvent) {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
            setZoom(v => Math.min(4, Math.max(0.3, v * factor)));
        }
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, []);

    // Pan com botão direito segurado — move o scroll container sem re-renders
    useEffect(() => {
        function onMouseMove(e: MouseEvent) {
            if (!panState.current) return;
            const el = scrollContainerRef.current;
            if (!el) return;
            el.scrollLeft = panState.current.scrollLeft - (e.clientX - panState.current.startX);
            el.scrollTop  = panState.current.scrollTop  - (e.clientY - panState.current.startY);
        }
        function onMouseUp(e: MouseEvent) {
            if (e.button !== 2) return;
            panState.current = null;
            if (scrollContainerRef.current) scrollContainerRef.current.style.cursor = '';
        }
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup',   onMouseUp);
        return () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup',   onMouseUp);
        };
    }, []);

    // Refs para drag sem estado — zero re-renders durante o arrastar
    const dragState = useRef<{
        arrowId: string;
        direction: Direction;
        startMouseX: number; startMouseY: number;
        startCx: number;     startCy: number;
    } | null>(null);
    const dragLivePos = useRef<{ cx: number; cy: number } | null>(null);

    // Mapa de id → elemento DOM das setas no canvas (para mover direto sem setState)
    const arrowElemsRef = useRef<Map<string, HTMLImageElement>>(new Map());

    // Paleta: SVGs memoizados — fonte fixa 18pt; recalcula só quando muda o range
    const paletteSrcs = useMemo<Record<string, string>>(() => {
        const map: Record<string, string> = {};
        const letters = LETTERS_ALL.slice(0, maxLetterIdx + 1);
        const numbers = Array.from({ length: maxNumber }, (_, i) => String(i + 1).padStart(2, '0'));
        for (const letter of letters) {
            for (const num of numbers) {
                const code = `${letter}${num}`;
                for (const dir of DIR_ORDER) {
                    map[`${code}|${dir}`] = svgToDataUrl(generateArrowSvg(code, dir, 18));
                }
            }
        }
        return map;
    }, [maxLetterIdx, maxNumber]);

    // Renderiza a página PDF no canvas
    useEffect(() => {
        let cancelled = false;
        async function renderPage() {
            setLoadingPdf(true);
            setErrorPdf('');
            try {
                const buffer  = await pdfBlob.arrayBuffer();
                const pdf     = await pdfjsLib.getDocument({ data: buffer }).promise;
                const pageIdx = Math.min(Math.max(1, pageNumber), pdf.numPages);
                const page    = await pdf.getPage(pageIdx);
                const TARGET_W = 1400;
                const vp0      = page.getViewport({ scale: 1 });
                const scale    = TARGET_W / vp0.width;
                const viewport = page.getViewport({ scale });
                if (cancelled) return;
                const canvas = canvasRef.current;
                if (!canvas) return;
                canvas.width  = viewport.width;
                canvas.height = viewport.height;
                await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                if (cancelled) return;
                setCanvasDims({ w: canvas.width, h: canvas.height });
                // Auto-fit: zoom inicial para caber no container sem crop
                if (scrollContainerRef.current) {
                    const availW = scrollContainerRef.current.clientWidth - 40;
                    setZoom(Math.min(1, availW / canvas.width));
                }
            } catch (e: any) {
                if (!cancelled) setErrorPdf(`Erro ao carregar página: ${e.message}`);
            } finally {
                if (!cancelled) setLoadingPdf(false);
            }
        }
        renderPage();
        return () => { cancelled = true; };
    }, [pdfBlob, pageNumber]);

    /** Dimensões em px da seta. Horizontal usa canvasW/PAGE_W_MM, vertical usa canvasH/PAGE_H_MM. */
    function arrowPxDims(direction: Direction, sizeMm?: number, dims?: { w: number; h: number }) {
        const sz  = sizeMm ?? arrowSizeMmRef.current;
        const cd  = dims   ?? canvasDimsRef.current;
        if (!cd.w) return { w: 48, h: 32 };
        const ratio = TOTAL_L / TOTAL_W;
        const isH   = direction === 'left' || direction === 'right';
        if (isH) {
            const longPx = (sz / PAGE_W_MM) * cd.w;
            return { w: longPx, h: longPx / ratio };
        } else {
            const longPx = (sz / PAGE_H_MM) * cd.h;
            return { w: longPx / ratio, h: longPx };
        }
    }

    // Mouse drag — move direto no DOM, só comita no mouseup (zero re-renders durante drag)
    useEffect(() => {
        function onMouseMove(e: MouseEvent) {
            if (!dragState.current) return;
            const z  = zoomRef.current;
            const dx = (e.clientX - dragState.current.startMouseX) / z;
            const dy = (e.clientY - dragState.current.startMouseY) / z;
            const newCx = dragState.current.startCx + dx;
            const newCy = dragState.current.startCy + dy;
            dragLivePos.current = { cx: newCx, cy: newCy };

            // Mover elemento diretamente no DOM — sem setState
            const elem = arrowElemsRef.current.get(dragState.current.arrowId);
            if (elem) {
                const dims = arrowPxDims(dragState.current.direction);
                elem.style.left = `${newCx - dims.w / 2}px`;
                elem.style.top  = `${newCy - dims.h / 2}px`;
            }
        }

        function onMouseUp() {
            if (!dragState.current) return;
            const { arrowId } = dragState.current;
            const finalPos = dragLivePos.current;
            dragState.current = null;
            dragLivePos.current = null;

            if (!finalPos) return;
            const cd = canvasDimsRef.current;
            setPlacedArrows(prev => {
                const arrow = prev.find(a => a.id === arrowId);
                if (!arrow) return prev;
                const { cx, cy } = finalPos;
                // Centro fora da página → remover
                if (cx < 0 || cx > cd.w || cy < 0 || cy > cd.h) {
                    return prev.filter(a => a.id !== arrowId);
                }
                return prev.map(a => a.id === arrowId ? { ...a, cx, cy } : a);
            });
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup',   onMouseUp);
        return () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup',   onMouseUp);
        };
    }, []);

    // Ajuste fino por teclado — seta = 1px, Shift+seta = 10px
    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (!selectedArrowId.current) return;
            const MAP: Record<string, [number, number]> = {
                ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
            };
            const delta = MAP[e.key];
            if (!delta) return;
            e.preventDefault();
            const step = e.shiftKey ? 10 : 1;
            const id = selectedArrowId.current;
            const [dx, dy] = [delta[0] * step, delta[1] * step];
            // Atualiza DOM imediatamente (mesma abordagem do drag)
            const arrow = placedArrowsRef.current.find(a => a.id === id);
            if (arrow) {
                const dims = arrowPxDims(arrow.direction);
                const elem = arrowElemsRef.current.get(id);
                if (elem) {
                    elem.style.left = `${arrow.cx + dx - dims.w / 2}px`;
                    elem.style.top  = `${arrow.cy + dy - dims.h / 2}px`;
                }
            }
            setPlacedArrows(prev => prev.map(a => a.id === id ? { ...a, cx: a.cx + dx, cy: a.cy + dy } : a));
        }
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, []);

    function handleCanvasDrop(e: React.DragEvent) {
        e.preventDefault();
        const raw = e.dataTransfer.getData('application/seta');
        if (!raw || !containerRef.current) return;
        const { code, direction } = JSON.parse(raw) as { code: string; direction: Direction };
        const rect = containerRef.current.getBoundingClientRect();
        const z = zoomRef.current;
        const newId = crypto.randomUUID();
        selectedArrowId.current = newId; // seta recém-arrastada já fica selecionada
        setPlacedArrows(prev => [...prev, {
            id: newId,
            code,
            direction,
            cx: (e.clientX - rect.left) / z,
            cy: (e.clientY - rect.top)  / z,
        }]);
    }

    function handleArrowMouseDown(e: React.MouseEvent, arrow: PlacedArrow) {
        e.preventDefault();
        e.stopPropagation();
        selectedArrowId.current = arrow.id; // ativa ajuste fino por teclado
        dragState.current = {
            arrowId:     arrow.id,
            direction:   arrow.direction,
            startMouseX: e.clientX,
            startMouseY: e.clientY,
            startCx:     arrow.cx,
            startCy:     arrow.cy,
        };
        dragLivePos.current = { cx: arrow.cx, cy: arrow.cy };
    }

    function handleConfirm() {
        const cd = canvasDimsRef.current;
        if (!cd.w) return;
        const results: PlacedArrowResult[] = [];
        for (const arrow of placedArrowsRef.current) {
            if (arrow.cx < 0 || arrow.cx > cd.w || arrow.cy < 0 || arrow.cy > cd.h) continue;
            const dims = arrowPxDims(arrow.direction);
            results.push({
                code:      arrow.code,
                direction: arrow.direction,
                x: ((arrow.cx - dims.w / 2) / cd.w) * PAGE_W_MM,
                y: ((arrow.cy - dims.h / 2) / cd.h) * PAGE_H_MM,
                w: (dims.w / cd.w) * PAGE_W_MM,
                h: (dims.h / cd.h) * PAGE_H_MM,
                fontSizePt: fontSizePtRef.current,
            });
        }
        // Persiste para restaurar na próxima abertura (mesma pasta)
        if (storageKey) {
            const saved: SavedSetasState = {
                arrows:      results,
                arrowSizeMm: arrowSizeMmRef.current,
                fontSizePt:  fontSizePtRef.current,
            };
            try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch { /* quota excedida */ }
        }
        onConfirm(results);
    }

    /** Converte setas atuais (px) → mm e retorna SavedSetasState */
    function buildSavedState(): SavedSetasState {
        const cd = canvasDimsRef.current;
        const arrows: PlacedArrowResult[] = [];
        for (const arrow of placedArrowsRef.current) {
            if (!cd.w || arrow.cx < 0 || arrow.cx > cd.w || arrow.cy < 0 || arrow.cy > cd.h) continue;
            const dims = arrowPxDims(arrow.direction);
            arrows.push({
                code:      arrow.code,
                direction: arrow.direction,
                x: ((arrow.cx - dims.w / 2) / cd.w) * PAGE_W_MM,
                y: ((arrow.cy - dims.h / 2) / cd.h) * PAGE_H_MM,
                w: (dims.w / cd.w) * PAGE_W_MM,
                h: (dims.h / cd.h) * PAGE_H_MM,
                fontSizePt: fontSizePtRef.current,
            });
        }
        return { arrows, arrowSizeMm: arrowSizeMmRef.current, fontSizePt: fontSizePtRef.current };
    }

    function handleSaveFile() {
        const state = buildSavedState();
        const json  = JSON.stringify(state, null, 2);
        const blob  = new Blob([json], { type: 'text/plain;charset=utf-8' });
        const url   = URL.createObjectURL(blob);
        const a     = document.createElement('a');
        a.href      = url;
        a.download  = `${fileNameHint ?? 'Art Guide'}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function handleLoadFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = ''; // reset para permitir recarregar o mesmo arquivo
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const saved: SavedSetasState = JSON.parse(reader.result as string);
                if (!Array.isArray(saved.arrows)) return;
                const cd = canvasDimsRef.current;
                if (!cd.w) return;
                const restored: PlacedArrow[] = saved.arrows.map(r => ({
                    id:        crypto.randomUUID(),
                    code:      r.code,
                    direction: r.direction,
                    cx: (r.x + r.w / 2) / PAGE_W_MM * cd.w,
                    cy: (r.y + r.h / 2) / PAGE_H_MM * cd.h,
                }));
                setPlacedArrows(restored);
                if (typeof saved.arrowSizeMm === 'number') setArrowSizeMm(saved.arrowSizeMm);
                if (typeof saved.fontSizePt  === 'number') setFontSizePt(saved.fontSizePt);
            } catch { /* arquivo inválido */ }
        };
        reader.readAsText(file);
    }

    return (
        <div className="fixed inset-0 z-[300] flex flex-col bg-gray-900" style={{ userSelect: 'none' }}>

            {/* Top bar */}
            <div className="flex items-center gap-3 px-4 py-2 bg-gray-800 border-b border-gray-700 shrink-0">
                <span className="text-gray-400 text-xs">Seta:</span>
                <button onClick={() => setArrowSizeMm(v => Math.max(5, v - 1))}
                    className="w-6 h-6 rounded bg-gray-600 text-white text-sm hover:bg-gray-500 flex items-center justify-center">−</button>
                <input type="range" min={5} max={40} value={arrowSizeMm}
                    onChange={e => setArrowSizeMm(Number(e.target.value))} className="w-24" />
                <button onClick={() => setArrowSizeMm(v => Math.min(40, v + 1))}
                    className="w-6 h-6 rounded bg-gray-600 text-white text-sm hover:bg-gray-500 flex items-center justify-center">+</button>
                <span className="text-gray-300 text-xs font-mono tabular-nums w-10">{arrowSizeMm}mm</span>

                <div className="w-px h-4 bg-gray-600 mx-1" />

                <span className="text-gray-400 text-xs">Fonte:</span>
                <button onClick={() => setFontSizePt(v => Math.max(6, v - 1))}
                    className="w-6 h-6 rounded bg-gray-600 text-white text-sm hover:bg-gray-500 flex items-center justify-center">−</button>
                <span className="text-gray-300 text-xs font-mono tabular-nums w-8 text-center">{fontSizePt}pt</span>
                <button onClick={() => setFontSizePt(v => Math.min(48, v + 1))}
                    className="w-6 h-6 rounded bg-gray-600 text-white text-sm hover:bg-gray-500 flex items-center justify-center">+</button>

                <div className="w-px h-4 bg-gray-600 mx-1" />

                <span className="text-gray-400 text-xs">Letra:</span>
                <button onClick={() => setMaxLetterIdx(v => Math.max(0, v - 1))}
                    className="w-6 h-6 rounded bg-gray-600 text-white text-sm hover:bg-gray-500 flex items-center justify-center">−</button>
                <span className="text-gray-300 text-xs font-mono tabular-nums w-4 text-center">{LETTERS_ALL[maxLetterIdx]}</span>
                <button onClick={() => setMaxLetterIdx(v => Math.min(25, v + 1))}
                    className="w-6 h-6 rounded bg-gray-600 text-white text-sm hover:bg-gray-500 flex items-center justify-center">+</button>

                <div className="w-px h-4 bg-gray-600 mx-1" />

                <span className="text-gray-400 text-xs">Qtd:</span>
                <button onClick={() => setMaxNumber(v => Math.max(1, v - 1))}
                    className="w-6 h-6 rounded bg-gray-600 text-white text-sm hover:bg-gray-500 flex items-center justify-center">−</button>
                <span className="text-gray-300 text-xs font-mono tabular-nums w-4 text-center">{maxNumber}</span>
                <button onClick={() => setMaxNumber(v => Math.min(9, v + 1))}
                    className="w-6 h-6 rounded bg-gray-600 text-white text-sm hover:bg-gray-500 flex items-center justify-center">+</button>

                <div className="w-px h-4 bg-gray-600 mx-1" />

                {/* Salvar / Carregar guia */}
                <button onClick={handleSaveFile} disabled={loadingPdf}
                    title={`Salvar guia: ${fileNameHint ?? 'Art Guide'}.txt`}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white disabled:opacity-40 transition-colors">
                    <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4.5L10.5 1H2zm8 0v3.5H13L10 1zM4 9h8v1H4zm0 2h8v1H4zm0-4h4v1H4z"/></svg>
                    Salvar
                </button>
                <button onClick={() => fileInputRef.current?.click()} disabled={loadingPdf}
                    title="Carregar guia salvo (.txt)"
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white disabled:opacity-40 transition-colors">
                    <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 2a.5.5 0 0 1 .5.5v5.793l1.646-1.647a.5.5 0 0 1 .708.708l-2.5 2.5a.5.5 0 0 1-.708 0l-2.5-2.5a.5.5 0 1 1 .708-.708L7.5 8.293V2.5A.5.5 0 0 1 8 2zm-5 9a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1H3z"/></svg>
                    Carregar
                </button>
                <input ref={fileInputRef} type="file" accept=".txt" style={{ display: 'none' }} onChange={handleLoadFile} />

                <div className="flex-1" />
                <div className="w-px h-4 bg-gray-600 mx-1" />
                <span className="text-gray-400 text-xs">Zoom:</span>
                <span className="text-gray-300 text-xs font-mono tabular-nums w-10 text-center">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(1)}
                    className="text-xs text-gray-400 hover:text-white px-1" title="Resetar zoom">↺</button>
                <button onClick={onCancel}
                    className="px-4 py-1.5 rounded text-sm font-semibold bg-gray-600 text-white hover:bg-gray-500 transition-colors">Cancelar</button>
                <button onClick={handleConfirm} disabled={loadingPdf}
                    className="px-5 py-1.5 rounded text-sm font-bold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition-colors">✓ Confirmar</button>
            </div>

            {/* Body */}
            <div className="flex flex-1 overflow-hidden">

                {/* Paleta */}
                <div className="w-52 shrink-0 bg-gray-800 border-r border-gray-700 overflow-y-auto py-1">
                    {LETTERS_ALL.slice(0, maxLetterIdx + 1).map(letter => (
                        <div key={letter} className="border-b border-gray-700 last:border-0">
                            <div className="px-2 py-0.5 text-[10px] font-bold text-gray-400 sticky top-0 bg-gray-800 z-10">{letter}</div>
                            {Array.from({ length: maxNumber }, (_, i) => String(i + 1).padStart(2, '0')).map(num => {
                                const code = `${letter}${num}`;
                                return (
                                    <div key={code} className="flex items-center gap-1 px-2 py-0.5">
                                        <span className="text-[9px] text-gray-500 w-5 shrink-0 tabular-nums">{num}</span>
                                        <div className="flex items-center gap-0.5">
                                            {DIR_ORDER.map(dir => {
                                                const isH = dir === 'left' || dir === 'right';
                                                return (
                                                    <img
                                                        key={dir}
                                                        src={paletteSrcs[`${code}|${dir}`]}
                                                        width={isH ? 36 : 18}
                                                        height={isH ? 18 : 36}
                                                        title={`${code} ${DIR_LABEL[dir]}`}
                                                        draggable
                                                        onDragStart={e => {
                                                            e.dataTransfer.setData('application/seta', JSON.stringify({ code, direction: dir }));
                                                            e.dataTransfer.effectAllowed = 'copy';
                                                        }}
                                                        style={{ cursor: 'grab', flexShrink: 0, imageRendering: 'crisp-edges' }}
                                                        alt={`${code} ${dir}`}
                                                    />
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>

                {/* Canvas */}
                <div
                    ref={scrollContainerRef}
                    className="flex-1 overflow-auto bg-gray-600"
                    onDragOver={e => e.preventDefault()}
                    onDrop={handleCanvasDrop}
                    onContextMenu={e => e.preventDefault()}
                    onMouseDown={e => {
                        if (e.button !== 2) return;
                        const el = scrollContainerRef.current;
                        if (!el) return;
                        panState.current = { startX: e.clientX, startY: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop };
                        el.style.cursor = 'grabbing';
                    }}
                    style={{ position: 'relative' }}
                >
                    {/* Stage — garante espaço de scroll em todas as direções (pan livre) */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth:  canvasDims.w ? canvasDims.w * zoom + 600 : '100%',
                        minHeight: canvasDims.h ? canvasDims.h * zoom + 600 : '100%',
                    }}>
                    {/* Wrapper colapsa o espaço de layout com o zoom — transform sozinho não faz isso */}
                    <div style={{
                        flexShrink: 0,
                        width:  canvasDims.w ? canvasDims.w * zoom : undefined,
                        height: canvasDims.h ? canvasDims.h * zoom : undefined,
                    }}>
                    <div
                        ref={containerRef}
                        style={{
                            position: 'relative',
                            display: 'inline-block',
                            boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
                            visibility: (loadingPdf || errorPdf) ? 'hidden' : 'visible',
                            overflow: 'hidden',
                            transform: `scale(${zoom})`,
                            transformOrigin: 'top left',
                        }}
                    >
                        <canvas ref={canvasRef} style={{ display: 'block' }} />

                        {canvasDims.w > 0 && placedArrows.map(arrow => {
                            const dims = arrowPxDims(arrow.direction, arrowSizeMm, canvasDims);
                            return (
                                <img
                                    key={arrow.id}
                                    ref={el => {
                                        if (el) arrowElemsRef.current.set(arrow.id, el);
                                        else arrowElemsRef.current.delete(arrow.id);
                                    }}
                                    src={svgToDataUrl(generateArrowSvg(arrow.code, arrow.direction, fontSizePt))}
                                    onMouseDown={e => handleArrowMouseDown(e, arrow)}
                                    style={{
                                        position: 'absolute',
                                        left: arrow.cx - dims.w / 2,
                                        top:  arrow.cy - dims.h / 2,
                                        width:  dims.w,
                                        height: dims.h,
                                        cursor: 'move',
                                        pointerEvents: 'all',
                                    }}
                                    draggable={false}
                                    alt={`${arrow.code} ${arrow.direction}`}
                                />
                            );
                        })}
                    </div>
                    </div>{/* fim wrapper layout */}
                    </div>{/* fim stage */}

                    {loadingPdf && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-300">
                            <svg className="animate-spin w-8 h-8 text-violet-400" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                            </svg>
                            <span className="text-sm">Renderizando página {pageNumber}...</span>
                        </div>
                    )}
                    {errorPdf && !loadingPdf && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="text-red-400 text-sm p-4 bg-red-900/50 rounded-lg max-w-sm text-center">{errorPdf}</div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
