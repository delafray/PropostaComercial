import React, { useState, useEffect } from 'react';
import TemplateManager from './components/TemplateManager';
import NovaPropostaPage from './components/NovaPropostaPage';
import GerarPdfPage from './components/GerarPdfPage';
import ConfiguracaoPage from './components/ConfiguracaoPage';
import MascarasPage from './components/MascarasPage';
import Layout from '../../../components/Layout';
import { supabase } from '../../../services/supabaseClient';
import { templateService } from './services/templateService';
import { TemplateMascara } from './types';

type View = 'mascara' | 'nova' | 'gerar' | 'templates' | 'config';

// ── Modal: Nova Máscara ───────────────────────────────────────────────────────
function NovaMascaraModal({ onConfirm, onCancel }: {
  onConfirm: (nome: string, formato: 'A4' | '16:9') => void;
  onCancel: () => void;
}) {
  const [nome, setNome] = useState('');
  const [formato, setFormato] = useState<'A4' | '16:9' | null>(null);
  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
        <h2 className="text-lg font-bold text-gray-800 mb-1">Nova Máscara</h2>
        <p className="text-sm text-gray-400 mb-5">Defina o formato e o nome antes de carregar o PDF.</p>

        <p className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Formato</p>
        <div className="flex gap-3 mb-5">
          <button type="button" onClick={() => setFormato('A4')}
            className={`flex-1 py-3 border-2 rounded-lg text-sm font-bold transition-all ${formato === 'A4' ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-500 hover:border-orange-300'}`}>
            A4<br /><span className="text-xs font-normal text-gray-400">210 × 297 mm</span>
          </button>
          <button type="button" onClick={() => setFormato('16:9')}
            className={`flex-1 py-3 border-2 rounded-lg text-sm font-bold transition-all ${formato === '16:9' ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-500 hover:border-orange-300'}`}>
            16:9<br /><span className="text-xs font-normal text-gray-400">Proporcional</span>
          </button>
        </div>

        <p className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Nome da Máscara</p>
        <input
          type="text"
          value={nome}
          onChange={e => setNome(e.target.value)}
          placeholder="Ex: Máscara Padrão 2026"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-5 focus:outline-none focus:ring-2 focus:ring-orange-400"
        />

        <div className="flex gap-3">
          <button
            onClick={() => { if (nome.trim() && formato) onConfirm(nome.trim(), formato); }}
            disabled={!nome.trim() || !formato}
            className="flex-1 bg-orange-500 text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Gerar Nova Máscara
          </button>
          <button onClick={onCancel}
            className="flex-1 border border-gray-200 text-gray-600 text-sm font-semibold py-2.5 rounded-lg hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Selecionar Máscara para Editar ─────────────────────────────────────
function EditarMascaraModal({ onPick, onCancel }: {
  onPick: (mascaraId: string, mascaraNome: string) => void;
  onCancel: () => void;
}) {
  const [mascaras, setMascaras] = useState<TemplateMascara[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    templateService.getMascaras()
      .then((lista: TemplateMascara[]) => { setMascaras(lista); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);
  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
        <h2 className="text-lg font-bold text-gray-800 mb-1">Editar Máscara</h2>
        <p className="text-sm text-gray-400 mb-4">Selecione qual máscara deseja editar.</p>

        {loading && <p className="text-sm text-gray-400 text-center py-4">Carregando...</p>}
        {!loading && mascaras.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-4">Nenhuma máscara cadastrada.</p>
        )}
        {!loading && mascaras.length > 0 && (
          <div className="space-y-2 mb-4">
            {mascaras.map((mc: TemplateMascara) => (
              <button
                key={mc.id}
                onClick={() => onPick(mc.id, mc.nome)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 bg-white hover:border-orange-300 hover:bg-orange-50 text-left transition-all"
              >
                <span className="flex-1 text-sm font-medium text-gray-700">{mc.nome}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${mc.formato === 'A4' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'}`}>
                  {mc.formato ?? 'A4'}
                </span>
              </button>
            ))}
          </div>
        )}

        <button onClick={onCancel}
          className="w-full border border-gray-200 text-gray-600 text-sm font-semibold py-2.5 rounded-lg hover:bg-gray-50 transition-colors">
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ── Módulo principal ──────────────────────────────────────────────────────────
export default function PropostaComercial() {
  const [view, setView] = useState<View>('nova');
  const [isAdmin, setIsAdmin] = useState(false);
  const [gerarAutoMode, setGerarAutoMode] = useState(false);
  const [sessionFontSize, setSessionFontSize] = useState<number>(7);

  // Templates — Nova Máscara modal
  const [showNovaMascaraModal, setShowNovaMascaraModal] = useState(false);
  const [templatePreNome, setTemplatePreNome] = useState('');
  const [templatePreFormato, setTemplatePreFormato] = useState<'A4' | '16:9' | null>(null);

  // Templates — Editar Máscara modal
  const [showEditarModal, setShowEditarModal] = useState(false);
  const [mascaraIdParaEditar, setMascaraIdParaEditar] = useState<string | null>(null);
  const [mascaraNomeParaEditar, setMascaraNomeParaEditar] = useState<string>('');

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('users')
        .select('is_projetista, is_admin')
        .eq('id', user.id)
        .maybeSingle();
      setIsAdmin(!!(data?.is_projetista || data?.is_admin));
    })();
  }, []);

  const tabs = [
    { key: 'nova' as View, label: 'Registro de Projeto' },
    { key: 'gerar' as View, label: '⬇ Gerar PDF' },
    ...(isAdmin ? [{ key: 'templates' as View, label: 'Templates' }] : []),
    ...(isAdmin ? [{ key: 'config' as View, label: '⚙ Configuração' }] : []),
  ];

  const subItem = (label: string, active: boolean, onClick: () => void) => (
    <button
      key={label}
      onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
        active
          ? 'bg-blue-50 text-blue-700 font-semibold'
          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
      }`}
    >
      {label}
    </button>
  );

  const sidebarExtra = (
    <div className="ml-4 mt-0.5 mb-1 space-y-0.5 border-l-2 border-blue-100 pl-3">
      {subItem('Máscaras', view === 'mascara', () => setView('mascara'))}
      {isAdmin && subItem('Nova Máscara', showNovaMascaraModal, () => setShowNovaMascaraModal(true))}
      {isAdmin && subItem('Editar Máscara', showEditarModal, () => setShowEditarModal(true))}
    </div>
  );

  function abrirNovaMascara(nome: string, formato: 'A4' | '16:9') {
    setTemplatePreNome(nome);
    setTemplatePreFormato(formato);
    setMascaraIdParaEditar(null);
    setShowNovaMascaraModal(false);
    setView('templates');
  }

  function abrirEditarMascara(mascaraId: string, mascaraNome: string) {
    setMascaraIdParaEditar(mascaraId);
    setMascaraNomeParaEditar(mascaraNome);
    setTemplatePreNome('');
    setTemplatePreFormato(null);
    setShowEditarModal(false);
    setView('templates');
  }

  function sairDeTemplates() {
    setTemplatePreNome('');
    setTemplatePreFormato(null);
    setMascaraIdParaEditar(null);
    setMascaraNomeParaEditar('');
  }

  // Título só reflete a sessão de edição quando está na aba Templates
  const modoEdicao = !!(mascaraIdParaEditar && mascaraNomeParaEditar);
  const modoNovaMascara = !!(templatePreFormato && templatePreNome);
  const emTemplates = view === 'templates';
  const pageTitle = emTemplates && modoEdicao
    ? `Editando Máscara: ${mascaraNomeParaEditar}`
    : emTemplates && modoNovaMascara
      ? `Nova Máscara: ${templatePreNome}`
      : 'Proposta Comercial';

  return (
    <Layout title={pageTitle} sidebarExtra={sidebarExtra}>
      <div className="p-2 sm:p-4">

        {/* Navegação do módulo - Sticky (oculta em Máscaras) */}
        {view !== 'mascara' && (
          <div className="sticky top-[64px] sm:top-[72px] z-[105] bg-slate-50/95 backdrop-blur-sm -mx-2 px-2 pt-2 flex items-end justify-between border-b border-gray-200 mb-6">
            <div className="flex">
              {tabs.map(item => (
                <button
                  key={item.key}
                  onClick={() => setView(item.key)}
                  className={`px-5 py-2.5 text-sm font-semibold transition-colors border-b-2 -mb-px ${view === item.key
                      ? 'border-orange-500 text-orange-600 bg-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {/* Indicador de sessão ativa + botão encerrar */}
            {(modoEdicao || modoNovaMascara) && (
              <div className="flex items-center gap-2 pb-2 pr-1">
                <span className="text-xs text-orange-600 font-medium truncate max-w-[180px]">
                  {modoEdicao ? `✏️ ${mascaraNomeParaEditar}` : `✨ ${templatePreNome}`}
                </span>
                <button
                  onClick={sairDeTemplates}
                  title="Encerrar sessão de edição"
                  className="text-xs text-gray-400 hover:text-red-500 border border-gray-200 hover:border-red-200 hover:bg-red-50 px-2 py-0.5 rounded transition-colors"
                >
                  ✕ Encerrar
                </button>
              </div>
            )}
          </div>
        )}

        {view === 'mascara' && <MascarasPage onRenderizarPdf={(fontSize) => { setSessionFontSize(fontSize); setGerarAutoMode(true); }} />}
        {view === 'nova' && <NovaPropostaPage onSaved={() => setView('gerar')} />}
        {view === 'gerar' && <GerarPdfPage onGoToNova={() => setView('nova')} />}
        {view === 'templates' && isAdmin && (
          <TemplateManager
            preNome={templatePreNome}
            preFormato={templatePreFormato ?? undefined}
            mascaraIdParaEditar={mascaraIdParaEditar}
          />
        )}
        {view === 'config' && isAdmin && <ConfiguracaoPage mascaraId={mascaraIdParaEditar} />}

        {/* Overlay de geração rápida — renderizado por cima sem trocar de view */}
        {gerarAutoMode && <GerarPdfPage autoGenerate onComplete={() => setGerarAutoMode(false)} forceMascaraId={mascaraIdParaEditar} sessionFontSize={sessionFontSize} />}

        {/* Modal: Nova Máscara */}
        {showNovaMascaraModal && (
          <NovaMascaraModal
            onConfirm={abrirNovaMascara}
            onCancel={() => setShowNovaMascaraModal(false)}
          />
        )}

        {/* Modal: Selecionar Máscara para Editar */}
        {showEditarModal && (
          <EditarMascaraModal
            onPick={abrirEditarMascara}
            onCancel={() => setShowEditarModal(false)}
          />
        )}

      </div>
    </Layout>
  );
}
