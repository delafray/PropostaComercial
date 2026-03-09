// !! REGRA N1: JAMAIS apague/mova arquivos fora de C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\ — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.
import React, { useState } from 'react';
import Layout from '../../../components/Layout';
import MascarasPage from './components/MascarasPage';
import GerarPdfPage from './components/GerarPdfPage';

export default function MascarasModule() {
  const [gerarAutoMode, setGerarAutoMode] = useState(false);
  const [sessionFontSize, setSessionFontSize] = useState<number>(7);
  const [gerarMascaraId, setGerarMascaraId] = useState<string | null>(null);

  return (
    <Layout title="Mascaras">
      <div className="p-2 sm:p-4">
        <MascarasPage
          onRenderizarPdf={(fontSize, mascaraId) => {
            setSessionFontSize(fontSize);
            setGerarMascaraId(mascaraId);
            setGerarAutoMode(true);
          }}
        />

        {/* Overlay de geração rápida */}
        {gerarAutoMode && (
          <GerarPdfPage
            autoGenerate
            onComplete={() => setGerarAutoMode(false)}
            forceMascaraId={gerarMascaraId}
            sessionFontSize={sessionFontSize}
          />
        )}
      </div>
    </Layout>
  );
}
