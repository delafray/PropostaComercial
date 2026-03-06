import React, { useState } from 'react';
import TemplateManager from './components/TemplateManager';
import NovaPropostaPage from './components/NovaPropostaPage';
import GerarPdfPage from './components/GerarPdfPage';
import ConfiguracaoPage from './components/ConfiguracaoPage';
import Layout from '../../../components/Layout';

type View = 'nova' | 'gerar' | 'templates' | 'config';

export default function PropostaComercial() {
  const [view, setView] = useState<View>('nova');

  return (
    <Layout title="Proposta Comercial">
      <div className="p-2 sm:p-4">

        {/* Navegação do módulo - Sticky */}
        <div className="sticky top-[64px] sm:top-[72px] z-[105] bg-slate-50/95 backdrop-blur-sm -mx-2 px-2 pt-2 flex border-b border-gray-200 mb-6">
          {([
            { key: 'nova' as View, label: '+ Nova Proposta' },
            { key: 'gerar' as View, label: '⬇ Gerar PDF' },
            { key: 'templates' as View, label: 'Templates' },
            { key: 'config' as View, label: '⚙ Configuração' },
          ] as const).map(item => (
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

        {view === 'nova' && <NovaPropostaPage onSaved={() => setView('gerar')} />}
        {view === 'gerar' && <GerarPdfPage onGoToNova={() => setView('nova')} />}
        {view === 'templates' && <TemplateManager />}
        {view === 'config' && <ConfiguracaoPage />}

      </div>
    </Layout>
  );
}
