// !! REGRA N1: JAMAIS apague/mova arquivos fora de C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\ — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.
// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { templateService } from '../services/templateService';
import { prefService } from '../services/prefService';
import { propostaService } from '../services/propostaService';
import { TemplateMascara, ProjetoInput, Proposta } from '../types';
import { getMaquinaId } from '../utils/maquinaId';
import { prefKeyForMascara, SlotDefaults } from './ConfiguracaoPage';
import { parsePasta } from '../utils/projetoParser';
import { salvarHandle, carregarHandle, pedirPermissao, lerArquivos, suportaFSA } from '../utils/pastaHandle';

export default function MascarasPage({ onRenderizarPdf }: { onRenderizarPdf?: (fontSize: number, mascaraId: string) => void } = {}) {
    // Máscaras
    const [mascaras, setMascaras] = useState<TemplateMascara[]>([]);
    const [mascaraAtiva, setMascaraAtiva] = useState<TemplateMascara | null>(null);
    const [slotDefaults, setSlotDefaults] = useState<SlotDefaults>({});
    const [loading, setLoading] = useState(true);
    const [fontDescritivo, setFontDescritivo] = useState(7);
    const [sessionFont, setSessionFont] = useState(7);

    // Proposta (DB)
    const [proposta, setProposta] = useState<Proposta | null>(null);

    // Pasta
    const [projeto, setProjeto] = useState<ProjetoInput | null>(null);
    const [pastaName, setPastaName] = useState('');
    const [loadingPasta, setLoadingPasta] = useState(false);
    const [ultimaPasta, setUltimaPasta] = useState<{ nome: string; arquivos: string[]; savedAt: string } | null>(null);
    const [handleSalvo, setHandleSalvo] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => { loadData(); }, []);

    async function loadData() {
        setLoading(true);
        const maquinaId = getMaquinaId();
        let mc: TemplateMascara | null = null;
        try {
            // Fase 1 — crítico: render imediato com lista de máscaras e máscara ativa
            const [lista, mascaraAtivaId] = await Promise.all([
                templateService.getMascaras(),
                prefService.loadPref(`mascara_ativa_${maquinaId}`).catch(() => null),
            ]);
            setMascaras(lista);
            mc = mascaraAtivaId ? (lista.find((m: TemplateMascara) => m.id === mascaraAtivaId) ?? null) : null;
            setMascaraAtiva(mc);
        } finally {
            setLoading(false); // Render imediato — pasta/proposta carregam em background
        }

        // Fase 2 — secundário: não bloqueia o render
        Promise.all([
            prefService.loadPref(`pasta_ativa_${maquinaId}`).catch(() => null),
            suportaFSA() ? carregarHandle().catch(() => null) : Promise.resolve(null),
            propostaService.getPropostas().catch(() => []),
            mc ? loadFontDescritivo(mc) : Promise.resolve(),
        ]).then(([pref, handle, propostas]) => {
            // Proposta vinculada à pasta ativa — nunca usar [0] pois contamina com dados de pasta anterior
            const folderName = (pref as any)?.nome ?? (handle as any)?.name ?? null;
            const propostaAtual = folderName
                ? ((propostas as Proposta[]).find(p => p.dados?.pasta?.nome === folderName) ?? null)
                : null;
            setProposta(propostaAtual);
            if (pref) setUltimaPasta(pref as any);
            if (handle) setHandleSalvo(true);
        }).catch(() => {});
    }

    async function loadFontDescritivo(mc: TemplateMascara) {
        const defs: SlotDefaults = await prefService.loadPref(prefKeyForMascara(mc.id)).catch(() => ({})) ?? {};
        setSlotDefaults(defs);
        const slotDescritivo = Object.values(defs).find((d: any) => d?.scriptName === '01');
        const raw = (slotDescritivo as any)?.fontSize;
        // fontSize válido para script '01' é 5–9pt; fora disso usa default 7
        const valor = (typeof raw === 'number' && raw >= 5 && raw <= 9) ? raw : 7;
        setFontDescritivo(valor);
        setSessionFont(valor);
    }

    async function selecionarMascara(mc: TemplateMascara) {
        const maquinaId = getMaquinaId();
        setMascaraAtiva(mc);
        await prefService.savePref(`mascara_ativa_${maquinaId}`, mc.id);
        await loadFontDescritivo(mc);
    }

    async function salvarFonte(valor: number) {
        if (!mascaraAtiva) return;
        const defs: SlotDefaults = await prefService.loadPref(prefKeyForMascara(mascaraAtiva.id)).catch(() => ({})) ?? {};
        let updated = false;
        for (const key of Object.keys(defs)) {
            if ((defs[key] as any)?.scriptName === '01') {
                (defs[key] as any).fontSize = valor;
                updated = true;
            }
        }
        if (!updated) {
            (defs as any)['__descritivo_font__'] = { value: '', fontSize: valor, mode: 'script', scriptName: '01' };
        }
        await prefService.savePref(prefKeyForMascara(mascaraAtiva.id), defs);
    }

    async function aplicarArquivos(files: File[], nomePasta: string) {
        setPastaName(nomePasta);
        const parsed = parsePasta(files);
        setProjeto(parsed);
        setLoadingPasta(false);

        // Salva referência da pasta
        const maquinaId = getMaquinaId();
        const pref = {
            nome: nomePasta,
            maquina_id: maquinaId,
            arquivos: [
                ...parsed.renders.map(f => f.name),
                ...(parsed.briefingPdf ? [parsed.briefingPdf.name] : []),
                ...(parsed.planta ? [parsed.planta.name] : []),
                ...(parsed.memorial ? [parsed.memorial.name] : []),
                ...(parsed.arquivoTamanho ? [parsed.arquivoTamanho.name] : []),
                ...(parsed.logo ? [parsed.logo.name] : []),
            ],
            savedAt: new Date().toISOString(),
        };
        await prefService.savePref(`pasta_ativa_${maquinaId}`, pref).catch(() => null);
        setUltimaPasta(pref);

        // Atualiza proposta para a pasta selecionada (busca por nome)
        propostaService.getPropostas().then((all: Proposta[]) => {
            const match = all.find(p => p.dados?.pasta?.nome === nomePasta) ?? null;
            setProposta(match);
        }).catch(() => {});
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
            setLoadingPasta(true);
            const files = await lerArquivos(handle);
            await aplicarArquivos(files, handle.name);
        } catch (e: any) {
            setLoadingPasta(false);
            if (e.name !== 'AbortError') setError(`Erro ao abrir pasta: ${e.message}`);
        }
    }

    async function handleReabrirPasta() {
        try {
            const handle = await carregarHandle();
            if (!handle) { setError('Nenhuma pasta salva.'); return; }
            const permitido = await pedirPermissao(handle);
            if (!permitido) { setError('Permissão negada. Selecione a pasta manualmente.'); return; }
            setLoadingPasta(true);
            const files = await lerArquivos(handle);
            await aplicarArquivos(files, handle.name);
        } catch (e: any) {
            setLoadingPasta(false);
            setError(`Erro ao re-abrir pasta: ${e.message}`);
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
                Carregando...
            </div>
        );
    }

    // Calcula total de páginas igual ao GerarPdfPage
    const renderCount = projeto?.renders?.length ?? 0;
    const totalPages = mascaraAtiva
        ? [...(mascaraAtiva.paginas_config ?? [])].reduce((acc, p) => {
            const hasProjeto = p.slots?.some(s => slotDefaults[s.id]?.mode === 'script' && slotDefaults[s.id]?.scriptName === 'projeto');
            const hasPlanta  = p.slots?.some(s => slotDefaults[s.id]?.mode === 'script' && slotDefaults[s.id]?.scriptName === 'planta');
            return acc + (hasProjeto ? (renderCount || 1) : hasPlanta ? 2 : 1);
        }, 0)
        : 0;

    return (
        <div className="py-6 px-4 space-y-6">

            {/* Erro */}
            {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                    <span className="flex-1">{error}</span>
                    <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">✕</button>
                </div>
            )}

            {/* ── Pasta do Projeto ──────────────────────────────────────── */}
            <div className="bg-white border border-gray-200 rounded-lg p-5">
                <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold text-gray-700">Pasta do Projeto</span>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleSelecionarPasta}
                            disabled={loadingPasta}
                            className="flex items-center gap-2 bg-gray-800 text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
                        >
                            📂 {pastaName ? 'Trocar Pasta' : 'Selecionar Pasta'}
                        </button>
                        {onRenderizarPdf && (
                            <>
                                <div className="flex items-center gap-1.5 bg-white border border-gray-300 rounded-lg px-2 py-1.5" title="Fonte do descritivo (session — não salva)">
                                    <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">Fonte:</span>
                                    <input
                                        type="number"
                                        min={5}
                                        max={30}
                                        step={0.5}
                                        value={sessionFont}
                                        onChange={e => setSessionFont(Number(e.target.value))}
                                        className="w-12 text-xs text-center font-mono border-0 outline-none bg-transparent"
                                    />
                                    <span className="text-[10px] text-gray-400">pt</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onRenderizarPdf(sessionFont, mascaraAtiva!.id)}
                                    disabled={!projeto || !mascaraAtiva || loadingPasta}
                                    title={!projeto ? 'Selecione uma pasta primeiro' : !mascaraAtiva ? 'Selecione uma máscara primeiro' : `Máscara: ${mascaraAtiva.nome} · Fonte: ${sessionFont}pt`}
                                    className="flex items-center gap-2 bg-orange-500 text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    {mascaraAtiva && totalPages > 0
                                        ? `⬇ Gerar PDF (${totalPages} pág.)`
                                        : '⬇ Gerar PDF'}
                                </button>
                            </>
                        )}
                    </div>
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

                {loadingPasta && (
                    <div className="flex items-center gap-2 py-4 text-xs text-gray-500">
                        <svg className="animate-spin w-4 h-4 text-orange-500" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                        Lendo arquivos da pasta...
                    </div>
                )}

                {!projeto && !loadingPasta && (
                    <div className="flex items-center gap-3 py-4 px-3 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                        <span className="text-2xl">📁</span>
                        <p className="text-sm text-gray-400">Nenhuma pasta selecionada.</p>
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
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">

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
                                    <p className="font-semibold text-gray-700">Altura do Estande</p>
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

                {/* ── Validação: info da proposta no BD ── */}
                {proposta && (() => {
                    const rendersSalvos = proposta.dados?.renders?.length ?? 0;
                    const rendersNaPasta = (proposta.dados?.pasta?.arquivos ?? [])
                        .filter((f: string) => /^\d+\.(jpg|jpeg|png)$/i.test(f)).length;
                    return (
                        <div className="mt-3 pt-3 border-t border-gray-100 flex items-start gap-3">
                            <span className="text-base shrink-0">📋</span>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-gray-700 truncate">{proposta.nome}</p>
                                <p className="text-xs text-gray-400 mt-0.5">
                                    {rendersSalvos > 0
                                        ? <><span className="text-emerald-600 font-semibold">{rendersSalvos} render(s) anexados</span> · criada em {new Date(proposta.created_at).toLocaleDateString('pt-BR')}</>
                                        : rendersNaPasta > 0
                                            ? <span className="text-amber-600 font-semibold">⚠ {rendersNaPasta} render(s) na pasta — salve na aba Nova Proposta</span>
                                            : <span className="text-red-500">Sem renders</span>
                                    }
                                </p>
                                {proposta.dados?.briefing && (
                                    <p className="text-xs text-emerald-600 mt-0.5">
                                        ✓ Briefing: {proposta.dados.briefing.cliente ?? '?'} · {proposta.dados.briefing.evento ?? '?'}
                                    </p>
                                )}
                            </div>
                            {rendersSalvos > 0 && (
                                <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">
                                    {rendersSalvos} render(s)
                                </span>
                            )}
                        </div>
                    );
                })()}
            </div>

            {/* ── Seleção de Máscara ────────────────────────────────────── */}
            <div className="bg-white border border-gray-200 rounded-lg p-5">
                <h2 className="text-sm font-bold text-gray-700 mb-3">Máscara ativa</h2>
                {mascaras.length === 0 ? (
                    <p className="text-sm text-gray-400">Nenhuma máscara disponível.</p>
                ) : (
                    <select
                        value={mascaraAtiva?.id ?? ''}
                        onChange={async (e) => {
                            const id = e.target.value;
                            if (!id) {
                                setMascaraAtiva(null);
                                setSlotDefaults({});
                                const maquinaId = getMaquinaId();
                                await prefService.savePref(`mascara_ativa_${maquinaId}`, null).catch(() => null);
                            } else {
                                const mc = mascaras.find(m => m.id === id) ?? null;
                                if (mc) await selecionarMascara(mc);
                            }
                        }}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-400"
                    >
                        <option value="">— Selecione uma máscara —</option>
                        {mascaras.map((mc) => (
                            <option key={mc.id} value={mc.id}>
                                {mc.nome} ({mc.formato ?? 'A4'})
                            </option>
                        ))}
                    </select>
                )}
            </div>


        </div>
    );
}
