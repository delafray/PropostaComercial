// Script pontual: copia config de slots da página 2 para páginas 3-6 de uma máscara.
// Uso: node scripts/copiar_slots_pg2.mjs
// Requer: npm install @supabase/supabase-js (já instalado no projeto)

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zamknopwowugrjapoman.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphbWtub3B3b3d1Z3JqYXBvbWFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2NzQ3MTQsImV4cCI6MjA4NjI1MDcxNH0.0KM5gxnhaErM90a6RrYs7HHsBCrer8uQb97KUoTkHNE';

// ── CONFIGURE AQUI ──────────────────────────────────────────────────────────────
const MASCARA_NOME = 'RBARROS PADRÃO A4'; // nome da máscara a buscar
const PAGINA_ORIGEM = 2;                  // página que já foi configurada
const PAGINAS_DESTINO = [3, 4, 5, 6];     // páginas que vão receber a cópia
const EMAIL = 'ronaldo@galeria.local'; // e-mail do usuário para autenticar
const SENHA = '';               // preencha com sua senha aqui
// ───────────────────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function main() {
    if (!SENHA) {
        console.error('❌ Preencha a SENHA no script antes de rodar.');
        process.exit(1);
    }

    // 1. Autenticar
    console.log('🔐 Autenticando...');
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({ email: EMAIL, password: SENHA });
    if (authErr) { console.error('❌ Erro de autenticação:', authErr.message); process.exit(1); }
    const userId = authData.user.id;
    console.log('✅ Autenticado como', EMAIL);

    // 2. Buscar ID da máscara pelo nome
    console.log(`🔍 Buscando máscara "${MASCARA_NOME}"...`);
    const { data: mascaras, error: mcErr } = await supabase
        .from('pc_templates_mascara')
        .select('id, nome')
        .ilike('nome', MASCARA_NOME);
    if (mcErr) { console.error('❌ Erro ao buscar máscara:', mcErr.message); process.exit(1); }
    if (!mascaras || mascaras.length === 0) { console.error('❌ Máscara não encontrada.'); process.exit(1); }
    const mascara = mascaras[0];
    console.log(`✅ Máscara encontrada: ${mascara.nome} (${mascara.id})`);

    // 3. Carregar prefs do usuário para essa máscara
    const chave = `slot_defaults_${mascara.id}`;
    console.log(`📦 Lendo preferências (chave: ${chave})...`);
    const { data: prefRow, error: prefErr } = await supabase
        .from('pc_user_prefs')
        .select('valor')
        .eq('user_id', userId)
        .eq('chave', chave)
        .maybeSingle();
    if (prefErr) { console.error('❌ Erro ao carregar prefs:', prefErr.message); process.exit(1); }
    if (!prefRow) { console.error('❌ Nenhuma preferência salva para esta máscara. Configure a página 2 primeiro.'); process.exit(1); }

    const valor = prefRow.valor;
    console.log(`📋 ${Object.keys(valor).length} slots encontrados nas prefs.`);

    // 4. Filtrar slots da página de origem (padrão: s2_*)
    const prefixoOrigem = `s${PAGINA_ORIGEM}_`;
    const slotsOrigem = Object.entries(valor).filter(([k]) => k.startsWith(prefixoOrigem));
    if (slotsOrigem.length === 0) {
        console.error(`❌ Nenhum slot com prefixo "${prefixoOrigem}" encontrado nas prefs.`);
        console.log('Chaves disponíveis:', Object.keys(valor).slice(0, 20).join(', '));
        process.exit(1);
    }
    console.log(`✅ ${slotsOrigem.length} slot(s) da página ${PAGINA_ORIGEM} encontrados:`, slotsOrigem.map(([k]) => k).join(', '));

    // 5. Clonar para páginas destino
    const novoValor = { ...valor };
    for (const pag of PAGINAS_DESTINO) {
        const prefixoDestino = `s${pag}_`;
        let copiados = 0;
        for (const [key, config] of slotsOrigem) {
            const novaChave = key.replace(prefixoOrigem, prefixoDestino);
            novoValor[novaChave] = { ...config };
            copiados++;
        }
        console.log(`📄 Página ${pag}: ${copiados} slot(s) copiados.`);
    }

    // 6. Salvar
    console.log('💾 Salvando...');
    const { error: saveErr } = await supabase
        .from('pc_user_prefs')
        .upsert(
            { user_id: userId, chave, valor: novoValor, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,chave' }
        );
    if (saveErr) { console.error('❌ Erro ao salvar:', saveErr.message); process.exit(1); }

    console.log('✅ Pronto! Recarregue a aba Configuração no sistema para ver as mudanças.');
}

main().catch(e => { console.error(e); process.exit(1); });
