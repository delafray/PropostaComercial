// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { templateService } from '../services/templateService';
import { prefService } from '../services/prefService';
import { TemplateMascara, PaginaConfig, SlotElemento } from '../types';

// ── Tipos exportados ───────────────────────────────────────────────────────────

export type SlotMode = 'text' | 'field' | 'script';

export interface SlotDefault {
    value: string;
    fontSize: number;
    color?: string;
    fontFamily?: string;
    fontStyle?: 'normal' | 'bold' | 'italic';
    align?: 'left' | 'center' | 'right';
    mode?: SlotMode;
    fieldKey?: string;
    scriptName?: string;
}
export type SlotDefaults = Record<string, SlotDefault>;

export function prefKeyForMascara(mascaraId: string) {
    return `slot_defaults_${mascaraId}`;
}

// ── Constantes ─────────────────────────────────────────────────────────────────

const FONTS = [
    { value: 'helvetica', label: 'Helvetica' },
    { value: 'times', label: 'Times' },
    { value: 'courier', label: 'Courier' },
    { value: 'century-gothic', label: 'Century Gothic' },
];

const STYLE_OPTS = [
    { value: 'normal', label: 'N', title: 'Normal' },
    { value: 'bold', label: 'B', title: 'Negrito' },
    { value: 'italic', label: 'I', title: 'Itálico' },
] as const;

const ALIGN_OPTS = [
    { value: 'left', label: 'E', title: 'Esquerda' },
    { value: 'center', label: 'C', title: 'Centro' },
    { value: 'right', label: 'D', title: 'Direita' },
] as const;

// Campos diretos do briefing disponíveis para mapeamento
export const FIELD_OPTIONS = [
    { key: 'cliente', label: 'Cliente' },
    { key: 'evento', label: 'Evento' },
    { key: 'local', label: 'Local' },
    { key: 'data', label: 'Data' },
    { key: 'numero', label: 'Número do Projeto' },
    { key: 'numeroStand', label: 'Número do Stand' },
    { key: 'areaStand', label: 'Área do Stand' },
    { key: 'formaConstrutiva', label: 'Altura / Forma' },
    { key: 'comercial', label: 'Comercial' },
    { key: 'contato', label: 'Contato' },
    { key: 'email', label: 'E-mail' },
];

// Scripts disponíveis (comportamentos nomeados)
export const SCRIPT_OPTIONS = [
    {
        name: 'render',
        label: 'Render',
        description: 'Insere a imagem do render neste slot. Com múltiplos renders, gera uma página por render.',
    },
    {
        name: 'hoje',
        label: 'Data de Hoje',
        description: 'Insere a data atual formatada (DD/MM/AAAA) neste slot.',
    },
];

// ── Componente ─────────────────────────────────────────────────────────────────

export default function ConfiguracaoPage() {
    const [mascara, setMascara] = useState<TemplateMascara | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');
    const [defaults, setDefaults] = useState<SlotDefaults>({});

    useEffect(() => { loadData(); }, []);

    async function loadData() {
        try {
            setLoading(true);
            const mascaras = await templateService.getMascaras();
            const mc = mascaras[0] ?? null;
            setMascara(mc);
            if (mc) {
                const savedData = await prefService.loadPref(prefKeyForMascara(mc.id)).catch(() => null);
                const savedDefaults = (savedData as SlotDefaults) ?? {};
                const init: SlotDefaults = {};
                for (const pagina of mc.paginas_config) {
                    for (const slot of pagina.slots ?? []) {
                        const ex = savedDefaults[slot.id];
                        const defaultMode: SlotMode = ex?.mode ?? (slot.tipo === 'imagem' ? 'script' : 'text');
                        init[slot.id] = {
                            value: ex?.value ?? '',
                            fontSize: ex?.fontSize ?? slot.font_size ?? 12,
                            color: ex?.color ?? slot.color ?? '#000000',
                            fontFamily: ex?.fontFamily ?? 'helvetica',
                            fontStyle: ex?.fontStyle ?? (slot.font_style as any) ?? 'normal',
                            align: ex?.align ?? (slot.align as any) ?? 'left',
                            mode: defaultMode,
                            fieldKey: ex?.fieldKey ?? FIELD_OPTIONS[0].key,
                            scriptName: ex?.scriptName ?? (slot.tipo === 'imagem' ? 'render' : SCRIPT_OPTIONS[0].name),
                        };
                    }
                }
                setDefaults(init);
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }

    function update(slotId: string, patch: Partial<SlotDefault>) {
        setSaved(false);
        setDefaults(prev => ({ ...prev, [slotId]: { ...prev[slotId], ...patch } }));
    }

    async function handleSave() {
        if (!mascara) return;
        setSaving(true);
        setError('');
        try {
            await prefService.savePref(prefKeyForMascara(mascara.id), defaults);
            setSaved(true);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    }

    if (loading) return <div className="text-sm text-gray-400 py-10 text-center">Carregando...</div>;

    if (!mascara) return (
        <div className="max-w-4xl mx-auto">
            <div className="p-5 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-sm">
                Nenhuma máscara cadastrada. Adicione uma na aba <strong>Templates</strong>.
            </div>
        </div>
    );

    return (
        <div className="max-w-4xl mx-auto">

            <div className="mb-5 pl-1">
                <h1 className="text-xl font-bold text-gray-900 tracking-tight">Configuração Padrão</h1>
                <p className="text-sm text-gray-400 mt-0.5">
                    Valores fixos por slot — carregados automaticamente em toda nova proposta.
                    Máscara: <strong className="text-gray-600">{mascara.nome}</strong>
                </p>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded flex justify-between gap-3">
                    <span>{error}</span>
                    <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 shrink-0">✕</button>
                </div>
            )}

            <div className="space-y-4">
                {mascara.paginas_config.map((pagina: PaginaConfig, pi: number) => {
                    const allSlots = pagina.slots ?? [];
                    if (allSlots.length === 0) return null;
                    const pageNum = (pi + 1).toString().padStart(2, '0');

                    return (
                        <div key={pi} className="bg-white border border-gray-200 rounded-lg overflow-hidden">

                            <div className="flex items-center gap-3 px-4 py-2.5 bg-orange-500">
                                <span className="w-6 h-6 bg-white text-orange-600 rounded-full text-xs font-bold flex items-center justify-center shrink-0">
                                    {pagina.pagina}
                                </span>
                                <span className="text-sm font-semibold text-white">
                                    Página {pagina.pagina}{pagina.descricao ? ' · ' + pagina.descricao : ''}
                                </span>
                            </div>

                            <div className="divide-y divide-gray-100">
                                {allSlots.map((slot: SlotElemento) => {
                                    const fullName = `pag_${pageNum}-${slot.nome}`;
                                    const def = defaults[slot.id] ?? {
                                        value: '', fontSize: slot.font_size ?? 12,
                                        color: slot.color ?? '#000000', fontFamily: 'helvetica',
                                        fontStyle: slot.font_style ?? 'normal', align: slot.align ?? 'left',
                                        mode: slot.tipo === 'imagem' ? 'script' : 'text',
                                        fieldKey: FIELD_OPTIONS[0].key, scriptName: SCRIPT_OPTIONS[0].name,
                                    };
                                    const mode = def.mode ?? 'text';
                                    const isImagem = slot.tipo === 'imagem';
                                    const showStyle = mode !== 'script';

                                    return (
                                        <div key={slot.id} className="px-4 py-3">

                                            {/* Linha 1: nome do slot + seletor de modo */}
                                            <div className="flex items-start justify-between gap-3 mb-2.5">
                                                <div className="min-w-0">
                                                    <p className="text-xs font-mono font-semibold text-gray-700 truncate" title={fullName}>
                                                        {fullName}
                                                    </p>
                                                    <span className={`inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded-full mt-0.5 ${isImagem ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'
                                                        }`}>
                                                        {slot.tipo}
                                                    </span>
                                                </div>

                                                {/* Seletor de modo: Texto / Campo / Script */}
                                                <div className="flex items-center gap-0.5 shrink-0">
                                                    {(['text', 'field', 'script'] as SlotMode[]).map(m => (
                                                        <button
                                                            key={m}
                                                            type="button"
                                                            onClick={() => update(slot.id, { mode: m })}
                                                            className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-colors ${mode === m
                                                                ? 'bg-orange-500 text-white'
                                                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                                                }`}
                                                        >
                                                            {m === 'text' ? 'Texto' : m === 'field' ? 'Campo' : 'Script'}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Linha 2: input baseado no modo */}
                                            {mode === 'text' && (
                                                <input
                                                    type="text"
                                                    value={def.value}
                                                    onChange={e => update(slot.id, { value: e.target.value })}
                                                    placeholder="Valor padrão fixo..."
                                                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-orange-400 mb-2.5"
                                                />
                                            )}

                                            {mode === 'field' && (
                                                <div className="mb-2.5">
                                                    <select
                                                        value={def.fieldKey ?? FIELD_OPTIONS[0].key}
                                                        onChange={e => update(slot.id, { fieldKey: e.target.value })}
                                                        className="w-full border border-orange-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-orange-400 bg-orange-50 text-orange-900"
                                                    >
                                                        {FIELD_OPTIONS.map(f => (
                                                            <option key={f.key} value={f.key}>{f.label}</option>
                                                        ))}
                                                    </select>
                                                    <p className="text-[10px] text-orange-600 mt-1 px-1">
                                                        Busca o valor deste campo da proposta em tempo de geração do PDF.
                                                    </p>
                                                </div>
                                            )}

                                            {mode === 'script' && (
                                                <div className="mb-2.5">
                                                    <select
                                                        value={def.scriptName ?? SCRIPT_OPTIONS[0].name}
                                                        onChange={e => update(slot.id, { scriptName: e.target.value })}
                                                        className="w-full border border-blue-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-blue-50 text-blue-900 font-semibold mb-1.5"
                                                    >
                                                        {SCRIPT_OPTIONS.map(s => (
                                                            <option key={s.name} value={s.name}>{s.label}</option>
                                                        ))}
                                                    </select>
                                                    {(() => {
                                                        const sc = SCRIPT_OPTIONS.find(s => s.name === (def.scriptName ?? 'render'));
                                                        return sc ? (
                                                            <p className="text-[11px] text-blue-600 px-1">{sc.description}</p>
                                                        ) : null;
                                                    })()}
                                                </div>
                                            )}

                                            {/* Linha 3: controles de estilo (oculto no modo Script) */}
                                            {showStyle && (
                                                <div className="flex items-center flex-wrap gap-x-3 gap-y-2">

                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-[10px] text-gray-500 font-medium select-none">Tam.</span>
                                                        <input
                                                            type="number" min={6} max={99}
                                                            value={def.fontSize}
                                                            onChange={e => update(slot.id, { fontSize: Number(e.target.value) })}
                                                            className="w-12 border border-gray-300 rounded px-1 py-1 text-xs text-center focus:outline-none focus:border-orange-400"
                                                        />
                                                        <span className="text-[10px] text-gray-400 select-none">pt</span>
                                                    </div>

                                                    <div className="w-px h-5 bg-gray-200 shrink-0" />

                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-[10px] text-gray-500 font-medium select-none">Cor</span>
                                                        <input
                                                            type="color"
                                                            value={def.color ?? '#000000'}
                                                            onChange={e => update(slot.id, { color: e.target.value })}
                                                            className="w-8 h-7 rounded cursor-pointer border border-gray-300 p-0.5 bg-white"
                                                        />
                                                        <span className="text-[10px] text-gray-500 font-mono">
                                                            {(def.color ?? '#000000').toUpperCase()}
                                                        </span>
                                                    </div>

                                                    <div className="w-px h-5 bg-gray-200 shrink-0" />

                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-[10px] text-gray-500 font-medium select-none">Fonte</span>
                                                        <select
                                                            value={def.fontFamily ?? 'helvetica'}
                                                            onChange={e => update(slot.id, { fontFamily: e.target.value })}
                                                            className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-orange-400 bg-white"
                                                        >
                                                            {FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                                                        </select>
                                                    </div>

                                                    <div className="w-px h-5 bg-gray-200 shrink-0" />

                                                    <div className="flex items-center gap-0.5">
                                                        {STYLE_OPTS.map(opt => (
                                                            <button
                                                                key={opt.value} type="button" title={opt.title}
                                                                onClick={() => update(slot.id, { fontStyle: opt.value })}
                                                                className={`w-7 h-7 rounded text-xs transition-colors select-none ${opt.value === 'bold' ? 'font-bold' : opt.value === 'italic' ? 'italic' : ''
                                                                    } ${def.fontStyle === opt.value
                                                                        ? 'bg-orange-500 text-white'
                                                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                                                    }`}
                                                            >
                                                                {opt.label}
                                                            </button>
                                                        ))}
                                                    </div>

                                                    <div className="w-px h-5 bg-gray-200 shrink-0" />

                                                    <div className="flex items-center gap-0.5">
                                                        {ALIGN_OPTS.map(opt => (
                                                            <button
                                                                key={opt.value} type="button" title={opt.title}
                                                                onClick={() => update(slot.id, { align: opt.value })}
                                                                className={`w-7 h-7 rounded text-xs font-semibold transition-colors select-none ${def.align === opt.value
                                                                    ? 'bg-orange-500 text-white'
                                                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                                                    }`}
                                                            >
                                                                {opt.label}
                                                            </button>
                                                        ))}
                                                    </div>

                                                    {/* Preview ao vivo (só no modo Texto com valor) */}
                                                    {mode === 'text' && def.value && (
                                                        <>
                                                            <div className="w-px h-5 bg-gray-200 shrink-0" />
                                                            <span
                                                                className="text-xs px-2 py-0.5 rounded border border-dashed border-gray-300 max-w-[180px] truncate"
                                                                style={{
                                                                    color: def.color ?? '#000000',
                                                                    fontSize: `${Math.min(def.fontSize, 14)}px`,
                                                                    fontWeight: def.fontStyle === 'bold' ? 'bold' : 'normal',
                                                                    fontStyle: def.fontStyle === 'italic' ? 'italic' : 'normal',
                                                                    fontFamily: def.fontFamily === 'times' ? 'Georgia, serif'
                                                                        : def.fontFamily === 'courier' ? 'Courier New, monospace'
                                                                            : def.fontFamily === 'century-gothic' ? '"Century Gothic", CenturyGothic, AppleGothic, sans-serif'
                                                                                : 'Helvetica, Arial, sans-serif',
                                                                }}
                                                            >
                                                                {def.value}
                                                            </span>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="mt-5 bg-white border border-gray-200 rounded-lg p-5 flex items-center gap-4">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="bg-orange-600 text-white px-8 py-2.5 rounded-lg text-sm font-bold hover:bg-orange-700 disabled:opacity-40 transition-colors flex items-center gap-2"
                >
                    {saving ? <><span className="animate-spin inline-block">⟳</span> Salvando...</> : 'Salvar Configuração'}
                </button>
                {saved && <span className="text-sm text-emerald-600 font-semibold">✓ Salvo com sucesso</span>}
            </div>

        </div>
    );
}
