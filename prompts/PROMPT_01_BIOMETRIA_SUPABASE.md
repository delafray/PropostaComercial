**⛔ REGRA N1:** JAMAIS apague/mova arquivos fora de `C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\` — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.

# Prompt Master: Implementação de Autenticação Biométrica Segura (Passkeys/WebAuthn) com Supabase e React

> **Objetivo Final:** Este documento contém todo o histórico, arquitetura, soluções de bugs críticos e regras de negócio para que uma IA consiga implementar "Biometria Passwordless" (Entrar com Digital/Face ID) de forma 100% segura e livre de atritos em aplicações React (Mobile First) integradas com Supabase Edge Functions.

---

## 🏗️ 1. Arquitetura Geral do Sistema
O sistema antigo usava senhas fracas ou senhas padrão, o que abria brechas de segurança graves. A nova arquitetura transfere a complexidade cristográfica para o hardware do usuário (Secure Enclave / Android Keystore) via protocolo **FIDO2/WebAuthn (Passkeys)**.

- **Frontend (Telas + Lógica):** `Login.tsx`, `Layout.tsx` (Menu lateral) e `authService.ts`. Usamos a API nativa do navegador (`navigator.credentials.create` e `.get`).
- **Backend (Edge Function):** Uma função isolada rodando no Deno (`supabase/functions/passkey-auth/index.ts`) que gera desafios criptográficos e verifica as respostas, utilizando a biblioteca `@simplewebauthn/server`.
- **Banco de Dados (PostgreSQL):** Uma tabela isolada `user_biometrics` para guardar as chaves públicas dos identificadores da "digital", conectada pelo `user_id` original do `auth.users` do Supabase.

---

## 🛠️ 2. Regras Rígidas de Implementação Backend (Edge Function)

Durante a implementação, descobrimos vários bugs comportamentais em diferentes SOs (Android/iOS) e SDKs. A IA implementadora **DEVE** seguir as seguintes regras para garantir que funcione em produção:

### A. O Bug do `Base64` vs `Base64URL`
**O Problema**: O Frontend envia dados codificados em `Base64URL` (padrão WebAuthn), mas o armazenamento precisa ser salvo ou manipulado na linguagem nativa que muitas vezes só decodifica `Base64` padrão. Chamar `atob(body.id)` vai explodir em erro silencioso, arruinando o fluxo de login em Androids.
**A Solução Obrigatória**: A Edge Function precisa ter um helper específico para re-codificar `Base64URL` para `Base64` Padrão (convertendo `-` para `+`, e `_` para `/`, e adicionando `= padding`).
```typescript
const base64UrlToStandard = (base64url: string): string => {
    let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
        base64 += '=';
    }
    return base64;
};
// Use `base64UrlToStandard(body.id)` antes de tentar salvar/buscar no banco.
```

### B. O Bug do Supabase JS Client "Ocultando Erros" (FetchError)
**O Problema**: Se o backend jogar um erro (ex: digital falsificada ou chave não encontrada) e retornar um código HTTP `400` ou `500`, o SDK Client (`@supabase/supabase-js`) encapsula a mensagem customizada dentro de um `FunctionRelayError` ou genérico, e o frontend e o usuário final não vêem qual foi o verdadeiro erro ("Invalid origin", "Token expirado", etc).
**A Solução Obrigatória**: O bloco `catch (error)` global principal da Edge function **deve obrigatoriamente** retornar status Http `200` com um JSON contendo o erro verdadeiro.
```typescript
    } catch (error) {
        // Return 200 instead of 400 so the Supabase client doesn't mask the error message
        const errorMessage = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({ error: `Verification Failed: ${errorMessage}` }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }
```
No frontend (no `authService.ts`), é feito um `if (response.data.error) throw new Error(...)`.

### C. A Única Maneira Segura de Linkar o Usuário "Passwordless"
**O Problema**: O objetivo máximo de UX (User Experience) é permitir que o usuário abra o site, **não digite o email**, aperte em "Entrar com Biometria" e seja logado. Para isso, ativamos `residentKey: "required"` no momento do cadastro (enroll-options). 
Entretanto, aparelhos Android antigos / Play Services defeituosos omitem a prop `userHandle` no Payload de Log-in de volta, o que quebra a identificação do usuário.
**A Solução Definitiva (A "Mágica")**: Quando o Edge Function receber o `body` do `login-verify`, não tente descobrir quem é o usuário olhando para `userId` vindo do frontend, nem do `userHandle`. Em vez disso, **Faça uma Query no Banco pela `credential_id`**. O ID único da digital atua como o passaporte do usuário.
```typescript
const standardCredentialId = base64UrlToStandard(body.id); // O ID único que o leitor de digital enviou
const { data: credential } = await supabase.from('user_biometrics').select('*').eq('credential_id', standardCredentialId).single();
const userId = credential.user_id; // Usuário descoberto "magicamente" pela digital!
```

### D. RP ID Dinâmico e Magia de Redirecionamento
Não chumbar `"localhost"` ou o `"dominio.vercel.app"` no `rpID` da Edge Function. Usar `const rpID = new URL(req.headers.get("origin") || req.headers.get("referer")).hostname;`. E lembrar de criar o MagicLink de sessão de volta:
```typescript
const { data: linkData } = await supabase.auth.admin.generateLink({ type: "magiclink", email: user.email });
return JSON.stringify({ verified: true, token_hash: linkData.properties.hashed_token });
```
O Frontend pega esse `token_hash` e chama um `await supabase.auth.verifyOtp({ token_hash, type: "email" });` para finalmente ganhar um token real de sessão ativa na tela.

---

## 🎨 3. UX, UI e Regras de Frontend

### Memória Local do Estado Biométrico (A Chavinha do Menu)
**O Problema**: Pessoas que não ativaram a biometria lá dentro do Painel do Usuário (naquele `Toggle Switch`) estavam sendo bombardeadas com um botão "Entrar com Biometria" na página de Logout inicial que quebrava caso clicasse, criando ruído e má experiência na tela inicial.
**A Solução**: No arquivo `Layout.tsx`, ao confirmar no Edge Function que a biometria foi cadastrada com sucesso pelo usuário, salvar no celular localmente: `localStorage.setItem('biometricsEnrolled', 'true')`.
No arquivo `Login.tsx`, a bolha do botão só pode ser renderizada se duas verdades existirem: `isBiometricsSupported` (o OS tem leitor) **E** `isBiometricsEnrolled === 'true'` (o dono do PC quis que isso fosse usado). Isso mantém o site absurdamente limpo para quem não curte biometria.

### Esconder a Função em Desktops / PCs Base
Autenticação biométrica WebAuthn é incrível em Mobile, mas dependendo da corporação (Sistemas ERP), o botão "Entrar com Digital" polui os monitores normais de trabalho que não têm leitores USB ou câmeras infravermelho compatíveis com Windows Hello. 
**Ação Obrigatória:** Aplicar classes de utilidade CSS `md:hidden` ou media-queries do Tailwind no container do botão no `Login.tsx` e no `Layout.tsx` para garantir que essas UIs só chamem a atenção de fato em plataformas *Mobile-First*.

### A Tela OS-Level Obligatória (Android/iOS)
Se um usuário der play em `login-options` através do Request Frontend sem alimentar nenhuma credencial e nenhum campo de email pré-preenchido, a Apple (iOS) e o Google (Play services Android) vão interceptar a biometria exibindo o painel interno **"Usar chave de acesso salva?"** com nomes e botões de `[Continuar]`. 
**Nota para a IA**: Você não pode injetar código CSS para pular ou esconder isso. Se o campo de texto/email estiver vazio, o OS sempre vai forçar o prompt de segurança central para escolher "Qual das 5 contas do celular você deseja usar para abrir a digital?". Esse comportamento é **Feature**, não Bug!

---

**Com este prompt incluído no projeto base, a arquitetura WebAuthn e as "pedras no caminho" de incompatibilidade mobile vs web browser não devem ser mais um mistério!**
