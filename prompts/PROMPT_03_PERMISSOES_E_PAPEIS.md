**⛔ REGRA N1:** JAMAIS apague/mova arquivos fora de `C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\` — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.

# Prompt Master: Gestão de Perfis de Acesso (RBAC) e RLS com Supabase e React

> **Objetivo Final:** Este documento instrui a IA sobre como implementar um sistema robusto de Role-Based Access Control (RBAC) integrado com o Row Level Security (RLS) do Supabase. O objetivo é garantir que a segurança dos dados ocorra na camada do Banco de Dados e reflita corretamente na Interface React.

---

## 🏗️ 1. Estrutura de Perfis (Roles)

Em sistemas SaaS ou B2B, um único "User" raramente é suficiente. Precisamos de hierarquia de permissões. O sistema modelo possui 3 perfis de acesso, definidos em uma coluna `app_role` (text) na tabela customizada `public.users` (que estende os dados do `auth.users`):

1. **`admin`**: Acesso total a tudo, pode visualizar e modificar registros de qualquer pessoa, gerenciar categorias (Tags) a nível de sistema e promover outros usuários.
2. **`master` (ex. 'Projetista')**: Acesso e visão restrita *apenas* aos registros/projetos que este próprio usuário criou. Não pode ver dados de outros usuários. 
3. **`comum` (ex. 'Estagiário')**: Semelhante ao Master, restrito apenas ao que criou, mas idealmente com permissões removidas para deletar dados ou com aprovação prévia (depende da regra do negócio).

---

## 🔒 2. A Camada Inviolável: Supabase RLS (Row Level Security)

Seja qual for o frontend (React, Vue, Mobile), a segurança real é feita no PostgreSQL do Supabase.

### O Padrão Ouro de RLS:
A IA **DEVE** criar as seguintes Políticas de Segurança (Policies) nas tabelas principais (ex: `photos`, `projects`):

1. **Permissão de Leitura (`SELECT`)**:
   - `admin`: `true` (Vê tudo)
   - `master/comum`: `auth.uid() = user_id` (Vê apenas as próprias fotos). 
   *Nota: Se o sistema exigir compartilhamento, adicionar cláusula de `EXISTS` em tabela de `project_members`.*

2. **Permissões de Escrita (`INSERT`, `UPDATE`, `DELETE`)**:
   - Para inserir, o `user_id` do payload DEVE ser o `auth.uid()` logado para evitar *spoofing*.
   - Para editar/deletar, a política deve garantir: `(auth.uid() = user_id) OR (user_app_role() = 'admin')`.

**Dica para a IA implementadora**: 
Criar uma function SQL leve para leitura de roles baseada no JWT ajuda na performance e evita loops pesados (recursão infinita) em políticas RLS. Exemplo: Injetar as claims de `app_role` diretamente no Access Token na hora do login via Supabase Auth Hooks (Custom Claims).

---

## 🖥️ 3. A Camada Frontend: React & TypeScript

Não confie apenas no banco de dados para a "Experiência do Usuário". O React deve ocultar botões proibidos para evitar erros de HTTP 403 (Unauthorized).

### Contexto Expandido (`AuthContext.tsx`)
Quando o RLS está ativo, precisamos saber a *Role* (Perfil) logada no Frontend o mais rápido possível.
Ao receber o evento `onAuthStateChange` do Supabase com uma sessão válida, cruze imediatamente o ID do usuário para buscar o seu Perfil.
```typescript
const { data: profile } = await supabase.from('users').select('name, app_role').eq('id', session.user.id).single();
// Incorpore isso no UserState
setUser({ id: session.user.id, email: session.user.email, role: profile.app_role });
```

### Funções de Checagem (Helpers)
Crie *helpers* booleanos globais (no Contexto ou Utils) para controlar a UI de maneira legível:
- `const isAdmin = user.role === 'admin';`
- `const canEdit = (ownerId: string) => isAdmin || user.id === ownerId;`

### UI/UX Condicional
Oculte opções administrativas:
```tsx
{/* 🚫 Incorreto - Renderiza e toma erro de RLS ao clicar */}
<button onClick={deleteData}>Deletar</button> 

{/* ✅ Correto - Só quem tem permissão explícita visualiza a ação */}
{canEdit(foto.user_id) && (
  <button onClick={deleteData}>Deletar</button>
)}
```

---

Quando aplicar este Prompt em um novo projeto, exija da IA a criação da Migration `.sql` com todas as Roles e RLS, bem como os tipos Typescript refletindo o *Custom User Object*.
