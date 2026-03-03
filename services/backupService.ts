import { supabase } from './supabaseClient';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

export interface BackupProgressCallback {
    (info: { phase: 'db' | 'storage' | 'zipping' | 'done' | ''; label: string; pct: number }): void;
}

// ─── CONCURRENCY ─────────────────────────────────────────────────────────────
const CONCURRENT_DOWNLOADS = 8;

// ─── FILES THAT ARE ALREADY COMPRESSED (no point running DEFLATE on them) ───
const BINARY_MEDIA_RE = /\.(jpg|jpeg|png|gif|webp|avif|heic|mp4|mov|avi|mkv|pdf|zip|7z|rar|gz|webm)$/i;
function isMedia(path: string) { return BINARY_MEDIA_RE.test(path); }

// ─── KNOWN STORAGE BUCKETS ───────────────────────────────────────────────────
// Add any extra bucket names your project uses. Unknown buckets are silently skipped.
const STORAGE_BUCKETS = ['photos', 'avatars', 'assets', 'system'];

// ─── SCHEMA DDL ───────────────────────────────────────────────────────────────
// Full CREATE TABLE statements for tables defined in database.types.ts + migrations.
// For tables NOT listed here (eventos_edicoes, planilha_*) an inferred DDL is
// generated at backup time from the live data (see generateInferredDDL()).
const SCHEMA_DDL = `-- ============================================================
-- GALERIA DE FOTOS — Schema DDL Completo
-- Gerado por backupService. Aplicar em um Supabase novo ANTES
-- de rodar o database_backup.sql (INSERTs).
-- ============================================================

-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABLE: users
-- Usuários da aplicação (separados do auth.users do Supabase).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              TEXT NOT NULL,
    email             TEXT NOT NULL UNIQUE,
    password_hash     TEXT NOT NULL,
    is_admin          BOOLEAN DEFAULT false,
    is_visitor        BOOLEAN DEFAULT false,
    is_active         BOOLEAN DEFAULT true,
    is_temp           BOOLEAN DEFAULT false,
    is_projetista     BOOLEAN DEFAULT false,
    can_manage_tags   BOOLEAN DEFAULT false,
    expires_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: system_config
-- Configurações da aplicação (chave-valor).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.system_config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TIMESTAMPTZ
);
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: tag_categories
-- Categorias das tags.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tag_categories (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              TEXT NOT NULL,
    "order"           INTEGER NOT NULL DEFAULT 0,
    is_required       BOOLEAN DEFAULT false,
    requires_sub_tags BOOLEAN DEFAULT false,
    peer_category_ids UUID[] DEFAULT '{}',
    user_id           UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.tag_categories ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: tags
-- Tags para categorizar fotos.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tags (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    category_id UUID NOT NULL REFERENCES public.tag_categories(id) ON DELETE CASCADE,
    "order"     INTEGER DEFAULT 0,
    user_id     UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: photos
-- Registros de fotos.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.photos (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name             TEXT NOT NULL,
    url              TEXT NOT NULL,
    thumbnail_url    TEXT,
    local_path       TEXT,
    storage_location TEXT,
    video_url        TEXT,
    user_id          UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: photo_tags
-- Relacionamento N:N entre fotos e tags.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.photo_tags (
    photo_id UUID NOT NULL REFERENCES public.photos(id) ON DELETE CASCADE,
    tag_id   UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
    PRIMARY KEY (photo_id, tag_id)
);
ALTER TABLE public.photo_tags ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: user_biometrics
-- Credenciais WebAuthn / Passkey.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_biometrics (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL UNIQUE,
    public_key    TEXT NOT NULL,
    counter       INTEGER NOT NULL DEFAULT 0,
    friendly_name TEXT,
    created_at    TIMESTAMPTZ DEFAULT now(),
    last_used_at  TIMESTAMPTZ
);
ALTER TABLE public.user_biometrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own biometrics"
    ON public.user_biometrics FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own biometrics"
    ON public.user_biometrics FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================================
-- FUNÇÕES PERSONALIZADAS (precisam ser recriadas manualmente)
-- ── get_available_related_tags(current_tag_ids UUID[], filter_user_id UUID)
-- ── search_photos_by_tags(primary_tag_ids UUID[], sub_tag_ids UUID[], ...)
-- Obtenha o código em: antigo Dashboard → Database → Functions
-- ============================================================

-- ============================================================
-- TABELAS EXTRAS (eventos_edicoes, planilha_*)
-- Ver arquivo: schema_inferred_extras.sql  (gerado no backup)
-- ============================================================
`;

// ─── MIGRATIONS SQL (embutidas para o ZIP) ────────────────────────────────────
const MIGRATION_FILES: { filename: string; content: string }[] = [
    {
        filename: '001_20240221_create_user_biometrics.sql',
        content: `-- Migration: Create user_biometrics table for Passkey/WebAuthn support

CREATE TABLE IF NOT EXISTS public.user_biometrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL UNIQUE,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    friendly_name TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    last_used_at TIMESTAMPTZ
);

ALTER TABLE public.user_biometrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own biometrics"
    ON public.user_biometrics FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own biometrics"
    ON public.user_biometrics FOR DELETE
    USING (auth.uid() = user_id);
`
    },
    {
        filename: '002_20260222_add_storage_location_to_photos.sql',
        content: `ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS storage_location TEXT;\n`
    },
    {
        filename: '003_20260303_add_admin_rls_policies.sql',
        content: `-- Permitir que administradores (is_admin = true) burlem o RLS (SELECT)

DO $$
DECLARE
    tbl_name text;
    tables_to_update text[] := ARRAY[
        'users','system_config','tag_categories','tags','photos',
        'photo_tags','eventos_edicoes','planilha_configuracoes',
        'planilha_atendimentos','planilha_itens_opcionais'
    ];
BEGIN
    FOREACH tbl_name IN ARRAY tables_to_update
    LOOP
        EXECUTE format(
            'CREATE POLICY "Admins bypass RLS for SELECT in %s" ' ||
            'ON public.%I FOR SELECT TO authenticated ' ||
            'USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true));',
            tbl_name, tbl_name
        );
    END LOOP;
END;
$$;

CREATE POLICY "Admins bypass RLS for SELECT in storage.objects"
ON storage.objects FOR SELECT TO authenticated
USING (
   bucket_id = 'photos' AND
   EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true)
);
`
    }
];

// ─── EDGE FUNCTION (embutida para o ZIP) ─────────────────────────────────────
const EDGE_FUNCTION_PASSKEY = `// supabase/functions/passkey-auth/index.ts
// Deploy: supabase functions deploy passkey-auth --project-ref SEU_PROJECT_REF
// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import {
    generateRegistrationOptions, verifyRegistrationResponse,
    generateAuthenticationOptions, verifyAuthenticationResponse,
} from "https://esm.sh/@simplewebauthn/server@9.0.3";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const base64UrlToStandard = (b) => {
    let s = b.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4 !== 0) s += '=';
    return s;
};

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    try {
        const client = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
        const url = new URL(req.url);
        const action = url.searchParams.get("action");
        const originHeader = req.headers.get("origin");
        const refererHeader = req.headers.get("referer");
        let rpID = url.hostname;
        if (originHeader) rpID = new URL(originHeader).hostname;
        else if (refererHeader) rpID = new URL(refererHeader).hostname;
        const origin = originHeader || \`https://\${rpID}\`;

        if (action === "enroll-options") {
            const { data: { user } } = await client.auth.getUser(req.headers.get("Authorization").replace("Bearer ", ""));
            if (!user) throw new Error("Unauthorized");
            const options = await generateRegistrationOptions({
                rpName: "Galeria de Fotos", rpID, userID: new TextEncoder().encode(user.id),
                userName: user.email, attestationType: "none",
                authenticatorSelection: { residentKey: "required", userVerification: "required", authenticatorAttachment: "platform" },
            });
            return new Response(JSON.stringify(options), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        if (action === "enroll-verify") {
            const { data: { user } } = await client.auth.getUser(req.headers.get("Authorization").replace("Bearer ", ""));
            if (!user) throw new Error("Unauthorized");
            const { body, expectedChallenge } = await req.json();
            const v = await verifyRegistrationResponse({ response: body, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID });
            if (v.verified && v.registrationInfo) {
                const { credentialID, credentialPublicKey, counter } = v.registrationInfo;
                const { error: dbErr } = await client.from("user_biometrics").insert({
                    user_id: user.id, credential_id: btoa(String.fromCharCode(...credentialID)),
                    public_key: btoa(String.fromCharCode(...credentialPublicKey)), counter, friendly_name: body.id,
                });
                if (dbErr) throw dbErr;
                return new Response(JSON.stringify({ verified: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }
            throw new Error("Verification failed");
        }

        if (action === "login-options") {
            const { email } = await req.json();
            let credentials = [], targetUserId = null;
            if (email) {
                const { data: { users } } = await client.auth.admin.listUsers();
                const target = users.find(u => u.email?.toLowerCase() === email.toLowerCase());
                if (target) {
                    targetUserId = target.id;
                    const { data } = await client.from("user_biometrics").select("credential_id").eq("user_id", target.id);
                    credentials = data || [];
                }
            }
            const options = await generateAuthenticationOptions({
                rpID,
                allowCredentials: credentials.map(c => ({ id: Uint8Array.from(atob(c.credential_id), ch => ch.charCodeAt(0)), type: "public-key", transports: ["internal"] })),
                userVerification: "required",
            });
            return new Response(JSON.stringify({ options, userId: targetUserId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        if (action === "login-verify") {
            const { body, expectedChallenge, userId: providedUserId } = await req.json();
            const standardId = base64UrlToStandard(body.id);
            let query = client.from("user_biometrics").select("*").eq("credential_id", standardId);
            if (providedUserId) query = query.eq("user_id", providedUserId);
            const { data: credential, error: dbErr } = await query.single();
            if (dbErr || !credential) throw new Error("Credential not found");
            const v = await verifyAuthenticationResponse({
                response: body, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID,
                authenticator: {
                    credentialID: Uint8Array.from(atob(credential.credential_id), c => c.charCodeAt(0)),
                    credentialPublicKey: Uint8Array.from(atob(credential.public_key), c => c.charCodeAt(0)),
                    counter: credential.counter,
                },
            });
            if (v.verified) {
                await client.from("user_biometrics").update({ counter: v.authenticationInfo.newCounter, last_used_at: new Date().toISOString() }).eq("id", credential.id);
                const { data: userObj } = await client.auth.admin.getUserById(credential.user_id);
                const { data: linkData, error: linkErr } = await client.auth.admin.generateLink({ type: "magiclink", email: userObj.user.email });
                if (linkErr) throw linkErr;
                return new Response(JSON.stringify({ verified: true, token_hash: linkData.properties.hashed_token }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }
            throw new Error("Login verification failed");
        }

        return new Response("Action not found", { status: 404, headers: corsHeaders });
    } catch (error) {
        return new Response(JSON.stringify({ error: \`Verification Failed: \${error.message}\` }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
`;

// ─── RESTORE GUIDE ────────────────────────────────────────────────────────────
const RESTORE_GUIDE = `# Guia de Restauração — Galeria de Fotos

Gerado automaticamente pelo sistema de backup.
Data do backup: {{DATE}}

---

## Estrutura do ZIP

\`\`\`
backup_galeria_full_YYYY-MM-DD.zip
├── RESTORE_GUIDE.md                          ← Este arquivo
├── database/
│   ├── 1_auth_users_restore.sql              ← PRIMEIRO: recria auth.users com UUIDs originais
│   ├── 2_schema_ddl.sql                      ← SEGUNDO: CREATE TABLE (tabelas conhecidas)
│   ├── 3_schema_inferred_extras.sql          ← TERCEIRO: DDL inferido (eventos, planilha)
│   └── 4_database_backup.sql                 ← QUARTO: INSERT de todos os dados públicos
├── schema_migrations/
│   ├── 001_create_user_biometrics.sql
│   ├── 002_add_storage_location.sql
│   └── 003_add_admin_rls_policies.sql
├── edge_functions/
│   └── passkey-auth/
│       └── index.ts
└── storage_backup/
    └── photos/                               ← Todos os arquivos do bucket
        └── [estrutura original]
\`\`\`

---

## Passo a Passo — Restaurar em Nova Conta Supabase

### 1. Criar Novo Projeto Supabase
- Acesse supabase.com, crie novo projeto.
- Anote: Project URL, anon public key, service_role key.

### 2. Recriar os Usuários no Auth (CRÍTICO — faça ANTES do schema)

Execute no SQL Editor do novo projeto:

  Cole: database/1_auth_users_restore.sql

  Isso recria cada usuário em auth.users + auth.identities com os MESMOS UUIDs
  do backup original. Todos os vínculos (fotos, tags, etc.) serão preservados.

  SENHA TEMPORÁRIA: Todos os usuários serão criados com a senha "GaleriaRestore2024!"
  Após restaurar, cada usuário deve alterar sua senha no primeiro login.

### 3. Recriar o Schema no SQL Editor

Execute nesta ordem:

  a) Cole: database/2_schema_ddl.sql
  b) Cole: database/3_schema_inferred_extras.sql
     (REVISE os tipos de coluna antes de executar — tabelas inferidas podem precisar de ajuste!)
  c) Cole em ordem: schema_migrations/001 → 002 → 003

### 4. Restaurar os Dados

  Cole: database/4_database_backup.sql
  (Os INSERTs já incluem ON CONFLICT DO NOTHING para evitar duplicatas)

### 5. Recriar as Funções PostgreSQL

As funções abaixo precisam ser recriadas manualmente no SQL Editor:
  - get_available_related_tags
  - search_photos_by_tags

Obtenha o SQL delas no projeto antigo: Dashboard → Database → Functions

### 6. Subir os Arquivos para o Storage

  a) Crie o bucket "photos" no novo projeto (mesmo tipo público/privado do original).
  b) Faça upload da pasta storage_backup/photos/ via:

     Supabase CLI:
       supabase storage cp -r ./storage_backup/photos/ ss:///photos/

     Ou use o Dashboard → Storage → Upload (para poucos arquivos).

### 7. Atualizar Variáveis de Ambiente da Aplicação

No arquivo .env ou .env.local:
  VITE_SUPABASE_URL=https://SEU-NOVO-PROJETO.supabase.co
  VITE_SUPABASE_ANON_KEY=sua-nova-anon-key

### 8. Atualizar URLs das Fotos no Banco

As URLs das fotos apontam para o projeto antigo. Após restaurar o Storage, execute:

  UPDATE public.photos
  SET url = REPLACE(url, 'URL_ANTIGA.supabase.co', 'URL_NOVA.supabase.co');

  UPDATE public.photos
  SET thumbnail_url = REPLACE(thumbnail_url, 'URL_ANTIGA.supabase.co', 'URL_NOVA.supabase.co')
  WHERE thumbnail_url IS NOT NULL;

### 9. Reimplantar a Edge Function (Passkey/WebAuthn)

  supabase functions deploy passkey-auth --project-ref SEU-PROJECT-REF

  Código em: edge_functions/passkey-auth/index.ts

  Após reimplantar, cada usuário precisará re-registrar sua biometria (Passkey),
  pois os credenciais WebAuthn são vinculados ao domínio e não são transferíveis.

---

## Notas Importantes

- SENHAS: Todos os usuários são recriados com senha temporária "GaleriaRestore2024!".
  Peça a cada usuário que altere sua senha após o primeiro login.
- AUTH.USERS + UUIDs: O arquivo 1_auth_users_restore.sql recria auth.users com os
  MESMOS UUIDs do backup. Isso garante que todas as referências (photos.user_id,
  tags.user_id, etc.) permaneçam válidas sem nenhuma atualização adicional.
- PASSKEYS (WebAuthn): Os credenciais biométricos são vinculados ao domínio do site.
  Após migrar para novo projeto/domínio, cada usuário deve re-registrar sua biometria
  em Configurações → Cadastrar Biometria.
- ÍCONES/FAVICON: São arquivos do código-fonte (public/icons/, public/favicon*.png),
  não estão no Supabase. Estão no repositório Git — não precisam de restauração.
- FUNÇÕES POSTGRES: get_available_related_tags e search_photos_by_tags precisam
  de recriação manual (não podem ser exportadas pelo cliente browser).
`;

// ─── AUTH.USERS RESTORE SQL ───────────────────────────────────────────────────
/**
 * Gera um SQL para recriar os usuários no Supabase Auth com os MESMOS UUIDs.
 * Isso preserva todos os vínculos: photos.user_id, tags.user_id, etc.
 *
 * Como funciona o vínculo:
 *   register() → cria em auth.users → pega o UUID → insere em public.users com o MESMO UUID
 *   Logo: public.users.id === auth.users.id SEMPRE
 *
 * Ao restaurar em nova conta com este script:
 *   1. auth.users é recriado com UUIDs originais (senha temporária)
 *   2. public.users é restaurado com os mesmos UUIDs (do database_backup.sql)
 *   3. Todos os vínculos (fotos, tags, etc.) permanecem intactos
 *   4. Usuários fazem login com a senha temporária e redefinem a sua
 */
function generateAuthRestoreSQL(users: any[]): string {
    const activeUsers = users.filter(u => u.id && u.email);
    if (activeUsers.length === 0) return '-- Nenhum usuário para restaurar.\n';

    const TEMP_PASS = 'GaleriaRestore2024!';

    let sql = `-- ============================================================\n`;
    sql += `-- RESTAURAÇÃO DO SUPABASE AUTH (auth.users + auth.identities)\n`;
    sql += `-- ============================================================\n`;
    sql += `--\n`;
    sql += `-- POR QUE ESTE ARQUIVO É CRÍTICO?\n`;
    sql += `-- O sistema usa Supabase Auth para login. O UUID do auth.users\n`;
    sql += `-- é IDÊNTICO ao public.users.id (gerado na criação do usuário).\n`;
    sql += `-- Sem este script, os logins não funcionam e TODAS as referências\n`;
    sql += `-- de fotos, tags e configurações ficam sem dono.\n`;
    sql += `--\n`;
    sql += `-- COMO USAR:\n`;
    sql += `-- 1. Execute este arquivo ANTES do database_backup.sql\n`;
    sql += `-- 2. Execute no SQL Editor do Supabase Dashboard\n`;
    sql += `-- 3. SENHA TEMPORÁRIA PARA TODOS: ${TEMP_PASS}\n`;
    sql += `-- 4. Após restaurar, redefina cada senha:\n`;
    sql += `--    Dashboard → Authentication → Users → (usuário) → Send reset email\n`;
    sql += `-- ============================================================\n\n`;

    for (const u of activeUsers) {
        const createdAt = u.created_at || new Date().toISOString();
        const note = u.is_temp ? ' [TEMP]' : u.is_admin ? ' [ADMIN]' : '';
        const escaped = u.email.replace(/'/g, "''");

        sql += `-- ${u.name}${note} — ${u.email}\n`;

        // ── auth.users ────────────────────────────────────────────────────────
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

        // ── auth.identities (necessário para login email/senha funcionar) ────
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

    sql += `-- ============================================================\n`;
    sql += `-- PRÓXIMO PASSO: execute database_backup.sql\n`;
    sql += `-- ============================================================\n`;

    return sql;
}

// ─── DDL INFERENCE (para tabelas sem schema conhecido) ───────────────────────
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

// ─── MAIN SERVICE ─────────────────────────────────────────────────────────────
export const backupService = {
    /**
     * Backup completo: banco de dados + storage + schema + guia de restauração.
     * Apenas leitura (SELECT). Nenhum dado é modificado ou excluído.
     */
    async downloadFull(onProgress?: BackupProgressCallback): Promise<void> {
        const zip = new JSZip();

        // ── 1. Exportar banco de dados (consultas em paralelo) ───────────────
        onProgress?.({ phase: 'db', label: 'Exportando banco de dados...', pct: 2 });
        const { sqlContent, schemaInferredExtras, authRestoreSQL } = await this.exportDatabase(onProgress);

        const dbFolder = zip.folder('database')!;
        // ORDEM DE EXECUÇÃO NA RESTAURAÇÃO está indicada no prefixo do nome:
        dbFolder.file('1_auth_users_restore.sql', authRestoreSQL);   // PRIMEIRO
        dbFolder.file('2_schema_ddl.sql', SCHEMA_DDL);                // SEGUNDO
        dbFolder.file('3_schema_inferred_extras.sql', schemaInferredExtras); // TERCEIRO
        dbFolder.file('4_database_backup.sql', sqlContent);           // QUARTO

        // ── 2. Arquivos de migration ─────────────────────────────────────────
        const migrFolder = zip.folder('schema_migrations')!;
        for (const m of MIGRATION_FILES) {
            migrFolder.file(m.filename, m.content);
        }

        // ── 3. Código da Edge Function ───────────────────────────────────────
        zip.folder('edge_functions/passkey-auth')!.file('index.ts', EDGE_FUNCTION_PASSKEY);

        // ── 4. Baixar arquivos do Storage (paralelo) ─────────────────────────
        onProgress?.({ phase: 'storage', label: 'Mapeando arquivos no Storage...', pct: 30 });
        await this.downloadStorageFiles(zip.folder('storage_backup')!, onProgress);

        // ── 5. Guia de restauração ───────────────────────────────────────────
        const dateStr = new Date().toISOString().split('T')[0];
        zip.file('RESTORE_GUIDE.md', RESTORE_GUIDE.replace('{{DATE}}', dateStr));

        // ── 6. Compactar e disparar download ─────────────────────────────────
        onProgress?.({ phase: 'zipping', label: 'Compactando arquivo final...', pct: 85 });
        try {
            const content = await zip.generateAsync(
                { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 5 } },
                (metadata) => {
                    const pct = 85 + Math.floor(metadata.percent * 0.14);
                    onProgress?.({
                        phase: 'zipping',
                        label: `Compactando... ${Math.round(metadata.percent)}%`,
                        pct
                    });
                }
            );
            saveAs(content, `backup_galeria_full_${dateStr}.zip`);
            onProgress?.({ phase: 'done', label: 'Backup concluído com sucesso!', pct: 100 });
        } catch (error: any) {
            console.error('Erro na compactação ZIP:', error);
            throw new Error(`Falha ao gerar o arquivo ZIP: ${error.message}`);
        }
    },

    /**
     * Exporta todas as tabelas para SQL (INSERTs).
     * Todas as tabelas são consultadas em PARALELO.
     */
    async exportDatabase(onProgress?: BackupProgressCallback): Promise<{
        sqlContent: string;
        schemaInferredExtras: string;
        authRestoreSQL: string;
    }> {
        // Ordenadas por dependência de FK (pais antes de filhos)
        const KNOWN_TABLES = [
            'users',
            'system_config',
            'tag_categories',
            'tags',
            'photos',
            'photo_tags',
            'user_biometrics',     // Estava faltando no backup anterior
        ];
        // Tabelas que não estão em database.types.ts — DDL será inferido dos dados
        const EXTRA_TABLES = [
            'eventos_edicoes',
            'planilha_configuracoes',
            'planilha_atendimentos',
            'planilha_itens_opcionais',
        ];

        const allTables = [...KNOWN_TABLES, ...EXTRA_TABLES];

        onProgress?.({
            phase: 'db',
            label: `Consultando ${allTables.length} tabelas em paralelo...`,
            pct: 5
        });

        // Busca TODAS as tabelas simultaneamente
        const results = await Promise.all(
            allTables.map(async (tableName) => {
                const { data, error } = await supabase.from(tableName as any).select('*');
                return { tableName, data: data ?? [], error };
            })
        );

        onProgress?.({ phase: 'db', label: 'Gerando SQL...', pct: 22 });

        const tableDataForInference: Record<string, any[]> = {};
        let sqlContent = `-- ============================================================\n`;
        sqlContent += `-- Backup Completo — Galeria de Fotos\n`;
        sqlContent += `-- Gerado em: ${new Date().toISOString()}\n`;
        sqlContent += `-- Execute APÓS aplicar o schema_ddl.sql\n`;
        sqlContent += `-- ============================================================\n\n`;

        for (const { tableName, data, error } of results) {
            if (error) {
                if (error.code === '42P01') {
                    sqlContent += `-- Tabela '${tableName}' ignorada (não existe neste BD)\n\n`;
                } else {
                    console.error(`Erro ao consultar ${tableName}:`, error);
                    sqlContent += `-- ERRO ao exportar '${tableName}': ${error.message}\n\n`;
                }
                continue;
            }

            tableDataForInference[tableName] = data;

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

        onProgress?.({
            phase: 'db',
            label: 'Gerando schema inferido para tabelas extras...',
            pct: 27
        });

        // Gera DDL inferido apenas para as tabelas extras
        let schemaInferredExtras = `-- ============================================================\n`;
        schemaInferredExtras += `-- Schema INFERIDO para tabelas extras (eventos, planilha)\n`;
        schemaInferredExtras += `-- REVISE cuidadosamente antes de aplicar!\n`;
        schemaInferredExtras += `-- ============================================================\n\n`;
        for (const tableName of EXTRA_TABLES) {
            schemaInferredExtras += generateInferredDDL(
                tableName,
                tableDataForInference[tableName] ?? []
            );
        }

        // Gera SQL de restauração do auth.users (usa os dados de users já exportados)
        const authRestoreSQL = generateAuthRestoreSQL(tableDataForInference['users'] ?? []);

        onProgress?.({ phase: 'db', label: 'Exportação do banco concluída.', pct: 29 });
        return { sqlContent, schemaInferredExtras, authRestoreSQL };
    },

    /**
     * Baixa todos os arquivos de todos os buckets conhecidos em paralelo.
     * Imagens/vídeos são adicionados ao ZIP com STORE (sem compressão),
     * pois JPEG/PNG/MP4 já são comprimidos — DEFLATE desperdiçaria CPU e tempo.
     */
    async downloadStorageFiles(
        storageFolder: JSZip,
        onProgress?: BackupProgressCallback
    ): Promise<void> {
        // Listar arquivos de todos os buckets (buckets inexistentes são ignorados)
        const allFiles: { path: string; bucket: string }[] = [];

        for (const bucket of STORAGE_BUCKETS) {
            try {
                const bucketFiles = await this.listBucketFiles(bucket);
                for (const p of bucketFiles) allFiles.push({ path: p, bucket });
            } catch {
                // Bucket não existe ou sem permissão — ignora silenciosamente
            }
        }

        if (allFiles.length === 0) {
            onProgress?.({
                phase: 'storage',
                label: 'Nenhum arquivo encontrado no Storage.',
                pct: 84
            });
            return;
        }

        onProgress?.({
            phase: 'storage',
            label: `Baixando ${allFiles.length} arquivos (${CONCURRENT_DOWNLOADS} simultâneos)...`,
            pct: 31
        });

        // Processar em lotes de CONCURRENT_DOWNLOADS
        let downloaded = 0;
        const total = allFiles.length;

        for (let i = 0; i < allFiles.length; i += CONCURRENT_DOWNLOADS) {
            const chunk = allFiles.slice(i, i + CONCURRENT_DOWNLOADS);

            await Promise.all(chunk.map(async ({ path, bucket }) => {
                try {
                    const { data: blob, error } = await supabase.storage
                        .from(bucket)
                        .download(path);

                    if (error) {
                        console.error(`Erro ao baixar ${bucket}/${path}:`, error);
                        return;
                    }
                    if (!blob) return;

                    const bucketDir = storageFolder.folder(bucket)!;
                    // Imagens/vídeos: STORE (sem DEFLATE — já comprimidos)
                    // Outros arquivos: DEFLATE nível 3 (rápido)
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
            // Progresso: 31% → 84%
            const pct = 31 + Math.floor((downloaded / total) * 53);
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
                    // id null = pasta virtual → recursão
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
