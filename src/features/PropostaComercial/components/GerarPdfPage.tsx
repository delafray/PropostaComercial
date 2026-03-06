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

    useEffect(() => { loadData(); }, []);

    async function loadData() {
        try {
            setLoading(true);
            const [mascaras, bd, propostas] = await Promise.all([
                templateService.getMascaras(),
                templateService.getBackdrops(),
                propostaService.getPropostas(),
            ]);
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

    // ── Identificação dos tipos de página na máscara ──────────────────────────

    function identificarPaginas(mc: TemplateMascara) {
        // Ordena pelo número de página para garantir sequência correta
        const cfg = [...(mc.paginas_config ?? [])].sort((a, b) => a.pagina - b.pagina);

        // Página 1 (menor número) é sempre a capa
        const capaConfig = cfg[0] ?? null;

        // Interior = primeira página após a capa que tem slot de imagem
        // Se nenhuma tiver slot de imagem, usa a segunda página
        const interiorConfig = cfg.slice(1).find(p =>
            p.slots?.some((s: SlotElemento) => s.tipo === 'imagem')
        ) ?? cfg[1] ?? null;

        const outrasPaginas = cfg.filter(p => p !== capaConfig && p !== interiorConfig);

        return { capaConfig, interiorConfig, outrasPaginas };
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

            const { capaConfig, interiorConfig, outrasPaginas } = identificarPaginas(mascara);

            // ── Renders (Conversão Local para Blob URL) ───────────────────────

            let renderUrls: string[] = [];
            if (proposta) {
                if (proposta.dados?.renders?.length) {
                    for (const renderName of proposta.dados.renders) {
                        const localFile = arquivosLocais.find(f => f.name === renderName);
                        if (localFile) {
                            renderUrls.push(URL.createObjectURL(localFile));
                        } else {
                            throw new Error(`A imagem do render "${renderName}" não foi encontrada na pasta local. Conceda acesso à pasta ou verifique se ela existe.`);
                        }
                    }
                } else {
                    for (const pg of proposta.dados?.paginas ?? []) {
                        const maskPage = mascara.paginas_config.find(mp => mp.pagina === pg.pagina);
                        const renderSlot = maskPage?.slots?.find(
                            (s: SlotElemento) => s.tipo === 'imagem'
                        );
                        if (renderSlot && pg.slots[renderSlot.id]) {
                            renderUrls.push(pg.slots[renderSlot.id]);
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
                    const mode = slotDef?.mode ?? (slot.tipo === 'imagem' ? 'script' : 'text');

                    // Script mode → deixa o mecanismo de render/imagem tratar (exceto scripts de texto como 'hoje')
                    if (mode === 'script') {
                        if (slotDef?.scriptName === 'hoje') {
                            map[slot.nome] = new Date().toLocaleDateString('pt-BR');
                        }
                        if (slotDef?.scriptName === 'cliente_evento') {
                            const b = proposta?.dados?.briefing;
                            const cli = (b?.cliente ?? '').trim();
                            const eve = (b?.evento ?? '').trim();
                            map[slot.nome] = [cli, eve].filter(Boolean).join(' · ');
                        }
                        if (slotDef?.scriptName === 'mes_ano') {
                            const agora = new Date();
                            const meses = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
                            map[slot.nome] = `${meses[agora.getMonth()]} | ${agora.getFullYear()}`;
                        }
                        if (slotDef?.scriptName === 'descritivo') {
                            map[slot.nome] = proposta?.dados?.memorial ?? '';
                        }
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
                    if (fromProposta !== undefined) map[slot.id] = fromProposta;
                    else if (fromConfig !== undefined) map[slot.id] = fromConfig;
                }
                return map;
            }

            const capaTexts = buildTextMap(capaConfig);
            const interiorTexts = buildTextMap(interiorConfig);

            // ── Renderizar textos ─────────────────────────────────────────────

            function renderizarTextos(slots: SlotElemento[], nameToValue: Record<string, string>, isCapa = false, fontSizeMap: Record<string, number> = {}) {
                for (const slot of slots) {
                    const text = nameToValue[slot.nome] ?? '';
                    if (!text) continue;

                    const slotDef = slotDefaults[slot.id];

                    if (slotDef?.scriptName === 'descritivo') {
                        renderDescritivo(text, slot, fontSizeMap[slot.id]);
                        continue;
                    }

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
            }

            function renderDescritivo(content: string, slot: SlotElemento, customSize?: number) {
                const lines = content.split('\n');
                let currentY = slot.y_mm;
                const fontSize = customSize ?? 10;
                const lineHeight = (fontSize * 0.3527) * 1.2; // mm

                doc.setFontSize(fontSize);
                const configColor = slotDefaults[slot.id]?.color;
                const [r, g, b] = hexToRgb(configColor ?? slot.color ?? '#000000');
                doc.setTextColor(r, g, b);

                for (const line of lines) {
                    if (!line.trim()) continue;

                    // Detecta se é categoria (sem tabulação inicial e sem ID numérico no início)
                    const isCategory = line.trim() && !/^\d+(\.\d+)?\t/.test(line) && !line.startsWith('\t');

                    if (isCategory) {
                        doc.setFont('helvetica', 'bold');
                        doc.text(line.trim(), slot.x_mm, currentY + (lineHeight * 0.8));
                    } else {
                        doc.setFont('helvetica', 'normal');
                        // Tenta quebrar em colunas (ID \t Quantidade \t Unidade \t Descrição)
                        const parts = line.split('\t').map(p => p.trim());
                        if (parts.length >= 4) {
                            const [id, qty, unit, ...descParts] = parts;
                            const desc = descParts.join(' ');

                            doc.text(id, slot.x_mm, currentY + (lineHeight * 0.8));
                            doc.text(qty, slot.x_mm + 10, currentY + (lineHeight * 0.8));
                            doc.text(unit, slot.x_mm + 25, currentY + (lineHeight * 0.8));
                            doc.text(desc, slot.x_mm + 40, currentY + (lineHeight * 0.8));
                        } else {
                            // Fallback caso não esteja tabulado perfeitamente
                            doc.text(line.trim(), slot.x_mm + 5, currentY + (lineHeight * 0.8));
                        }
                    }

                    currentY += lineHeight;
                    // Proteção contra estouro do container (opcional, jsPDF não quebra página automático aqui)
                    if (currentY > slot.y_mm + slot.h_mm) break;
                }
            }

            let pageIndex = 0;

            // ── Página 1: Capa ────────────────────────────────────────────────

            if (capaConfig) {
                setProgress('Gerando capa...');
                if (pageIndex > 0) doc.addPage();

                const bd = capaConfig.backdrop_id
                    ? backdrops.find(b => b.id === capaConfig.backdrop_id) ?? null
                    : null;

                if (bd) {
                    await adicionarFundo(doc, bd, W, H);
                } else {
                    doc.setFillColor(252, 252, 252);
                    doc.rect(0, 0, W, H, 'F');
                }

                renderizarTextos(capaConfig.slots ?? [], capaTexts, true, buildFontSizeMap(capaConfig));
                pageIndex++;
            }

            // ── Páginas Interiores (1 por render) ─────────────────────────────

            if (interiorConfig) {
                const bd = interiorConfig.backdrop_id
                    ? backdrops.find(b => b.id === interiorConfig.backdrop_id) ?? null
                    : null;

                // renderSlot: apenas slots imagem que estão em mode='script' (não campo/texto)
                const renderSlot = (interiorConfig.slots ?? []).find(
                    (s: SlotElemento) => {
                        if (s.tipo !== 'imagem') return false;
                        const def = slotDefaults[s.id];
                        const m = def?.mode ?? 'script';
                        return m === 'script';
                    }
                ) ?? null;

                // textSlots: todos os não-imagem + imagem que estão em field/text mode
                const textSlots = (interiorConfig.slots ?? []).filter(
                    (s: SlotElemento) => {
                        if (s.tipo !== 'imagem') return true;
                        const def = slotDefaults[s.id];
                        const m = def?.mode ?? 'script';
                        return m === 'field' || m === 'text';
                    }
                );

                const total = renderUrls.length || 1;

                for (let ri = 0; ri < total; ri++) {
                    setProgress(`Gerando interior ${ri + 1}/${total}...`);
                    if (pageIndex > 0) doc.addPage();

                    if (bd) {
                        await adicionarFundo(doc, bd, W, H);
                    } else {
                        doc.setFillColor(252, 252, 252);
                        doc.rect(0, 0, W, H, 'F');
                    }

                    if (renderSlot && renderUrls[ri]) {
                        try {
                            const { data, format } = await fetchBase64(renderUrls[ri]);
                            doc.addImage(
                                data, format,
                                renderSlot.x_mm, renderSlot.y_mm,
                                renderSlot.w_mm, renderSlot.h_mm,
                            );
                        } catch (imgErr) {
                            console.warn(`Render ${ri + 1} não carregado:`, imgErr);
                        }
                    }

                    renderizarTextos(textSlots, interiorTexts, false, buildFontSizeMap(interiorConfig));

                    // -- MODO DEBUG: Slot de Imagem --
                    if (debugMode && renderSlot) {
                        doc.setDrawColor(255, 0, 255);
                        doc.setLineWidth(0.1);
                        doc.rect(renderSlot.x_mm, renderSlot.y_mm, renderSlot.w_mm, renderSlot.h_mm, 'S');

                        doc.setFontSize(8);
                        doc.setTextColor(255, 0, 255);
                        doc.text(`[IMAGEM: ${renderSlot.nome}]`, renderSlot.x_mm + 2, renderSlot.y_mm + 5);
                    }

                    pageIndex++;
                }
            }

            // ── Outras páginas ────────────────────────────────────────────────

            for (const outra of outrasPaginas) {
                setProgress(`Gerando ${outra.descricao || `página ${outra.pagina}`}...`);
                if (pageIndex > 0) doc.addPage();

                const bd = outra.backdrop_id
                    ? backdrops.find(b => b.id === outra.backdrop_id) ?? null
                    : null;

                if (bd) {
                    await adicionarFundo(doc, bd, W, H);
                } else {
                    doc.setFillColor(252, 252, 252);
                    doc.rect(0, 0, W, H, 'F');
                }

                renderizarTextos(outra.slots ?? [], buildTextMap(outra), false, buildFontSizeMap(outra));
                pageIndex++;
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

    const { capaConfig, interiorConfig, outrasPaginas } = identificarPaginas(mascara);

    // Conta renders enviados ao banco; se ainda não enviados, infere pelos nomes de arquivo da pasta
    const rendersSalvos = proposta?.dados?.renders?.length ?? 0;
    const rendersNaPasta = (proposta?.dados?.pasta?.arquivos ?? [])
        .filter((f: string) => /^\d+\.(jpg|jpeg|png)$/i.test(f)).length;
    const renderCount = rendersSalvos > 0 ? rendersSalvos : rendersNaPasta;

    const totalPages = (capaConfig ? 1 : 0)
        + (interiorConfig ? (renderCount || 1) : 0)
        + outrasPaginas.length;

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

                    {capaConfig && (() => {
                        const bd = capaConfig.backdrop_id ? backdrops.find(b => b.id === capaConfig.backdrop_id) : null;
                        return (
                            <div className="flex items-center gap-3 p-3 border border-gray-100 rounded-lg bg-gray-50/50">
                                <span className="w-7 h-7 bg-orange-100 text-orange-600 rounded-full text-xs font-bold flex items-center justify-center shrink-0">1</span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-700">Capa</p>
                                    <p className="text-[11px] text-gray-400">{capaConfig.slots?.filter(s => s.tipo === 'texto').length ?? 0} slot(s) texto</p>
                                </div>
                                <span className={`text-[11px] px-2 py-0.5 rounded font-semibold shrink-0 ${bd ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-500'}`}>
                                    {bd ? `${bd.nome} · ${bd.tipo_arquivo}` : 'Sem fundo ⚠'}
                                </span>
                            </div>
                        );
                    })()}

                    {interiorConfig && (() => {
                        const bd = interiorConfig.backdrop_id ? backdrops.find(b => b.id === interiorConfig.backdrop_id) : null;
                        const n = renderCount || 1;
                        return (
                            <div className="flex items-center gap-3 p-3 border border-blue-100 rounded-lg bg-blue-50/40">
                                <span className="w-7 h-7 bg-blue-100 text-blue-600 rounded-full text-xs font-bold flex items-center justify-center shrink-0">
                                    {n > 1 ? `×${n}` : '2'}
                                </span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-700">
                                        Interior{n > 1 && <span className="ml-1.5 text-xs font-normal text-blue-600">(×{n} renders)</span>}
                                    </p>
                                    <p className="text-[11px] text-gray-400">{interiorConfig.slots?.filter(s => s.tipo === 'texto').length ?? 0} slot(s) texto + render</p>
                                </div>
                                <span className={`text-[11px] px-2 py-0.5 rounded font-semibold shrink-0 ${bd ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-500'}`}>
                                    {bd ? `${bd.nome} · ${bd.tipo_arquivo}` : 'Sem fundo ⚠'}
                                </span>
                            </div>
                        );
                    })()}

                    {outrasPaginas.map((p, i) => {
                        const bd = p.backdrop_id ? backdrops.find(b => b.id === p.backdrop_id) : null;
                        const pageNum = 1 + (interiorConfig ? (renderCount || 1) : 0) + i + 1;
                        return (
                            <div key={i} className="flex items-center gap-3 p-3 border border-gray-100 rounded-lg bg-gray-50/50">
                                <span className="w-7 h-7 bg-orange-100 text-orange-600 rounded-full text-xs font-bold flex items-center justify-center shrink-0">{pageNum}</span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-700">{p.descricao || `Página ${p.pagina}`}</p>
                                    <p className="text-[11px] text-gray-400">{p.slots?.filter(s => s.tipo === 'texto').length ?? 0} slot(s) texto</p>
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
