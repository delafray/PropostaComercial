// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { templateService } from '../services/templateService';
import { propostaService } from '../services/propostaService';
import { TemplateMascara, TemplateBackdrop, PaginaConfig, SlotElemento, ProjetoInput, BriefingData } from '../types';
import { parsePasta } from '../utils/projetoParser';
import { parseBriefingPdf, autoMapBriefing, PageFormData } from '../utils/briefingParser';
import { SlotDefaults, prefKeyForMascara, FIELD_OPTIONS } from './ConfiguracaoPage';
import { getMaquinaId } from '../utils/maquinaId';
import { prefService } from '../services/prefService';
import { salvarHandle, carregarHandle, pedirPermissao, lerArquivos, suportaFSA } from '../utils/pastaHandle';

// ─── Tipos locais ─────────────────────────────────────────────────────────────

// PageFormData agora vem do briefingParser (evita duplicação)

// ─── Componente ───────────────────────────────────────────────────────────────

export default function NovaPropostaPage({ onSaved }: { onSaved?: () => void } = {}) {
    const [mascara, setMascara] = useState<TemplateMascara | null>(null);
    const [backdrops, setBackdrops] = useState<TemplateBackdrop[]>([]);
    const [loading, setLoading] = useState(true);
    const [slotDefaults, setSlotDefaults] = useState<SlotDefaults>({});

    const [nomeProposta, setNomeProposta] = useState('');
    const [pages, setPages] = useState<PageFormData[]>([]);

    const [saving, setSaving] = useState(false);
    const [uploadProgress, setUploadProgress] = useState('');
    const [error, setError] = useState('');
    const [savedId, setSavedId] = useState<string | null>(null);

    // Pasta do projeto
    const [projeto, setProjeto] = useState<ProjetoInput | null>(null);
    const [pastaName, setPastaName] = useState('');
    const [briefingData, setBriefingData] = useState<BriefingData | null>(null);
    const [memorialTexto, setMemorialTexto] = useState<string | null>(null);
    // campos que foram auto-preenchidos pelo briefing (set de slotIds)
    const [autoFilledIds, setAutoFilledIds] = useState<Set<string>>(new Set());

    // Diagnóstico do parser
    const [debugParse, setDebugParse] = useState<string>('');

    // Loader de processamento de Pasta
    const [loadingPasta, setLoadingPasta] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState(0);

    // Última pasta
    const [ultimaPasta, setUltimaPasta] = useState<{ nome: string; arquivos: string[]; savedAt: string } | null>(null);
    const [handleSalvo, setHandleSalvo] = useState(false);

    useEffect(() => { loadData(); }, []);

    async function loadData() {
        try {
            setLoading(true);
            const [mascaras, bd, propostas, pref, handle] = await Promise.all([
                templateService.getMascaras(),
                templateService.getBackdrops(),
                propostaService.getPropostas(),
                prefService.loadPref('ultima_pasta').catch(() => null),
                suportaFSA() ? carregarHandle().catch(() => null) : Promise.resolve(null),
            ]);
            const mc = mascaras[0] ?? null;
            setMascara(mc);
            setBackdrops(bd);
            if (mc) {
                const savedDefs = await prefService.loadPref(prefKeyForMascara(mc.id)).catch(() => null);
                const defs = (savedDefs as SlotDefaults) ?? {};
                setSlotDefaults(defs);

                const prop = propostas[0] ?? null;
                if (prop) {
                    // Restaura estado salvo da proposta
                    setNomeProposta(prop.nome ?? '');
                    if (prop.dados?.briefing) setBriefingData(prop.dados.briefing);
                    if (prop.dados?.pasta?.nome) setPastaName(prop.dados.pasta.nome);
                    if (prop.dados?.memorial) setMemorialTexto(prop.dados.memorial);
                    setPages(buildPagesFromProposta(mc, prop, defs));
                } else {
                    setPages(buildPagesFromMascara(mc, defs));
                }
            }
            if (pref) setUltimaPasta(pref as any);
            if (handle) setHandleSalvo(true);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }

    function buildPagesFromMascara(mc: TemplateMascara, defs: SlotDefaults = {}, briefing: any = null): PageFormData[] {
        return mc.paginas_config.map((p: PaginaConfig) => ({
            textValues: Object.fromEntries(
                (p.slots ?? []).map((s: SlotElemento) => {
                    const def = defs[s.id];
                    if (def?.mode === 'field' && def?.fieldKey && briefing) {
                        const raw = briefing[def.fieldKey];
                        return [s.id, raw ? String(raw).trim() : ''];
                    }
                    if (def?.mode === 'script' && def?.scriptName === 'hoje') {
                        return [s.id, new Date().toLocaleDateString('pt-BR')];
                    }
                    if (def?.mode === 'script' && def?.scriptName === 'cliente_evento' && briefing) {
                        const cli = (briefing.cliente ?? '').trim();
                        const eve = (briefing.evento ?? '').trim();
                        return [s.id, [cli, eve].filter(Boolean).join(' · ')];
                    }
                    if (def?.mode === 'script' && def?.scriptName === 'mes_ano') {
                        const agora = new Date();
                        const meses = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
                        return [s.id, `${meses[agora.getMonth()]} | ${agora.getFullYear()}`];
                    }
                    const val = (!def?.mode || def.mode === 'text') ? (def?.value ?? '') : '';
                    return [s.id, val];
                })
            ),
            fontSizes: Object.fromEntries(
                (p.slots ?? []).map((s: SlotElemento) => [s.id, defs[s.id]?.fontSize ?? s.font_size ?? 12])
            ),
        }));
    }

    function buildPagesFromProposta(mc: TemplateMascara, prop: any, defs: SlotDefaults = {}): PageFormData[] {
        const savedBriefing = prop.dados?.briefing ?? null;
        return mc.paginas_config.map((p: PaginaConfig) => {
            const savedPg = prop.dados?.paginas?.find((pg: any) => pg.pagina === p.pagina);
            return {
                textValues: Object.fromEntries(
                    (p.slots ?? []).map((s: SlotElemento) => {
                        const def = defs[s.id];
                        // field mode → resolve from saved briefing
                        if (def?.mode === 'field' && def?.fieldKey) {
                            const raw = savedBriefing?.[def.fieldKey];
                            return [s.id, raw ? String(raw).trim() : ''];
                        }
                        // script mode → empty (rendered automatically)
                        if (def?.mode === 'script') {
                            if (def?.scriptName === 'hoje') {
                                return [s.id, new Date().toLocaleDateString('pt-BR')];
                            }
                            if (def?.scriptName === 'cliente_evento') {
                                const cli = (savedBriefing?.cliente ?? '').trim();
                                const eve = (savedBriefing?.evento ?? '').trim();
                                return [s.id, [cli, eve].filter(Boolean).join(' · ')];
                            }
                            if (def?.scriptName === 'mes_ano') {
                                const agora = new Date();
                                const meses = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
                                return [s.id, `${meses[agora.getMonth()]} | ${agora.getFullYear()}`];
                            }
                            return [s.id, ''];
                        }
                        const savedVal = savedPg?.slots?.[s.id] ?? '';
                        // value só como fallback em mode='text' (ignora em field/script)
                        const fallback = (!def?.mode || def.mode === 'text') ? (def?.value ?? '') : '';
                        return [s.id, savedVal || fallback];
                    })
                ),
                fontSizes: Object.fromEntries(
                    (p.slots ?? []).map((s: SlotElemento) => [
                        s.id,
                        savedPg?.fontSizes?.[s.id] ?? defs[s.id]?.fontSize ?? s.font_size ?? 12,
                    ])
                ),
            };
        });
    }

    function setTextValue(pi: number, slotId: string, val: string) {
        setPages(prev => prev.map((p, i) =>
            i === pi ? { ...p, textValues: { ...p.textValues, [slotId]: val } } : p
        ));
    }

    function setFontSize(pi: number, slotId: string, size: number) {
        setPages(prev => prev.map((p, i) =>
            i === pi ? { ...p, fontSizes: { ...p.fontSizes, [slotId]: size } } : p
        ));
    }

    // ── Carregar pasta ────────────────────────────────────────────────────────

    async function aplicarArquivos(files: File[], nomePasta: string) {
        setLoadingPasta(true);
        setLoadingProgress(10);

        // Aguarda UI renderizar o overlay
        await new Promise(r => setTimeout(r, 100));

        setPastaName(nomePasta);
        const parsed = parsePasta(files);

        // Validação estrita de arquivos necessários
        if (!parsed.briefingPdf || parsed.renders.length === 0) {
            setLoadingPasta(false);
            setLoadingProgress(0);
            setError('Não foi possível carregar: faltam arquivos necessários nesta pasta (são exigidos no mínimo o PDF de Briefing e imagens de Render). Selecione outra pasta.');
            setProjeto(null);
            setPastaName('');
            setBriefingData(null);
            setNomeProposta('');
            return;
        }

        setProjeto(parsed);

        let briefing: BriefingData | null = null;
        let nome = nomePasta;

        setLoadingProgress(35);

        // Auto-preenche nome a partir do briefing: "{cliente} - {evento} - {numero}"
        if (parsed.briefingPdf) {
            try {
                setLoadingProgress(55);
                briefing = await parseBriefingPdf(parsed.briefingPdf);

                setLoadingProgress(75);

                const tokens = (briefing as any)._tokens ?? [];
                const diag = (briefing as any)._diag ?? '';
                setDebugParse(
                    `Arquivo: ${parsed.briefingPdf.name} (${(parsed.briefingPdf.size / 1024).toFixed(0)} KB)\n` +
                    `cliente="${briefing.cliente}" evento="${briefing.evento}"\n` +
                    `\n--- DIAGNÓSTICO ---\n${diag}\n` +
                    `\n--- TOKENS (${tokens.length}) ---\n` +
                    tokens.join('\n')
                );
                const partes = [briefing.cliente, briefing.evento, briefing.numero].filter(Boolean);
                if (partes.length > 0) nome = partes.join(' - ');

                // ── Auto-preenchimento dos slots ──
                if (mascara) {
                    // 1. Mapeamento semântico padrão (slots tipo 'texto' por nome)
                    const pagesMapeadas = autoMapBriefing(briefing, mascara);

                    // 2. Sobrescreve slots em mode='field' com o valor direto do briefing
                    for (let pi = 0; pi < mascara.paginas_config.length; pi++) {
                        const pagConfig = mascara.paginas_config[pi];
                        const pd = pagesMapeadas[pi];
                        if (!pd) continue;
                        for (const slot of pagConfig.slots ?? []) {
                            const def = slotDefaults[slot.id];
                            if (def?.mode === 'field' && def?.fieldKey) {
                                const raw = (briefing as any)[def.fieldKey];
                                pd.textValues[slot.id] = raw ? String(raw).trim() : '';
                            }
                        }
                    }

                    setPages(pagesMapeadas);
                    // Registra quais slotIds foram preenchidos (valor não-vazio)
                    const filled = new Set<string>();
                    for (const p of pagesMapeadas) {
                        for (const [id, val] of Object.entries(p.textValues)) {
                            if (val) filled.add(id);
                        }
                    }
                    setAutoFilledIds(filled);
                }
            } catch (e: any) {
                setDebugParse(`ERRO ao parsear briefing: ${e?.message ?? e}`);
            }
        } else {
            const nomes = Array.from(files).map(f => f.name).sort().join('\n');
            setDebugParse(
                `Sem arquivo de briefing na pasta (esperado: /^\\d{4,5}\\.pdf$/i)\n\n` +
                `Arquivos encontrados (${Array.from(files).length}):\n${nomes}`
            );
        }

        setLoadingProgress(90);

        // Lê o memorial (.txt) como texto raw
        let memorial: string | null = null;
        if (parsed.memorial) {
            try { memorial = await parsed.memorial.text(); } catch { /* ignora */ }
        }

        setBriefingData(briefing);
        setMemorialTexto(memorial);
        setNomeProposta(nome);

        setLoadingProgress(100);

        // Auto-salva preferência da pasta (silencioso)
        const pref = {
            nome: nomePasta,
            maquina_id: getMaquinaId(),
            arquivos: files.map(f => f.name),
            savedAt: new Date().toISOString(),
        };
        prefService.savePref('ultima_pasta', pref).catch(() => null);

        // Salva imediatamente no banco (aguardado — garante que o briefing esteja
        // disponível antes do spinner fechar e o usuário trocar de aba).
        if (mascara) {
            try {
                setLoadingProgress(95);
                const existentes = await propostaService.getPropostas();
                const dadosExistentes: Record<string, unknown> = (existentes[0]?.dados as any) ?? {};
                await propostaService.upsertProposta({
                    nome,
                    mascara_id: mascara.id,
                    dados: {
                        ...dadosExistentes,
                        ...(briefing ? { briefing } : {}),
                        ...(memorial ? { memorial } : {}),
                        pasta: { nome: nomePasta, arquivos: files.map(f => f.name) },
                    },
                });
            } catch { /* silencioso */ }
        }
        setLoadingPasta(false);
        setLoadingProgress(0);

        return parsed;
    }

    async function handleSelecionarPasta() {
        if (!suportaFSA()) {
            setError('Seu browser não suporta seleção de pasta. Use Chrome ou Edge.');
            return;
        }
        try {
            const handle = await (window as any).showDirectoryPicker({ mode: 'read' });
            await salvarHandle(handle);
            setHandleSalvo(true);
            const files = await lerArquivos(handle);
            await aplicarArquivos(files, handle.name);
        } catch (e: any) {
            if (e.name !== 'AbortError') setError(`Erro ao abrir pasta: ${e.message}`);
        }
    }

    async function handleReabrirPasta() {
        try {
            const handle = await carregarHandle();
            if (!handle) { setError('Nenhuma pasta salva.'); return; }
            const permitido = await pedirPermissao(handle);
            if (!permitido) { setError('Permissão negada. Selecione a pasta manualmente.'); return; }
            const files = await lerArquivos(handle);
            await aplicarArquivos(files, handle.name);
        } catch (e: any) {
            setError(`Erro ao re-abrir pasta: ${e.message}`);
        }
    }

    async function handleSalvarPasta() {
        if (!projeto) return;
        try {
            const pref = {
                nome: pastaName,
                maquina_id: getMaquinaId(),
                arquivos: [
                    ...projeto.renders.map(f => f.name),
                    ...(projeto.briefingPdf ? [projeto.briefingPdf.name] : []),
                    ...(projeto.planta ? [projeto.planta.name] : []),
                    ...(projeto.memorial ? [projeto.memorial.name] : []),
                    ...(projeto.arquivoTamanho ? [projeto.arquivoTamanho.name] : []),
                    ...(projeto.logo ? [projeto.logo.name] : []),
                ],
                savedAt: new Date().toISOString(),
            };
            await prefService.savePref('ultima_pasta', pref).catch(() => null);
            setUltimaPasta(pref);
        } catch { }
    }

    // ── Salvar proposta (upsert — sempre 1 única) ─────────────────────────────

    async function handleSave() {
        if (!nomeProposta.trim()) { setError('Informe um nome para a proposta.'); return; }
        if (!mascara) { setError('Nenhuma máscara disponível.'); return; }

        setSaving(true);
        setError('');
        setSavedId(null);

        try {
            // 1. Guardar apenas os Nomes dos Renders (Sem Upload)
            const renderUrls: string[] = [];
            if (projeto?.renders?.length) {
                for (let ri = 0; ri < projeto.renders.length; ri++) {
                    renderUrls.push(projeto.renders[ri].name);
                }
            }

            // 2. Slots de texto por página
            const paginas = [];
            for (let pi = 0; pi < mascara.paginas_config.length; pi++) {
                const pagina = mascara.paginas_config[pi];
                const pd = pages[pi];
                if (!pd) continue;
                const slots: Record<string, string> = {};
                for (const [slotId, val] of Object.entries(pd.textValues)) {
                    if (val.trim()) slots[slotId] = val.trim();
                }
                paginas.push({ pagina: pagina.pagina, slots, fontSizes: pd.fontSizes ?? {} });
            }

            // 3. Contexto da pasta (todos os arquivos, para tamanhoEstande e futuros usos)
            const todosArquivos = projeto ? [
                ...projeto.renders.map(f => f.name),
                ...(projeto.briefingPdf ? [projeto.briefingPdf.name] : []),
                ...(projeto.planta ? [projeto.planta.name] : []),
                ...(projeto.memorial ? [projeto.memorial.name] : []),
                ...(projeto.arquivoTamanho ? [projeto.arquivoTamanho.name] : []),
                ...(projeto.logo ? [projeto.logo.name] : []),
            ] : [];
            const pastaCtx = projeto ? {
                nome: pastaName,
                maquina_id: getMaquinaId(),
                arquivos: todosArquivos,
            } : null;

            setUploadProgress('Salvando...');

            // upsert: atualiza se já existe, cria se não existe
            const proposta = await propostaService.upsertProposta({
                nome: nomeProposta.trim(),
                mascara_id: mascara.id,
                dados: {
                    paginas,
                    ...(renderUrls.length ? { renders: renderUrls } : {}),
                    ...(pastaCtx ? { pasta: pastaCtx } : {}),
                    ...(briefingData ? { briefing: briefingData } : {}),
                    ...(memorialTexto ? { memorial: memorialTexto } : {}),
                },
            });

            setSavedId(proposta.id);
            setUploadProgress('');
            // Navega automaticamente para Gerar PDF
            if (onSaved) onSaved();

        } catch (e: any) {
            setError(e.message);
            setUploadProgress('');
        } finally {
            setSaving(false);
        }
    }

    function handleNova() {
        setNomeProposta('');
        if (mascara) setPages(buildPagesFromMascara(mascara, slotDefaults));
        setSavedId(null);
        setError('');
        setProjeto(null);
        setPastaName('');
        setBriefingData(null);
        setMemorialTexto(null);
    }

    // ── Render ─────────────────────────────────────────────────────────────────

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

    // ── Tela de sucesso ────────────────────────────────────────────────────────
    if (savedId) {
        return (
            <div className="max-w-4xl mx-auto">
                <div className="bg-white border border-gray-200 rounded-xl p-8 text-center shadow-sm">
                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <span className="text-3xl">✓</span>
                    </div>
                    <h2 className="text-lg font-bold text-gray-800 mb-1">Proposta salva!</h2>
                    <p className="text-sm text-gray-500 mb-6">
                        <strong>{nomeProposta}</strong> foi salva. Vá para <strong>Gerar PDF</strong> para gerar.
                    </p>
                    <button
                        onClick={handleNova}
                        className="bg-orange-600 text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-orange-700 transition-colors"
                    >
                        Editar Novamente
                    </button>
                </div>
            </div>
        );
    }

    // ── Formulário ─────────────────────────────────────────────────────────────

    return (
        <div className="max-w-4xl mx-auto relative">

            {/* Modal Bloqueante de Carregamento de Pasta */}
            {loadingPasta && (
                <div className="fixed inset-0 z-[9999] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center pointer-events-auto">
                    <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm flex flex-col items-center animate-in fade-in zoom-in-95 duration-200">
                        <div className="w-12 h-12 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-4"></div>
                        <h2 className="text-xl font-bold tracking-tight text-gray-800 mb-1">Analisando Arquivos...</h2>
                        <p className="text-sm text-gray-500 mb-6 text-center max-w-[250px]">
                            Lendo briefing, memorial e indexando os renders da pasta do projeto.
                        </p>
                        <div className="w-full bg-gray-100 rounded-full h-3 mb-2 overflow-hidden shadow-inner">
                            <div
                                className="bg-blue-600 h-full rounded-full transition-all duration-300 ease-out"
                                style={{ width: `${loadingProgress}%` }}
                            ></div>
                        </div>
                        <div className="flex justify-between w-full text-xs font-semibold text-gray-500">
                            <span>{loadingProgress}% concluído</span>
                            <span className="text-blue-600">Extraindo dados</span>
                        </div>
                    </div>
                </div>
            )}

            <div className="mb-5 pl-1">
                <h1 className="text-xl font-bold text-gray-900 tracking-tight">Nova Proposta</h1>
                <p className="text-sm text-gray-400 mt-0.5">
                    Máscara: <strong className="text-gray-600">{mascara.nome}</strong>
                </p>
            </div>

            {error && (
                <div className="mb-5 flex items-start justify-between gap-3 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
                    <span>{error}</span>
                    <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 shrink-0">✕</button>
                </div>
            )}

            {/* ── Pasta do Projeto ─────────────────────────────────────────── */}
            <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
                <div className="flex items-center justify-between mb-3">
                    <div>
                        <h2 className="text-sm font-bold text-gray-700">Pasta do Projeto</h2>
                        <p className="text-xs text-gray-400 mt-0.5">Selecione a pasta com os arquivos do projeto</p>
                    </div>
                    <button
                        type="button"
                        onClick={handleSelecionarPasta}
                        className="flex items-center gap-2 bg-gray-800 text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
                    >
                        📂 {pastaName ? 'Trocar Pasta' : 'Selecionar Pasta'}
                    </button>
                </div>

                {/* Banner última pasta */}
                {!projeto && (ultimaPasta || handleSalvo) && (
                    <div className="flex items-start gap-3 mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <span className="text-base shrink-0">📁</span>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-blue-800">Última pasta</p>
                            {ultimaPasta ? (
                                <>
                                    <p className="text-xs text-blue-700 font-mono truncate mt-0.5">{ultimaPasta.nome}</p>
                                    <p className="text-[10px] text-blue-500 mt-0.5">
                                        {ultimaPasta.arquivos.length} arquivo(s) · {new Date(ultimaPasta.savedAt).toLocaleDateString('pt-BR')}
                                    </p>
                                </>
                            ) : (
                                <p className="text-xs text-blue-600 mt-0.5">Pasta salva nesta máquina.</p>
                            )}
                        </div>
                        {handleSalvo && (
                            <button
                                type="button"
                                onClick={handleReabrirPasta}
                                className="shrink-0 text-xs bg-blue-600 text-white px-3 py-1.5 rounded font-semibold hover:bg-blue-700 transition-colors whitespace-nowrap"
                            >
                                🔓 Re-abrir
                            </button>
                        )}
                    </div>
                )}

                {!projeto && (
                    <div className="flex items-center gap-3 py-4 px-3 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                        <span className="text-2xl">📁</span>
                        <p className="text-sm text-gray-400">Nenhuma pasta selecionada.</p>
                    </div>
                )}

                {/* Diagnóstico briefing — sempre visível após abrir pasta */}
                {debugParse && (
                    <div className={`mb-3 p-3 border rounded-lg text-xs ${briefingData?.cliente ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                        <p className={`font-bold mb-1 ${briefingData?.cliente ? 'text-emerald-700' : 'text-red-700'}`}>
                            {briefingData?.cliente ? '✓ Briefing OK' : '⚠ Briefing: cliente=null — diagnóstico:'}
                        </p>
                        <pre className={`text-[10px] overflow-auto max-h-48 whitespace-pre-wrap break-all ${briefingData?.cliente ? 'text-emerald-600' : 'text-red-600'}`}>
                            {debugParse}
                        </pre>
                    </div>
                )}

                {projeto && (
                    <div>
                        <div className="flex items-center gap-2 mb-3 px-1">
                            <span className="text-sm font-mono font-semibold text-gray-700 truncate">{pastaName}</span>
                            <span className="text-xs text-gray-400">
                                · {projeto.renders.length + (projeto.briefingPdf ? 1 : 0) + (projeto.planta ? 1 : 0) + (projeto.memorial ? 1 : 0) + (projeto.logo ? 1 : 0) + (projeto.arquivoTamanho ? 1 : 0)} arquivo(s)
                            </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">

                            <div className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs ${projeto.renders.length > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
                                <span className="text-base shrink-0">{projeto.renders.length > 0 ? '✅' : '⬜'}</span>
                                <div className="min-w-0">
                                    <p className="font-semibold text-gray-700">
                                        Renders{projeto.renders.length > 0 && <span className="ml-1 text-emerald-700 font-bold">({projeto.renders.length})</span>}
                                    </p>
                                    {projeto.renders.length > 0 ? (
                                        <p className="text-gray-500 truncate mt-0.5">
                                            {projeto.renders.slice(0, 3).map(f => f.name).join(', ')}
                                            {projeto.renders.length > 3 && ` +${projeto.renders.length - 3}`}
                                        </p>
                                    ) : (
                                        <p className="text-gray-400 italic mt-0.5">Nenhum encontrado</p>
                                    )}
                                </div>
                            </div>

                            <div className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs ${projeto.briefingPdf ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
                                <span className="text-base shrink-0">{projeto.briefingPdf ? '✅' : '⬜'}</span>
                                <div className="min-w-0">
                                    <p className="font-semibold text-gray-700">Briefing PDF</p>
                                    <p className={`truncate mt-0.5 ${projeto.briefingPdf ? 'text-gray-500' : 'text-gray-400 italic'}`}>
                                        {projeto.briefingPdf ? projeto.briefingPdf.name : 'Não encontrado'}
                                    </p>
                                </div>
                            </div>

                            <div className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs ${projeto.planta ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
                                <span className="text-base shrink-0">{projeto.planta ? '✅' : '⬜'}</span>
                                <div className="min-w-0">
                                    <p className="font-semibold text-gray-700">Planta Baixa</p>
                                    <p className={`truncate mt-0.5 ${projeto.planta ? 'text-gray-500' : 'text-gray-400 italic'}`}>
                                        {projeto.planta ? projeto.planta.name : 'Não encontrada'}
                                    </p>
                                </div>
                            </div>

                            <div className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs ${projeto.tamanhoEstande ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
                                <span className="text-base shrink-0">{projeto.tamanhoEstande ? '✅' : '⬜'}</span>
                                <div className="min-w-0">
                                    <p className="font-semibold text-gray-700">Tamanho do Estande</p>
                                    <p className={`truncate mt-0.5 ${projeto.tamanhoEstande ? 'text-emerald-700 font-bold' : 'text-gray-400 italic'}`}>
                                        {projeto.tamanhoEstande ? `${projeto.tamanhoEstande}m` : 'Não detectado'}
                                        {projeto.arquivoTamanho && <span className="text-gray-400 font-normal ml-1">({projeto.arquivoTamanho.name})</span>}
                                    </p>
                                </div>
                            </div>

                            <div className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs ${projeto.logo ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
                                <span className="text-base shrink-0">{projeto.logo ? '✅' : '⬜'}</span>
                                <div className="min-w-0">
                                    <p className="font-semibold text-gray-700">Logo do Cliente</p>
                                    <p className={`truncate mt-0.5 ${projeto.logo ? 'text-gray-500' : 'text-gray-400 italic'}`}>
                                        {projeto.logo ? projeto.logo.name : 'Não encontrada'}
                                    </p>
                                </div>
                            </div>

                            <div className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs ${projeto.memorial ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
                                <span className="text-base shrink-0">{projeto.memorial ? '✅' : '⬜'}</span>
                                <div className="min-w-0">
                                    <p className="font-semibold text-gray-700">Descritivo</p>
                                    <p className={`truncate mt-0.5 ${projeto.memorial ? 'text-gray-500' : 'text-gray-400 italic'}`}>
                                        {projeto.memorial ? projeto.memorial.name : 'Não encontrado'}
                                    </p>
                                </div>
                            </div>

                        </div>
                    </div>
                )}
            </div>

            {/* ── Nome da proposta ─────────────────────────────────────────── */}
            <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
                <label className="block text-sm font-bold text-gray-700 mb-2">Nome da Proposta</label>
                <input
                    type="text"
                    value={nomeProposta}
                    onChange={e => setNomeProposta(e.target.value)}
                    placeholder="Ex: WTM 2026 — Stand J64 — RX Reed Exhibitions"
                    className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-orange-400"
                />
            </div>

            {/* ── Dados por página ─────────────────────────────────────────── */}
            {pages.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
                    <h2 className="text-sm font-bold text-gray-700 mb-4">Dados das páginas</h2>

                    {/* Lista de renders */}
                    {projeto?.renders && projeto.renders.length > 0 && (
                        <div className="mb-4 border border-blue-200 rounded-lg overflow-hidden">
                            <div className="flex items-center justify-between px-4 py-2.5 bg-blue-600">
                                <div className="flex items-center gap-2">
                                    <span className="text-white text-sm font-semibold">Renders</span>
                                    <span className="text-xs bg-white/20 text-white px-1.5 py-0.5 rounded font-semibold">
                                        {projeto.renders.length}
                                    </span>
                                </div>
                                <span className="text-xs text-blue-200">Enviados ao salvar · 1 página interior por render</span>
                            </div>
                            <div className="p-3 space-y-1">
                                {projeto.renders.map((f, ri) => (
                                    <div key={ri} className="flex items-center gap-2 text-xs">
                                        <span className="w-5 h-5 bg-blue-100 text-blue-700 rounded text-[10px] font-bold flex items-center justify-center shrink-0">
                                            {ri + 1}
                                        </span>
                                        <span className="text-gray-700 font-mono truncate">{f.name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Slots de texto por página */}
                    <div className="space-y-4">
                        {mascara.paginas_config.map((pagina: PaginaConfig, pi: number) => {
                            const pd = pages[pi];
                            if (!pd) return null;

                            const isInterior = pagina.slots?.some((s: SlotElemento) => s.tipo === 'imagem');

                            const allSlots = pagina.slots ?? [];
                            const textSlots = allSlots.filter((s: SlotElemento) => s.tipo === 'texto');
                            if (allSlots.length === 0) return null;

                            const bd = pagina.backdrop_id ? backdrops.find(b => b.id === pagina.backdrop_id) : null;

                            return (
                                <div key={pi} className="border border-gray-200 rounded-lg overflow-hidden">
                                    <div className="flex items-center gap-3 px-4 py-2.5 bg-orange-500">
                                        <span className="w-6 h-6 bg-white text-orange-600 rounded-full text-xs font-bold flex items-center justify-center shrink-0">
                                            {pagina.pagina}
                                        </span>
                                        <span className="text-sm font-semibold text-white flex-1 truncate">
                                            {`Página ${pagina.pagina}${pagina.descricao ? ' · ' + pagina.descricao : ''}${isInterior ? ' · render' : ''}`}
                                        </span>
                                        {bd ? (
                                            <span className="text-[10px] bg-white/20 text-white px-2 py-0.5 rounded font-medium shrink-0">
                                                {bd.nome}
                                            </span>
                                        ) : (
                                            <span className="text-[10px] text-orange-200 shrink-0">Sem fundo</span>
                                        )}
                                    </div>
                                    <div className="p-4 space-y-3">
                                        {allSlots.map((slot: SlotElemento) => {
                                            const pageNum = (pi + 1).toString().padStart(2, '0');
                                            const fullName = `pag_${pageNum}-${slot.nome}`;
                                            const isAuto = autoFilledIds.has(slot.id);
                                            const slotDef = slotDefaults[slot.id];
                                            const isFieldMode = slotDef?.mode === 'field';
                                            const isScriptMode = slotDef?.mode === 'script';
                                            const fieldLabel = isFieldMode ? FIELD_OPTIONS.find((f: any) => f.key === slotDef?.fieldKey)?.label ?? 'Campo' : '';
                                            const showFontSize = !isScriptMode || (isScriptMode && slotDef?.scriptName !== 'render');

                                            return (
                                                <div key={slot.id} className="flex items-center gap-3">
                                                    <div className="w-44 shrink-0">
                                                        <div className="flex items-center gap-1.5">
                                                            <p className="text-xs font-semibold text-gray-700 font-mono truncate" title={fullName}>
                                                                {fullName}
                                                            </p>
                                                            {isAuto && (
                                                                <span className="text-[9px] bg-emerald-100 text-emerald-700 font-bold px-1 py-0.5 rounded shrink-0">
                                                                    Auto
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {showFontSize && (
                                                        <div className="flex items-center gap-1 shrink-0">
                                                            <input
                                                                type="number"
                                                                min={6}
                                                                max={72}
                                                                value={pd.fontSizes?.[slot.id] ?? slot.font_size ?? 12}
                                                                onChange={e => setFontSize(pi, slot.id, Number(e.target.value))}
                                                                className="w-12 border border-gray-300 rounded px-1 py-1.5 text-xs text-center focus:outline-none focus:border-orange-400"
                                                            />
                                                            <span className="text-[10px] text-gray-400">pt</span>
                                                        </div>
                                                    )}
                                                    {isScriptMode ? (
                                                        <div className="flex-1 flex items-center gap-2">
                                                            <span className="text-[10px] bg-blue-100 text-blue-700 font-semibold px-2 py-1 rounded border border-blue-200 shrink-0">
                                                                ⚙ {slotDef?.scriptName ?? 'script'}
                                                            </span>
                                                            <span className="text-xs text-blue-400 italic">Preenchido automaticamente pelo script.</span>
                                                        </div>
                                                    ) : isFieldMode ? (
                                                        <div className="flex-1 flex items-center gap-2">
                                                            <span className="text-[10px] bg-orange-100 text-orange-700 font-semibold px-2 py-1 rounded border border-orange-200 shrink-0 whitespace-nowrap">
                                                                → {fieldLabel}
                                                            </span>
                                                            <input
                                                                type="text"
                                                                value={pd.textValues[slot.id] ?? ''}
                                                                onChange={e => setTextValue(pi, slot.id, e.target.value)}
                                                                placeholder={`Briefing: ${fieldLabel} — deixe vazio para usar`}
                                                                className="flex-1 border border-orange-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-orange-400 bg-orange-50/40 placeholder:text-orange-300"
                                                            />
                                                        </div>
                                                    ) : (
                                                        <input
                                                            type="text"
                                                            value={pd.textValues[slot.id] ?? ''}
                                                            onChange={e => {
                                                                setTextValue(pi, slot.id, e.target.value);
                                                                if (isAuto) setAutoFilledIds(prev => { const s = new Set(prev); s.delete(slot.id); return s; });
                                                            }}
                                                            placeholder={fullName}
                                                            className={`flex-1 border rounded px-3 py-2 text-sm focus:outline-none transition-colors ${isAuto
                                                                ? 'border-emerald-300 bg-emerald-50 focus:border-emerald-500'
                                                                : 'border-gray-300 focus:border-orange-400'
                                                                }`}
                                                        />
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Banner: renders prontos mas não enviados */}
            {projeto?.renders && projeto.renders.length > 0 && !savedId && (
                <div className="mb-4 flex items-center gap-3 p-3 bg-amber-50 border border-amber-300 rounded-lg text-sm text-amber-800">
                    <span className="text-xl shrink-0">⚠</span>
                    <div>
                        <p className="font-semibold">{projeto.renders.length} render(s) prontos — ainda não enviados</p>
                        <p className="text-xs text-amber-600 mt-0.5">Clique em <strong>Salvar Proposta</strong> abaixo para enviar as imagens e gerar o PDF completo.</p>
                    </div>
                </div>
            )}

            {/* ── Botão salvar ─────────────────────────────────────────────── */}
            <div className="bg-white border border-gray-200 rounded-lg p-5">
                <button
                    onClick={handleSave}
                    disabled={saving || loadingPasta || !nomeProposta.trim()}
                    className="bg-orange-600 text-white px-10 py-3 rounded-lg text-sm font-bold hover:bg-orange-700 disabled:opacity-40 transition-colors flex items-center gap-2"
                >
                    {saving ? (
                        <><span className="animate-spin inline-block">⟳</span> {uploadProgress || 'Salvando...'}</>
                    ) : (
                        'Salvar Dados da Proposta'
                    )}
                </button>
                {!nomeProposta.trim() && !saving && (
                    <p className="text-xs text-gray-400 mt-2">Preencha o nome para salvar.</p>
                )}
            </div>
        </div>
    );
}
