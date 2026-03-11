// !! REGRA N1: JAMAIS apague/mova arquivos fora de C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\ — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.
import { supabase } from './supabaseClient';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

// ─── TYPES ──────────────────────────────────────────────────────────────────
export interface BackupProgressCallback {
    (info: { phase: 'db' | 'storage' | 'source' | 'zipping' | 'done' | ''; label: string; pct: number }): void;
}

interface IntrospectResult {
    tables: { name: string; columns: { name: string; udt: string; nullable: boolean; has_default: boolean }[] }[];
    fk_deps: { from_table: string; to_table: string }[];
    functions: { name: string; def: string }[];
    policies: { tablename: string; policyname: string; permissive: string; cmd: string; roles: string[]; qual: string | null; with_check: string | null }[];
}

// ─── CONCURRENCY ────────────────────────────────────────────────────────────
const CONCURRENT_DOWNLOADS = 8;

// ─── FILES THAT ARE ALREADY COMPRESSED ──────────────────────────────────────
const BINARY_MEDIA_RE = /\.(jpg|jpeg|png|gif|webp|avif|heic|mp4|mov|avi|mkv|pdf|zip|7z|rar|gz|webm)$/i;
function isMedia(path: string) { return BINARY_MEDIA_RE.test(path); }

// ─── STORAGE BUCKETS ────────────────────────────────────────────────────────
const STORAGE_BUCKETS = ['photos', 'avatars', 'assets', 'system', 'pc_arquivos', 'edicao-docs'];

// ─── FALLBACK TABLE LIST (usado se backup_introspect() não existir) ─────────
const BACKUP_TABLES_FALLBACK = [
    'users', 'system_config', 'tag_categories', 'tags', 'photos', 'photo_tags',
    'user_biometrics', 'eventos', 'eventos_edicoes', 'clientes', 'contatos',
    'enderecos', 'contratos', 'itens_opcionais', 'planilha_configuracoes',
    'planilha_vendas_estandes', 'atendimentos', 'atendimentos_historico',
    'tarefas', 'tarefas_historico', 'stand_imagens_status', 'stand_imagem_recebimentos',
    'edicao_imagens_config',
    // PropostaComercial
    'pc_templates_mascara', 'pc_templates_backdrop', 'pc_templates_referencia',
    'pc_propostas', 'pc_user_prefs',
];

// ─── MIGRATIONS (embutidas em build-time via Vite) ──────────────────────────
const migModules = import.meta.glob(
    '../supabase/migrations/*.sql',
    { query: '?raw', import: 'default', eager: true }
) as Record<string, string>;

// ─── SOURCE CODE (embutido em build-time via Vite) ──────────────────────────
const sourceModules = import.meta.glob(
    [
        '../features/**/*.{ts,tsx}',
        '../pages/**/*.{ts,tsx}',
        '../components/**/*.{ts,tsx}',
        '../hooks/**/*.{ts,tsx}',
        '../services/**/*.{ts,tsx}',
        '../utils/**/*.{ts,tsx}',
        '../supabase/**/*.{sql,ts}',
        '../App.tsx',
        '../index.tsx',
        '../index.css',
        '../types.ts',
        '../database.types.ts',
        '../version.ts',
        '../vite-env.d.ts',
    ],
    { query: '?raw', import: 'default', eager: true }
) as Record<string, string>;

// ─── TOPOLOGICAL SORT ───────────────────────────────────────────────────────
function topoSort(tableNames: string[], fkDeps: { from_table: string; to_table: string }[]): string[] {
    const nameSet = new Set(tableNames);
    const graph = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();

    for (const t of tableNames) {
        graph.set(t, new Set());
        inDegree.set(t, 0);
    }

    for (const { from_table, to_table } of fkDeps) {
        if (!nameSet.has(from_table) || !nameSet.has(to_table)) continue;
        if (from_table === to_table) continue; // self-reference
        graph.get(to_table)!.add(from_table);
        inDegree.set(from_table, (inDegree.get(from_table) ?? 0) + 1);
    }

    const queue: string[] = [];
    for (const [t, deg] of inDegree) {
        if (deg === 0) queue.push(t);
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
        const node = queue.shift()!;
        sorted.push(node);
        for (const dep of graph.get(node) ?? []) {
            const newDeg = (inDegree.get(dep) ?? 1) - 1;
            inDegree.set(dep, newDeg);
            if (newDeg === 0) queue.push(dep);
        }
    }

    // Tabelas com ciclos vão no final
    for (const t of tableNames) {
        if (!sorted.includes(t)) sorted.push(t);
    }

    return sorted;
}

// ─── GENERATE FUNCTIONS DDL ─────────────────────────────────────────────────
function generateFunctionsDDL(functions: IntrospectResult['functions']): string {
    if (!functions || functions.length === 0) {
        return '-- Nenhuma função encontrada no schema public.\n';
    }

    let sql = `-- ============================================================\n`;
    sql += `-- FUNÇÕES POSTGRESQL — Schema public\n`;
    sql += `-- Extraídas ao vivo via pg_get_functiondef(oid)\n`;
    sql += `-- Gerado em: ${new Date().toISOString()}\n`;
    sql += `-- ============================================================\n\n`;

    for (const fn of functions) {
        sql += `-- ── Função: ${fn.name} ──\n`;
        sql += `${fn.def};\n\n`;
    }

    // Re-grant EXECUTE para authenticated
    sql += `-- ── Re-grant EXECUTE ──\n`;
    sql += `DO $$\nDECLARE fn_name text;\nBEGIN\n`;
    sql += `    FOR fn_name IN\n`;
    sql += `        SELECT routine_name FROM information_schema.routines\n`;
    sql += `        WHERE routine_schema = 'public'\n`;
    sql += `    LOOP\n`;
    sql += `        BEGIN\n`;
    sql += `            EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I TO authenticated', fn_name);\n`;
    sql += `        EXCEPTION WHEN OTHERS THEN NULL;\n`;
    sql += `        END;\n`;
    sql += `    END LOOP;\n`;
    sql += `END;$$;\n`;

    return sql;
}

// ─── GENERATE RLS POLICIES DDL ──────────────────────────────────────────────
function generatePoliciesDDL(policies: IntrospectResult['policies']): string {
    if (!policies || policies.length === 0) {
        return '-- Nenhuma política RLS encontrada no schema public.\n';
    }

    let sql = `-- ============================================================\n`;
    sql += `-- POLÍTICAS RLS — Schema public\n`;
    sql += `-- Extraídas ao vivo via pg_policies\n`;
    sql += `-- Gerado em: ${new Date().toISOString()}\n`;
    sql += `-- ============================================================\n\n`;

    // Enable RLS em todas as tabelas únicas
    const tables = [...new Set(policies.map(p => p.tablename))];
    for (const t of tables) {
        sql += `ALTER TABLE public."${t}" ENABLE ROW LEVEL SECURITY;\n`;
    }
    sql += '\n';

    // Criar cada policy
    for (const p of policies) {
        sql += `DROP POLICY IF EXISTS "${p.policyname}" ON public."${p.tablename}";\n`;
        sql += `CREATE POLICY "${p.policyname}" ON public."${p.tablename}"\n`;
        sql += `    AS ${p.permissive}\n`;
        sql += `    FOR ${p.cmd}\n`;
        sql += `    TO ${Array.isArray(p.roles) ? p.roles.join(', ') : p.roles}\n`;
        if (p.qual) sql += `    USING (${p.qual})\n`;
        if (p.with_check) sql += `    WITH CHECK (${p.with_check})\n`;
        sql += `;\n\n`;
    }

    return sql;
}

// ─── GENERATE COMBINED MIGRATIONS ───────────────────────────────────────────
function generateCombinedMigrations(): string {
    const entries = Object.entries(migModules)
        .map(([path, content]) => ({ filename: path.split('/').pop()!, content }))
        .sort((a, b) => a.filename.localeCompare(b.filename));

    if (entries.length === 0) return '-- Nenhuma migration encontrada.\n';

    let sql = `-- ============================================================\n`;
    sql += `-- TODAS AS MIGRATIONS COMBINADAS (${entries.length} arquivos)\n`;
    sql += `-- Gerado em: ${new Date().toISOString()}\n`;
    sql += `-- ============================================================\n\n`;

    for (const { filename, content } of entries) {
        sql += `-- ────────────────────────────────────────────────────────────\n`;
        sql += `-- Migration: ${filename}\n`;
        sql += `-- ────────────────────────────────────────────────────────────\n`;
        sql += `${content}\n\n`;
    }

    return sql;
}

// ─── INCLUDE SOURCE CODE ────────────────────────────────────────────────────
function includeSourceCode(zip: JSZip): number {
    const srcFolder = zip.folder('source_code')!;
    let count = 0;

    for (const [rawPath, content] of Object.entries(sourceModules)) {
        // rawPath é algo como "../features/PropostaComercial/components/GerarPdfPage.tsx"
        // Remover o "../" inicial
        const cleanPath = rawPath.replace(/^\.\.\/?/, '');
        srcFolder.file(cleanPath, content);
        count++;
    }

    return count;
}

// ─── AUTH USERS RESTORE SQL ─────────────────────────────────────────────────
function generateAuthRestoreSQL(users: any[]): string {
    const activeUsers = users.filter((u: any) => u.id && u.email);
    if (activeUsers.length === 0) return '-- Nenhum usuário para restaurar.\n';

    const TEMP_PASS = 'GaleriaRestore2024!';

    let sql = `-- ============================================================\n`;
    sql += `-- RESTAURAÇÃO DO SUPABASE AUTH (auth.users + auth.identities)\n`;
    sql += `-- ============================================================\n`;
    sql += `-- EXECUTE ANTES de qualquer outro arquivo!\n`;
    sql += `-- SENHA TEMPORÁRIA PARA TODOS: ${TEMP_PASS}\n`;
    sql += `-- ============================================================\n\n`;

    for (const u of activeUsers) {
        const createdAt = u.created_at || new Date().toISOString();
        const note = u.is_temp ? ' [TEMP]' : u.is_admin ? ' [ADMIN]' : '';
        const escaped = u.email.replace(/'/g, "''");

        sql += `-- ${u.name}${note} — ${u.email}\n`;

        sql += `INSERT INTO auth.users (\n`;
        sql += `    instance_id, id, aud, role, email,\n`;
        sql += `    encrypted_password, email_confirmed_at,\n`;
        sql += `    created_at, updated_at,\n`;
        sql += `    raw_app_meta_data, raw_user_meta_data,\n`;
        sql += `    is_super_admin, confirmation_token, recovery_token,\n`;
        sql += `    email_change_token_new, email_change\n`;
        sql += `) VALUES (\n`;
        sql += `    '00000000-0000-0000-0000-000000000000',\n`;
        sql += `    '${u.id}',\n`;
        sql += `    'authenticated', 'authenticated',\n`;
        sql += `    '${escaped}',\n`;
        sql += `    crypt('${TEMP_PASS}', gen_salt('bf')),\n`;
        sql += `    now(),\n`;
        sql += `    '${createdAt}', now(),\n`;
        sql += `    '{"provider":"email","providers":["email"]}',\n`;
        sql += `    '{}',\n`;
        sql += `    false, '', '', '', ''\n`;
        sql += `) ON CONFLICT (id) DO NOTHING;\n\n`;

        sql += `INSERT INTO auth.identities (\n`;
        sql += `    id, user_id, provider_id, identity_data,\n`;
        sql += `    provider, last_sign_in_at, created_at, updated_at\n`;
        sql += `) VALUES (\n`;
        sql += `    gen_random_uuid(),\n`;
        sql += `    '${u.id}',\n`;
        sql += `    '${escaped}',\n`;
        sql += `    '{"sub":"${u.id}","email":"${escaped}"}',\n`;
        sql += `    'email',\n`;
        sql += `    now(), '${createdAt}', now()\n`;
        sql += `) ON CONFLICT DO NOTHING;\n\n`;
    }

    return sql;
}

// ─── DDL INFERENCE (fallback para tabelas sem schema conhecido) ──────────────
function generateInferredDDL(tableName: string, rows: any[]): string {
    if (!rows || rows.length === 0) {
        return `-- AVISO: '${tableName}' está vazia — schema não pode ser inferido.\n` +
            `-- Crie esta tabela manualmente com base no código da aplicação.\n\n`;
    }
    const firstRow = rows[0];
    const cols = Object.entries(firstRow).map(([col, val]) => {
        let type: string;
        if (col === 'id') {
            type = 'UUID PRIMARY KEY DEFAULT gen_random_uuid()';
        } else if (col.endsWith('_id')) {
            type = 'UUID';
        } else if (col.endsWith('_at')) {
            type = 'TIMESTAMPTZ DEFAULT now()';
        } else if (typeof val === 'boolean') {
            type = 'BOOLEAN DEFAULT false';
        } else if (typeof val === 'number' && Number.isInteger(val)) {
            type = 'INTEGER DEFAULT 0';
        } else if (typeof val === 'number') {
            type = 'NUMERIC';
        } else if (Array.isArray(val)) {
            type = "JSONB DEFAULT '[]'";
        } else if (typeof val === 'object' && val !== null) {
            type = 'JSONB';
        } else {
            type = 'TEXT';
        }
        return `    "${col}" ${type}`;
    }).join(',\n');

    return `-- Schema INFERIDO AUTOMATICAMENTE para: ${tableName}\n` +
        `-- REVISE e ajuste tipos, NOT NULL e constraints antes de aplicar.\n` +
        `CREATE TABLE IF NOT EXISTS public."${tableName}" (\n${cols}\n);\n` +
        `ALTER TABLE public."${tableName}" ENABLE ROW LEVEL SECURITY;\n\n`;
}

// ─── DYNAMIC RESTORE GUIDE ─────────────────────────────────────────────────
function generateRestoreGuide(stats: {
    tableCount: number;
    functionCount: number;
    policyCount: number;
    bucketCount: number;
    sourceFileCount: number;
    migrationCount: number;
    dateStr: string;
}): string {
    return `# Guia de Restauração — Sistema Completo

Gerado automaticamente em: ${stats.dateStr}

---

## Resumo do Backup

| Item | Quantidade |
|------|-----------|
| Tabelas exportadas | ${stats.tableCount} |
| Funções PostgreSQL | ${stats.functionCount} |
| Políticas RLS | ${stats.policyCount} |
| Buckets de Storage | ${stats.bucketCount} |
| Arquivos de código-fonte | ${stats.sourceFileCount} |
| Migrations SQL | ${stats.migrationCount} |

---

## Estrutura do ZIP

\`\`\`
├── RESTORE_GUIDE.md                    ← Este arquivo
├── database/
│   ├── 1_auth_users_restore.sql        ← PRIMEIRO: recria auth.users com UUIDs originais
│   ├── 2_schema_all_migrations.sql     ← SEGUNDO: todas as migrations combinadas
│   ├── 3_schema_ddl_auto.sql           ← TERCEIRO: DDL inferido (alternativa/fallback)
│   ├── 4_database_backup.sql           ← QUARTO: dados de todas as tabelas
│   ├── 5_functions_ddl.sql             ← QUINTO: funções PostgreSQL
│   └── 6_rls_policies.sql              ← SEXTO: políticas RLS
├── schema_migrations/
│   └── *.sql (arquivos individuais de referência)
├── source_code/                        ← CÓDIGO-FONTE COMPLETO
│   └── (estrutura original do projeto)
└── storage_backup/
    └── (buckets com arquivos originais)
\`\`\`

---

## Passo a Passo — Restaurar em Novo Supabase

### Passo 1 — Criar novo projeto
Acesse supabase.com, crie novo projeto.
Anote: **URL**, **ANON_KEY**, **SERVICE_ROLE_KEY**.

### Passo 2 — Restaurar auth.users (CRÍTICO — PRIMEIRO!)
\`\`\`
database/1_auth_users_restore.sql
\`\`\`
Recria todos os usuários com UUIDs originais.
Senha temporária: \`GaleriaRestore2024!\`

### Passo 3 — Recriar schema
\`\`\`
database/2_schema_all_migrations.sql
\`\`\`
Se falhar, use \`3_schema_ddl_auto.sql\` como alternativa.

### Passo 4 — Restaurar dados
\`\`\`
database/4_database_backup.sql
\`\`\`
Já inclui \`SET session_replication_role = 'replica'\` para desativar FK validation.
Todos os INSERTs têm \`ON CONFLICT DO NOTHING\` (idempotente).

### Passo 5 — Recriar funções PostgreSQL
\`\`\`
database/5_functions_ddl.sql
\`\`\`
Contém DDL exato extraído ao vivo. Inclui re-grant automático de EXECUTE.

### Passo 6 — Restaurar políticas RLS
\`\`\`
database/6_rls_policies.sql
\`\`\`
Execute **após** o arquivo 5 (algumas políticas usam funções como \`is_admin()\`).

### Passo 7 — Restaurar Storage
Crie os buckets no novo projeto com os mesmos nomes.
Upload manual via Dashboard ou CLI:
\`\`\`bash
supabase storage cp --recursive ./storage_backup/photos/ supabase://photos/
supabase storage cp --recursive ./storage_backup/pc_arquivos/ supabase://pc_arquivos/
\`\`\`

### Passo 8 — Restaurar código-fonte
A pasta \`source_code/\` contém o código completo:
1. Copie para uma pasta nova
2. \`npm install\`
3. Crie \`.env.local\`:
   \`\`\`
   VITE_SUPABASE_URL=https://SEU-NOVO-PROJETO.supabase.co
   VITE_SUPABASE_ANON_KEY=sua-nova-anon-key
   \`\`\`
4. \`npm run dev\`

### Passo 9 — Corrigir URLs no banco
\`\`\`sql
UPDATE public.photos SET
    url = REPLACE(url, 'https://ANTIGO.supabase.co', 'https://NOVO.supabase.co'),
    thumbnail_url = REPLACE(thumbnail_url, 'https://ANTIGO.supabase.co', 'https://NOVO.supabase.co')
WHERE url LIKE '%ANTIGO.supabase.co%';
\`\`\`

### Passo 10 — Redefinir senhas
Todos os usuários restaurados têm a senha \`GaleriaRestore2024!\`.
Cada usuário deve redefinir após o primeiro login.

---

## Regras Críticas

| Regra | Detalhe |
|-------|---------|
| **Ordem obrigatória** | 1→auth → 2→schema → 4→dados → 5→funções → 6→RLS → 7→storage |
| **UUIDs preservados** | auth.users.id = public.users.id — nunca deixe mudar |
| **ON CONFLICT** | Todos os INSERTs são idempotentes — seguro rodar múltiplas vezes |
| **session_replication_role** | Desativada durante restore, reativada no final |
| **backup_introspect()** | Deve existir no banco para backups futuros serem automáticos |
`;
}

// ─── MAIN SERVICE ───────────────────────────────────────────────────────────
export const backupService = {
    /**
     * Backup completo: banco + storage + código-fonte + guia.
     * 100% automático via backup_introspect() + import.meta.glob.
     */
    async downloadFull(onProgress?: BackupProgressCallback): Promise<void> {
        const zip = new JSZip();
        const dateStr = new Date().toISOString().split('T')[0];

        // ── 1. Introspection do banco ─────────────────────────────────────
        onProgress?.({ phase: 'db', label: 'Consultando estrutura do banco...', pct: 2 });

        let introspect: IntrospectResult | null = null;
        try {
            const { data, error } = await supabase.rpc('backup_introspect');
            if (!error && data) introspect = data as IntrospectResult;
        } catch {
            console.warn('[backup] backup_introspect() não disponível — usando fallback');
        }

        // ── 2. Exportar banco de dados ────────────────────────────────────
        const tableNames = introspect?.tables?.map(t => t.name)
            ?? BACKUP_TABLES_FALLBACK;
        const fkDeps = introspect?.fk_deps ?? [];
        const sortedTables = topoSort(tableNames, fkDeps);

        onProgress?.({
            phase: 'db',
            label: `Exportando ${sortedTables.length} tabelas...`,
            pct: 5
        });

        // Busca TODAS as tabelas em paralelo
        const results = await Promise.all(
            sortedTables.map(async (tableName) => {
                const { data, error } = await supabase.from(tableName as any).select('*');
                return { tableName, data: data ?? [], error };
            })
        );

        onProgress?.({ phase: 'db', label: 'Gerando SQL...', pct: 20 });

        // ── 2a. database_backup.sql ───────────────────────────────────────
        const tableDataMap: Record<string, any[]> = {};
        let sqlContent = `-- ============================================================\n`;
        sqlContent += `-- Backup Completo — Todas as tabelas\n`;
        sqlContent += `-- Gerado em: ${new Date().toISOString()}\n`;
        sqlContent += `-- Tabelas: ${sortedTables.length} (ordem topológica por FK)\n`;
        sqlContent += `-- ============================================================\n\n`;
        sqlContent += `SET session_replication_role = 'replica';\n\n`;

        for (const tableName of sortedTables) {
            const result = results.find(r => r.tableName === tableName);
            if (!result) continue;

            const { data, error } = result;

            if (error) {
                if (error.code === '42P01') {
                    sqlContent += `-- Tabela '${tableName}' ignorada (não existe)\n\n`;
                } else {
                    sqlContent += `-- ERRO ao exportar '${tableName}': ${error.message}\n\n`;
                }
                continue;
            }

            tableDataMap[tableName] = data;

            if (!data || data.length === 0) {
                sqlContent += `-- Tabela '${tableName}': sem registros.\n\n`;
                continue;
            }

            sqlContent += `-- ── ${tableName} (${data.length} registros) ──\n`;
            for (const row of data) {
                const columns = Object.keys(row).map(c => `"${c}"`).join(', ');
                const values = Object.values(row).map(v => {
                    if (v === null || v === undefined) return 'NULL';
                    if (typeof v === 'boolean') return v ? 'true' : 'false';
                    if (typeof v === 'number') return v;
                    if (Array.isArray(v)) return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
                    if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
                    return `'${String(v).replace(/'/g, "''")}'`;
                }).join(', ');
                sqlContent += `INSERT INTO public."${tableName}" (${columns}) VALUES (${values}) ON CONFLICT DO NOTHING;\n`;
            }
            sqlContent += '\n';
        }

        sqlContent += `SET session_replication_role = DEFAULT;\n`;

        // ── 2b. DDL inferido (fallback) ───────────────────────────────────
        let schemaDDLAuto = `-- ============================================================\n`;
        schemaDDLAuto += `-- Schema DDL AUTO-INFERIDO (fallback se migrations falharem)\n`;
        schemaDDLAuto += `-- REVISE cuidadosamente antes de aplicar!\n`;
        schemaDDLAuto += `-- ============================================================\n\n`;
        schemaDDLAuto += `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";\n`;
        schemaDDLAuto += `CREATE EXTENSION IF NOT EXISTS "pgcrypto";\n\n`;
        for (const tableName of sortedTables) {
            schemaDDLAuto += generateInferredDDL(tableName, tableDataMap[tableName] ?? []);
        }

        onProgress?.({ phase: 'db', label: 'Gerando SQL de funções e políticas...', pct: 25 });

        // ── 2c. Funções e políticas ───────────────────────────────────────
        const functionsDDL = introspect
            ? generateFunctionsDDL(introspect.functions)
            : '-- backup_introspect() não disponível — funções não extraídas.\n-- Execute a migration 20260310_create_backup_introspect.sql e refaça o backup.\n';

        const policiesDDL = introspect
            ? generatePoliciesDDL(introspect.policies)
            : '-- backup_introspect() não disponível — políticas não extraídas.\n-- Execute a migration 20260310_create_backup_introspect.sql e refaça o backup.\n';

        // ── 2d. Auth restore ──────────────────────────────────────────────
        const authRestoreSQL = generateAuthRestoreSQL(tableDataMap['users'] ?? []);

        // ── 2e. Migrations combinadas ─────────────────────────────────────
        const combinedMigrations = generateCombinedMigrations();

        onProgress?.({ phase: 'db', label: 'Exportação do banco concluída.', pct: 29 });

        // ── 3. Montar pasta database/ ─────────────────────────────────────
        const dbFolder = zip.folder('database')!;
        dbFolder.file('1_auth_users_restore.sql', authRestoreSQL);
        dbFolder.file('2_schema_all_migrations.sql', combinedMigrations);
        dbFolder.file('3_schema_ddl_auto.sql', schemaDDLAuto);
        dbFolder.file('4_database_backup.sql', sqlContent);
        dbFolder.file('5_functions_ddl.sql', functionsDDL);
        dbFolder.file('6_rls_policies.sql', policiesDDL);

        // ── 4. Migrations individuais ─────────────────────────────────────
        const migrFolder = zip.folder('schema_migrations')!;
        const migEntries = Object.entries(migModules)
            .map(([path, content]) => ({ filename: path.split('/').pop()!, content }))
            .sort((a, b) => a.filename.localeCompare(b.filename));
        for (const { filename, content } of migEntries) {
            migrFolder.file(filename, content);
        }

        // ── 5. Storage ────────────────────────────────────────────────────
        onProgress?.({ phase: 'storage', label: 'Mapeando arquivos no Storage...', pct: 30 });
        let bucketsUsed = 0;
        const storageFolder = zip.folder('storage_backup')!;
        for (const bucket of STORAGE_BUCKETS) {
            try {
                const files = await this.listBucketFiles(bucket);
                if (files.length > 0) bucketsUsed++;
            } catch { /* bucket não existe */ }
        }
        await this.downloadStorageFiles(storageFolder, onProgress);

        // ── 6. Código-fonte ───────────────────────────────────────────────
        onProgress?.({ phase: 'source', label: 'Incluindo código-fonte...', pct: 80 });
        const sourceFileCount = includeSourceCode(zip);
        onProgress?.({ phase: 'source', label: `${sourceFileCount} arquivos incluídos.`, pct: 88 });

        // ── 7. Guia de restauração (dinâmico) ─────────────────────────────
        const restoreGuide = generateRestoreGuide({
            tableCount: sortedTables.length,
            functionCount: introspect?.functions?.length ?? 0,
            policyCount: introspect?.policies?.length ?? 0,
            bucketCount: bucketsUsed,
            sourceFileCount,
            migrationCount: migEntries.length,
            dateStr,
        });
        zip.file('RESTORE_GUIDE.md', restoreGuide);

        // ── 8. Compactar e download ───────────────────────────────────────
        onProgress?.({ phase: 'zipping', label: 'Compactando arquivo final...', pct: 89 });
        try {
            const content = await zip.generateAsync(
                { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 5 } },
                (metadata) => {
                    const pct = 89 + Math.floor(metadata.percent * 0.10);
                    onProgress?.({
                        phase: 'zipping',
                        label: `Compactando... ${Math.round(metadata.percent)}%`,
                        pct
                    });
                }
            );
            saveAs(content, `backup_full_${dateStr}.zip`);
            onProgress?.({ phase: 'done', label: 'Backup concluído com sucesso!', pct: 100 });
        } catch (error: any) {
            console.error('Erro na compactação ZIP:', error);
            throw new Error(`Falha ao gerar o arquivo ZIP: ${error.message}`);
        }
    },

    /**
     * Baixa todos os arquivos de todos os buckets em paralelo.
     * Mídia já comprimida usa STORE; outros usam DEFLATE.
     */
    async downloadStorageFiles(
        storageFolder: JSZip,
        onProgress?: BackupProgressCallback
    ): Promise<void> {
        const allFiles: { path: string; bucket: string }[] = [];

        for (const bucket of STORAGE_BUCKETS) {
            try {
                const bucketFiles = await this.listBucketFiles(bucket);
                for (const p of bucketFiles) allFiles.push({ path: p, bucket });
            } catch {
                // Bucket não existe ou sem permissão
            }
        }

        if (allFiles.length === 0) {
            onProgress?.({ phase: 'storage', label: 'Nenhum arquivo no Storage.', pct: 79 });
            return;
        }

        onProgress?.({
            phase: 'storage',
            label: `Baixando ${allFiles.length} arquivos (${CONCURRENT_DOWNLOADS} simultâneos)...`,
            pct: 31
        });

        let downloaded = 0;
        const total = allFiles.length;

        for (let i = 0; i < allFiles.length; i += CONCURRENT_DOWNLOADS) {
            const chunk = allFiles.slice(i, i + CONCURRENT_DOWNLOADS);

            await Promise.all(chunk.map(async ({ path, bucket }) => {
                try {
                    const { data: blob, error } = await supabase.storage
                        .from(bucket)
                        .download(path);

                    if (error || !blob) return;

                    const bucketDir = storageFolder.folder(bucket)!;
                    if (isMedia(path)) {
                        bucketDir.file(path, blob, { compression: 'STORE' });
                    } else {
                        bucketDir.file(path, blob, {
                            compression: 'DEFLATE',
                            compressionOptions: { level: 3 }
                        });
                    }
                } catch (err) {
                    console.error(`Exceção ao baixar ${bucket}/${path}:`, err);
                }
            }));

            downloaded += chunk.length;
            const pct = 31 + Math.floor((downloaded / total) * 48);
            onProgress?.({
                phase: 'storage',
                label: `Baixados ${downloaded} de ${total} arquivos...`,
                pct
            });
        }
    },

    /**
     * Lista recursivamente todos os arquivos de um bucket do Supabase Storage.
     */
    async listBucketFiles(bucket: string): Promise<string[]> {
        const allFiles: string[] = [];

        const listDir = async (dirPath: string) => {
            const { data: items, error } = await supabase.storage
                .from(bucket)
                .list(dirPath, { limit: 10000, sortBy: { column: 'name', order: 'asc' } });

            if (error || !items) return;

            for (const item of items) {
                const fullPath = dirPath ? `${dirPath}/${item.name}` : item.name;
                if (item.id === null) {
                    await listDir(fullPath);
                } else {
                    allFiles.push(fullPath);
                }
            }
        };

        await listDir('');
        return allFiles;
    }
};
