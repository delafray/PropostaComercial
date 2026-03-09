// Script: autocompletar.mjs
// Objetivo: Clona fielmente da Pág Mestre para Alvo, com suporte a múltiplas rodadas, offsets e resets.
// Uso: node scripts/autocompletar.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zamknopwowugrjapoman.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphbWtub3B3b3d1Z3JqYXBvbWFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2NzQ3MTQsImV4cCI6MjA4NjI1MDcxNH0.0KM5gxnhaErM90a6RrYs7HHsBCrer8uQb97KUoTkHNE';

// ── CONFIGURE AQUI ──────────────────────────────────────────────────────────────
const ORIGEM_ID = '98eef133-3b93-4f7d-9f77-f652a31d3906'; // Máscara Mestre
const DESTINO_ID = '7fe536bc-e975-4371-b055-7ce72c71bf90'; // Máscara Alvo (7fe5)
const EMAIL = 'ronaldo@galeria.local';
const SENHA = ''; // Preencha sua senha para rodar

// Múltiplas execuções configuradas conforme pedido
const EXECUCOES = [
    { targetPag: 1, refPag: 1, offset: 0, skipTargetSlots: [], reset: true },
    { targetPag: 2, refPag: 2, offset: 0, skipTargetSlots: [], reset: true },
    { targetPag: 3, refPag: 2, offset: 1, skipTargetSlots: [4], startRefSlot: 4, reset: true }
];
// ───────────────────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function main() {
    if (!SENHA) { console.error('❌ ERRO: Informe a SENHA no script.'); process.exit(1); }

    console.log('🔐 Autenticando...');
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({ email: EMAIL, password: SENHA });
    if (authErr) { console.error('❌ Erro Auth:', authErr.message); process.exit(1); }
    const userId = authData.user.id;

    // 1. Validar Estrutura da Máscara Alvo
    const { data: mcData } = await supabase.from('pc_templates_mascara').select('paginas_config').eq('id', DESTINO_ID).single();
    if (!mcData) { console.error('❌ Erro: Máscara destino não encontrada.'); process.exit(1); }

    const slotsValidos = new Set();
    mcData.paginas_config.forEach(p => p.slots?.forEach(s => slotsValidos.add(s.id)));

    // 2. Carregar Preferências (Origem e Destino)
    const { data: prefOrigem } = await supabase.from('pc_user_prefs').select('valor').eq('user_id', userId).eq('chave', `slot_defaults_${ORIGEM_ID}`).maybeSingle();
    const { data: prefDestino } = await supabase.from('pc_user_prefs').select('valor').eq('user_id', userId).eq('chave', `slot_defaults_${DESTINO_ID}`).maybeSingle();

    const valorMestreTotal = prefOrigem?.valor || {};
    let novoValor = prefDestino?.valor || {};

    let totalGeralAlterados = 0;

    // 3. Rodar cada execução configurada
    for (const exec of EXECUCOES) {
        console.log(`\n🚀 Rodada: Pág Referência ${exec.refPag} -> Pág Destino ${exec.targetPag}${exec.reset ? ' (Com Reset)' : ''}`);

        // Limpa a página de destino se o reset estiver ativo
        if (exec.reset) {
            const prefixoAlvo = `s${exec.targetPag}_`;
            Object.keys(novoValor).forEach(k => {
                if (k.startsWith(prefixoAlvo)) delete novoValor[k];
            });
        }

        let alteradosRodada = 0;
        const prefixoRef = `s${exec.refPag}_`;
        const chavesMestre = Object.keys(valorMestreTotal)
            .filter(k => k.startsWith(prefixoRef))
            .sort((a, b) => parseInt(a.split('_')[1]) - parseInt(b.split('_')[1]));

        for (const chaveOrigem of chavesMestre) {
            const numSlotOrigem = parseInt(chaveOrigem.split('_')[1]);

            // Aplica o offset se o slot for maior ou igual ao ponto de partida
            let numSlotAlvo = numSlotOrigem;
            if (exec.startRefSlot && numSlotOrigem >= exec.startRefSlot) {
                numSlotAlvo += exec.offset;
            }

            const chaveAlvo = `s${exec.targetPag}_${numSlotAlvo}`;

            // Pula se for um slot explicitamente ignorado no destino
            if (exec.skipTargetSlots.includes(numSlotAlvo)) {
                console.log(`- Slot ${chaveAlvo} ignorado por configuração.`);
                continue;
            }

            // Só mexe se for um slot real da máscara
            if (!slotsValidos.has(chaveAlvo)) {
                continue;
            }

            const configMestre = valorMestreTotal[chaveOrigem];
            const configAtual = novoValor[chaveAlvo];

            // Só preenche se estiver vazio ou se resetamos a página
            const estaVazio = !configAtual || (configAtual.mode === 'text' && (!configAtual.value || configAtual.value.trim() === ''));

            if (estaVazio) {
                novoValor[chaveAlvo] = JSON.parse(JSON.stringify(configMestre));
                alteradosRodada++;
            }
        }
        console.log(`✅ Finalizado rodada: ${alteradosRodada} slots preenchidos.`);
        totalGeralAlterados += alteradosRodada;
    }

    if (totalGeralAlterados === 0) {
        console.log('\n⏹️ Nada para preencher em nenhuma das rodadas planeadas.');
        return;
    }

    // 4. Salvar tudo
    console.log(`\n💾 Salvando um total de ${totalGeralAlterados} alterações...`);
    const { error: saveErr } = await supabase.from('pc_user_prefs').upsert({
        user_id: userId,
        chave: `slot_defaults_${DESTINO_ID}`,
        valor: novoValor,
        updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,chave' });

    if (saveErr) { console.error('❌ Erro Save:', saveErr.message); process.exit(1); }
    console.log('✨ Tudo pronto! O autocompletar completo com desvios foi finalizado.');
}

main().catch(console.error);
