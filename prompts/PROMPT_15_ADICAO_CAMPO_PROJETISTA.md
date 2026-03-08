**⛔ REGRA N1:** JAMAIS apague/mova arquivos fora de `C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\` — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.

# 🛠️ PROMPT: Adição de Campo "Projetista Responsável" no Perfil de Usuário

**Objetivo:** Adicionar um campo de texto livre chamado `projetista` à tabela de usuários, permitindo que cada perfil tenha um responsável técnico associado, com suporte completo no Banco de Dados (Supabase), Tipagem (TypeScript), Serviços (CRUD) e Interface (React).

---

## Passo 1: 🗄️ SQL Migration (Banco de Dados)
Execute o seguinte comando no SQL Editor do seu Supabase para criar a coluna física:

```sql
-- Adiciona a coluna projetista como texto simples
ALTER TABLE public.users 
ADD COLUMN projetista TEXT;

-- (Opcional) Comente para documentar no banco
COMMENT ON COLUMN public.users.projetista IS 'Nome do projetista responsável associado ao usuário.';
```

---

## Passo 2: 🧬 Sincronização de Tipos (TypeScript)
Atualize o arquivo de tipos gerado (`database.types.ts`) ou declare manualmente para satisfazer o compilador.

No arquivo `database.types.ts`, dentro da definição da tabela `users`:
- Em **Row**: Adicionar `projetista: string | null`
- Em **Insert**: Adicionar `projetista?: string | null`
- Em **Update**: Adicionar `projetista?: string | null`

---

## Passo 3: ⚙️ Atualização do Serviço de Autenticação (`authService.ts`)
O serviço precisa mapear o campo que vem do Banco de Dados (snake_case) para a Interface do sistema (camelCase, se necessário).

1. **Atualize a Interface `User`:**
```typescript
export interface User {
    // ... campos existentes
    isProjetista: boolean; 
    projetista?: string; // Campo novo
}
```

2. **Mapeie nos métodos CRUD:**
Em métodos como `getCurrentUser`, `getAllUsers` e `updateUser`, garanta que o dado seja passado:

```typescript
// Exemplo no mapeamento de retorno do Supabase
const mapUser = (data: any): User => ({
    // ... outros campos
    isProjetista: data.is_projetista ?? false,
    projetista: data.projetista ?? '', // Garante string vazia se nulo
});

// Exemplo no updateUser
const { error } = await supabase
    .from('users')
    .update({ 
        // ... outros campos
        projetista: updates.projetista 
    })
    .eq('id', userId);
```

---

## Passo 4: 🖥️ Implementação na Interface (`Users.tsx`)

1. **Estado do Formulário:**
Adicione um estado para controlar o valor do campo no formulário.
```tsx
const [projetista, setProjetista] = useState('');
```

2. **Renderização do Input:**
Posicione o campo logo abaixo da seção de senha para melhor fluxo de UX:

```tsx
<div className="space-y-1.5 focus-within:text-blue-600 transition-colors">
    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 inherit">Projetista Responsável</label>
    <input
        type="text"
        placeholder="Nome do responsável técnico"
        value={projetista}
        onChange={e => setProjetista(e.target.value)}
        className="w-full bg-slate-50 border-2 border-slate-200 focus:border-blue-600 text-sm font-bold text-slate-800 p-3 rounded-none outline-none transition-all"
    />
</div>
```

3. **Lógica de Salvamento:**
No `handleSaveUser`, envie o valor para o serviço:

```tsx
const userData = {
    // ...
    projetista: projetista,
};
// chama authService.updateUser ou register
```

4. **Lógica de Edição:**
No `handleEdit`, certifique-se de carregar o valor existente:
```tsx
const handleEdit = (user: User) => {
    // ...
    setProjetista(user.projetista || '');
};
```

---

## 🎯 Resultado Esperado
O sistema deve permitir salvar o nome de um projetista para cada usuário, exibindo-o e permitindo edição de forma persistente. Este campo é crucial para documentos gerados que precisam citar o responsável técnico.
