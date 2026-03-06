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
                        if (slotDef?.scriptName === '01') {
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

                // Detecta se esta página possui o script 'render'
                const renderSlot = (cfgPagina.slots ?? []).find(s => {
                    const def = slotDefaults[s.id];
                    return s.tipo === 'imagem' && def?.mode === 'script' && def?.scriptName === 'render';
                });

                // Slots de texto e imagens fixas (não-render)
                const otherSlots = (cfgPagina.slots ?? []).filter(s => s !== renderSlot);

                // Se for uma página de render, ela pode se repetir conforme o número de imagens
                const timesToRepeat = renderSlot ? (renderUrls.length || 1) : 1;

                let remainingLines: string[] | undefined = undefined;

                for (let ri = 0; ri < timesToRepeat; ri++) {
                    do {
                        setProgress(`Gerando ${cfgPagina.descricao || `Página ${cfgPagina.pagina}`}...`);
                        if (pageIndex > 0) doc.addPage();

                        if (bd) {
                            await adicionarFundo(doc, bd, W, H);
                        } else {
                            doc.setFillColor(252, 252, 252);
                            doc.rect(0, 0, W, H, 'F');
                        }

                        // Se tiver slot de render, insere a imagem da vez
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

                        // Renderiza textos e sobras
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

    // Cálculo dinâmico do total de páginas considerando as repetições de render
    let totalPages = 0;
    for (const p of paginasConfig) {
        const hasRender = p.slots?.some(s => {
            const def = slotDefaults[s.id];
            return s.tipo === 'imagem' && def?.mode === 'script' && def?.scriptName === 'render';
        });
        totalPages += hasRender ? (renderCount || 1) : 1;
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
                        const hasRender = p.slots?.some(s => {
                            const def = slotDefaults[s.id];
                            return s.tipo === 'imagem' && def?.mode === 'script' && def?.scriptName === 'render';
                        });
                        const n = hasRender ? (renderCount || 1) : 1;

                        return (
                            <div key={i} className={`flex items-center gap-3 p-3 border rounded-lg ${hasRender ? 'border-blue-100 bg-blue-50/40' : 'border-gray-100 bg-gray-50/50'}`}>
                                <span className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${hasRender ? 'bg-blue-100 text-blue-600' : 'bg-orange-100 text-orange-600'}`}>
                                    {p.pagina}
                                </span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-700">
                                        {p.descricao || `Página ${p.pagina}`}
                                        {hasRender && n > 1 && <span className="ml-1.5 text-xs font-normal text-blue-600">(×{n} renders)</span>}
                                    </p>
                                    <p className="text-[11px] text-gray-400">
                                        {p.slots?.filter(s => s.tipo === 'texto').length ?? 0} slot(s) texto
                                        {hasRender && ' + slot render'}
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
