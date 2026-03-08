**⛔ REGRA N1:** JAMAIS apague/mova arquivos fora de `C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\` — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.

# Prompt Master: Rotas Protegidas no React (Protected Routes) com Supabase Auth

> **Objetivo Final:** Ensinar a IA a criar um sistema de autenticação fluído em uma Single Page Application (SPA), garantindo que usuários deslogados sejam redirecionados e que a interface não pisque (flicker) entre views.

---

## 🚦 1. O Problema do "Flicker" nas Telas Iniciais

A maioria das implementações básicas de roteamento condicional em React verifica `if (!user) navigate('/login')`. 
Porém, carregar a sessão do Supabase é um **processo assíncrono** na inicialização (lendo localStorage, checando JWT etc). Se a verificação for muito rápida, o sistema acha que o usuário não existe e o expulsa para o `/login`, mas 200ms depois o Supabase avisa "Ei, achei o usuário!" - causando um redirecionamento desnecessário e irritante.

## 🛡️ 2. O Componente `ProtectedRoute` (O Guarda-Costas)

A IA **DEVE** criar um componente `ProtectedRoute.tsx` wrapper em volta do `<Outlet />` (react-router-dom) ou ao redor das rotas privadas no `App.tsx`:

```tsx
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LoadingSpinner } from './UI';

const ProtectedRoute = () => {
    // 1. O Contexto OBRIGATORIAMENTE deve expor um "loading" assíncrono
    const { user, loading } = useAuth();

    // 2. Se o Supabase AINDA ESTÁ PROCESSANDO a sessão, PARE E ESPERE.
    // Retorne apenas uma tela em branco ou Spinner de carregamento puro. NUNCA REDIRECIONE AQUI.
    if (loading) {
        return <div className="min-h-screen flex items-center justify-center"><LoadingSpinner /></div>;
    }

    // 3. O processamento acabou. Não tem usuário mesmo? EXPULSE.
    if (!user) {
        return <Navigate to="/login" replace />;
    }

    // 4. Se chegou aqui, renderize a Rota Interna Segura.
    return <Outlet />;
};

export default ProtectedRoute;
```

---

## 🧠 3. O Motor da Sessão: `AuthContext.tsx`

Para que o `loading` do componente acima funcione, o AuthContext precisa ser a fonte da verdade usando o ouvinte oficial do SDK do Supabase.

1. Inicialize `const [loading, setLoading] = useState(true)` (VERDADEIRO POR PADRÃO!).
2. A IA **DEVE** usar `supabase.auth.getSession()` no `useEffect` de montagem inicial.
3. A IA **DEVE** usar o `supabase.auth.onAuthStateChange` para inscrever (subscribe) nos eventos de (SIGNED_IN, SIGNED_OUT).

```typescript
useEffect(() => {
    // Busca inicial Ativa
    supabase.auth.getSession().then(({ data: { session } }) => {
        setUser(session?.user ?? null);
        setLoading(false); // Só desativa o "flicker block" DEPOIS de saber a verdade.
    });

    // Subscrição reativa para escutar mudanças de outras abas ou expirações.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null);
        // Não force setLoading(false) aqui diretamente sem analisar caso complexos
    });

    return () => subscription.unsubscribe();
}, []);
```

---

## 🚫 4. Rotas Públicas Anti-Acesso-Acidental (`PublicRoute.tsx`)

O cenário inverso também é problemático: Se um usuário já está logado na aplicação (`/dashboard`) e ele clica no link `/login` na barra do navegador, ele não deve ver a tela de login. Ele já está autenticado.

A IA **DEVE** implementar a mesma lógica, mas invertida:

```tsx
const PublicRoute = () => {
    const { user, loading } = useAuth();
    if (loading) return <Spinner />;

    // Usuário já está logado? Bloqueie a visita à pagina pública (Login/Register)
    // Redirecione-o para a página logada ("Home / Gallery")
    if (user) {
        return <Navigate to="/fotos" replace />;
    }

    return <Outlet />;
};
```

Com este Prompt, o `Nav` Router fica robusto e elegante como um App Nativo iOS/Android, sem redirecionamentos acidentais ou piscadas em branco.
