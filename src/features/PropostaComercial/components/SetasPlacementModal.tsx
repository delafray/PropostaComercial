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

const LETTERS   = ['A','B','C','D','E','F','G','H','I','J','K','L'];
const NUMBERS   = ['01','02','03','04'];
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
}

export function generateArrowSvg(code: string, direction: Direction, fontSizePt = 18): string {
    const isH = direction === 'left' || direction === 'right';
    const vw = isH ? TOTAL_L : TOTAL_W;
    const vh = isH ? TOTAL_W : TOTAL_L;
    let pathD: string;
    let tx: number, ty: number, rot = '';

    if (direction === 'right') {
        pathD = `M0,${WING} L${BODY_L},${WING} L${BODY_L},0 L${TOTAL_L},${TIP} L${BODY_L},${TOTAL_W} L${BODY_L},${WING+BODY_W} L0,${WING+BODY_W} Z`;
        tx = BODY_L / 2; ty = TIP;
    } else if (direction === 'left') {
        pathD = `M${TOTAL_L},${WING} L${HEAD_D},${WING} L${HEAD_D},0 L0,${TIP} L${HEAD_D},${TOTAL_W} L${HEAD_D},${WING+BODY_W} L${TOTAL_L},${WING+BODY_W} Z`;
        tx = HEAD_D + BODY_L / 2; ty = TIP;
    } else if (direction === 'down') {
        pathD = `M${WING},0 L${WING},${BODY_L} L0,${BODY_L} L${TIP},${TOTAL_L} L${TOTAL_W},${BODY_L} L${WING+BODY_W},${BODY_L} L${WING+BODY_W},0 Z`;
        tx = TIP; ty = BODY_L / 2;
        rot = `rotate(90,${tx},${ty})`;
    } else {
        pathD = `M${WING+BODY_W},${TOTAL_L} L${WING+BODY_W},${HEAD_D} L${TOTAL_W},${HEAD_D} L${TIP},0 L0,${HEAD_D} L${WING},${HEAD_D} L${WING},${TOTAL_L} Z`;
        tx = TIP; ty = HEAD_D + BODY_L / 2;
        rot = `rotate(-90,${tx},${ty})`;
    }

    const fsNum = (fontSizePt / 18) * BODY_W * 0.85;
    const fs = fsNum.toFixed(2);
    // Impede que o texto saia pelo lado traseiro — overflow só pela frente (ponta)
    const halfW = code.length * fsNum * 0.31;
    const bm = 0.8; // back-margin em unidades viewBox
    if (direction === 'right')      tx = Math.max(tx, halfW + bm);
    else if (direction === 'left')  tx = Math.min(tx, TOTAL_L - halfW - bm);
    else if (direction === 'down')  ty = Math.max(ty, halfW + bm);
    else                            ty = Math.min(ty, TOTAL_L - halfW - bm);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}">
<path d="${pathD}" fill="${ARROW_COLOR}"/>
<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif" font-weight="bold" font-size="${fs}" fill="#E6E6E6"${rot ? ` transform="${rot}"` : ''}>${code}</text>
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
        tx = x + (BODY_L / 2) * sx; ty = y + TIP * sy;
    } else if (direction === 'left') {
        tx = x + (HEAD_D + BODY_L / 2) * sx; ty = y + TIP * sy;
    } else if (direction === 'down') {
        tx = x + TIP * sx; ty = y + (BODY_L / 2) * sy; angle = -90;
    } else {
        tx = x + TIP * sx; ty = y + (HEAD_D + BODY_L / 2) * sy; angle = 90;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSizePt);
    // Impede que o texto saia pelo lado traseiro — overflow só pela frente (ponta)
    const halfW = doc.getTextWidth(code) / 2;
    const bm = 0.8; // back-margin em mm
    if (direction === 'right')      tx = Math.max(tx, x + halfW + bm);
    else if (direction === 'left')  tx = Math.min(tx, x + TOTAL_L * sx - halfW - bm);
    else if (direction === 'down')  ty = Math.max(ty, y + halfW + bm);
    else                            ty = Math.min(ty, y + TOTAL_L * sy - halfW - bm);
    doc.setTextColor(230, 230, 230); // #E6E6E6
    doc.text(code, tx, ty, { align: 'center', baseline: 'middle', angle });
    doc.setTextColor(0, 0, 0); // restaura cor padrão
}

export default function SetasPlacementModal({ pdfBlob, pageNumber, onConfirm, onCancel }: Props) {
    const canvasRef    = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [canvasDims, setCanvasDims]     = useState<{ w: number; h: number }>({ w: 0, h: 0 });
    const [loadingPdf, setLoadingPdf]     = useState(true);
    const [errorPdf, setErrorPdf]         = useState('');
    const [placedArrows, setPlacedArrows] = useState<PlacedArrow[]>([]);
    const [arrowSizeMm, setArrowSizeMm]   = useState(15);
    const [fontSizePt, setFontSizePt]     = useState(18);

    const arrowSizeMmRef  = useRef(15);
    const canvasDimsRef   = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
    const placedArrowsRef = useRef<PlacedArrow[]>([]);
    const fontSizePtRef   = useRef(18);
    useEffect(() => { arrowSizeMmRef.current  = arrowSizeMm;  }, [arrowSizeMm]);
    useEffect(() => { canvasDimsRef.current   = canvasDims;   }, [canvasDims]);
    useEffect(() => { placedArrowsRef.current = placedArrows; }, [placedArrows]);
    useEffect(() => { fontSizePtRef.current   = fontSizePt;   }, [fontSizePt]);

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

    // Paleta: 192 SVGs memoizados — fonte fixa 18pt (independente do slider; slider afeta só PDF)
    const paletteSrcs = useMemo<Record<string, string>>(() => {
        const map: Record<string, string> = {};
        for (const letter of LETTERS) {
            for (const num of NUMBERS) {
                const code = `${letter}${num}`;
                for (const dir of DIR_ORDER) {
                    map[`${code}|${dir}`] = svgToDataUrl(generateArrowSvg(code, dir, 18));
                }
            }
        }
        return map;
    }, []);

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
                const TARGET_W = 700;
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
            const dx = e.clientX - dragState.current.startMouseX;
            const dy = e.clientY - dragState.current.startMouseY;
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

    function handleCanvasDrop(e: React.DragEvent) {
        e.preventDefault();
        const raw = e.dataTransfer.getData('application/seta');
        if (!raw || !containerRef.current) return;
        const { code, direction } = JSON.parse(raw) as { code: string; direction: Direction };
        const rect = containerRef.current.getBoundingClientRect();
        setPlacedArrows(prev => [...prev, {
            id: crypto.randomUUID(),
            code,
            direction,
            cx: e.clientX - rect.left,
            cy: e.clientY - rect.top,
        }]);
    }

    function handleArrowMouseDown(e: React.MouseEvent, arrow: PlacedArrow) {
        e.preventDefault();
        e.stopPropagation();
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
        onConfirm(results);
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

                <div className="flex-1" />
                <button onClick={onCancel}
                    className="px-4 py-1.5 rounded text-sm font-semibold bg-gray-600 text-white hover:bg-gray-500 transition-colors">Cancelar</button>
                <button onClick={handleConfirm} disabled={loadingPdf}
                    className="px-5 py-1.5 rounded text-sm font-bold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition-colors">✓ Confirmar</button>
            </div>

            {/* Body */}
            <div className="flex flex-1 overflow-hidden">

                {/* Paleta */}
                <div className="w-52 shrink-0 bg-gray-800 border-r border-gray-700 overflow-y-auto py-1">
                    {LETTERS.map(letter => (
                        <div key={letter} className="border-b border-gray-700 last:border-0">
                            <div className="px-2 py-0.5 text-[10px] font-bold text-gray-400 sticky top-0 bg-gray-800 z-10">{letter}</div>
                            {NUMBERS.map(num => {
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
                    className="flex-1 overflow-auto bg-gray-600 flex items-start justify-center p-4"
                    onDragOver={e => e.preventDefault()}
                    onDrop={handleCanvasDrop}
                    style={{ position: 'relative' }}
                >
                    <div
                        ref={containerRef}
                        style={{
                            position: 'relative',
                            display: 'inline-block',
                            boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
                            visibility: (loadingPdf || errorPdf) ? 'hidden' : 'visible',
                            overflow: 'hidden',
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
