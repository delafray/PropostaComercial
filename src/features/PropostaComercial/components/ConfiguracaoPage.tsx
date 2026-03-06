// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { templateService } from '../services/templateService';
import { prefService } from '../services/prefService';
import { TemplateMascara, PaginaConfig, SlotElemento } from '../types';

export interface SlotDefault {
    value: string;
    fontSize: number;
}
export type SlotDefaults = Record<string, SlotDefault>;

export function prefKeyForMascara(mascaraId: string) {
    return `slot_defaults_${mascaraId}`;
}

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
                const saved = await prefService.loadPref(prefKeyForMascara(mc.id)).catch(() => null);
                const savedDefaults = (saved as SlotDefaults) ?? {};
                const init: SlotDefaults = {};
                for (const pagina of mc.paginas_config) {
                    for (const slot of pagina.slots ?? []) {
                        init[slot.id] = savedDefaults[slot.id] ?? { value: '', fontSize: slot.font_size ?? 12 };
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

    function setValue(slotId: string, value: string) {
        setSaved(false);
        setDefaults(prev => ({ ...prev, [slotId]: { ...prev[slotId], value } }));
    }

    function setFontSize(slotId: string, fontSize: number) {
        setSaved(false);
        setDefaults(prev => ({ ...prev, [slotId]: { ...prev[slotId], fontSize } }));
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
                            <div className="p-4 space-y-3">
                                {allSlots.map((slot: SlotElemento) => {
                                    const fullName = `pag_${pageNum}-${slot.nome}`;
                                    const def = defaults[slot.id] ?? { value: '', fontSize: slot.font_size ?? 12 };
                                    return (
                                        <div key={slot.id} className="flex items-center gap-3">
                                            <div className="w-44 shrink-0">
                                                <p className="text-xs font-semibold text-gray-700 font-mono truncate" title={fullName}>
                                                    {fullName}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                <input
                                                    type="number"
                                                    min={6}
                                                    max={72}
                                                    value={def.fontSize}
                                                    onChange={e => setFontSize(slot.id, Number(e.target.value))}
                                                    className="w-12 border border-gray-300 rounded px-1 py-1.5 text-xs text-center focus:outline-none focus:border-orange-400"
                                                />
                                                <span className="text-[10px] text-gray-400">pt</span>
                                            </div>
                                            <input
                                                type="text"
                                                value={def.value}
                                                onChange={e => setValue(slot.id, e.target.value)}
                                                placeholder={`Valor padrão para ${fullName}`}
                                                className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
                                            />
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
