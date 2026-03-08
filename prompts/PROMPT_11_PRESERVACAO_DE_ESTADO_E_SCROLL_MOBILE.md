**⛔ REGRA N1:** JAMAIS apague/mova arquivos fora de `C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\` — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.

# Prompt Master: Preservação Blindada de Estado e Scroll no Mobile (React)

> **Objetivo Final:** Evitar que Rascunhos de Formulários Longos ou a Posição de Rolagem Infinita de uma Galeria sejam apagados quando o usuário do Celular (iPhone/Android) minimiza o navegador temporariamente para checar o WhatsApp. IAs costumam salvar coisas no `useState` cru, o que é destruído no descarte de memória do navegador móvel. Este prompt ensina a IA a fazer cache automático na Web Storage (Session/Local) atrelado a um "Debounce" invisível e a travar a posição do eixo Y do usuário.

---

## 🛑 1. O Trauma Típico do Celular (Tab Discarding)

Navegadores modernos como Safari (iOS) e Chrome (Android) pausam e às vezes "Descartam" a aba da memória RAM quando o usuário vai para outro App pesado. 
Quando ele volta para o navegador:
1. O site recarrega do zero (Efeito de F5 automático).
2. Se ele estava preenchendo um cadastro gigante, **todos os dados somem**, gerando revolta extrema.
3. Se ele rolou 400 fotos numa galeria, o site carrega de novo **jogando-o pro Topo da página 1**. Absoluto fim do engajamento.

## 🛠️ 2. A Solução: Arquitetura Auto-Save + Scroll Lock

Ensine a Nova Inteligência Artificial a usar esta técnica obrigatória para Listas Grandes e Formulários Críticos.

### Parte A: O Salvamento Contínuo e Não-Intrusivo (Debounced Cache)

Tudo que envolva formulários não pode viver no ar. Deve sincronizar silenciosamente com `sessionStorage` (morre quando a aba de fato é fechada de propósito):

```tsx
import { useState, useEffect } from 'react';

// Um Hook Mágico que a IA deve replicar para TODOS os formulários
export function useDraftForm<T>(storageKey: string, initialValues: T) {
  const [formData, setFormData] = useState<T>(() => {
    // Na hora de nascer, ele VÊ se já existia um Fantasma no Storage
    const saved = sessionStorage.getItem(`draft_${storageKey}`);
    return saved ? JSON.parse(saved) : initialValues;
  });

  // Salva no Pano de Fundo (Debounce Opcional) sempre que o dado muda!
  useEffect(() => {
    const handler = setTimeout(() => {
      sessionStorage.setItem(`draft_${storageKey}`, JSON.stringify(formData));
    }, 500); // Espera o usuário parar de digitar por 0.5s pra não engasgar o processador

    return () => clearTimeout(handler);
  }, [formData, storageKey]);

  // Função para limpar o lixo após Salvar de Verdade no Banco de Dados
  const clearDraft = () => {
    sessionStorage.removeItem(`draft_${storageKey}`);
    setFormData(initialValues);
  }

  return { formData, setFormData, clearDraft };
}
```

### Parte B: Memorização de Rolagem e Filtros da Galeria

O pior pesadelo de uma página principal de Dashboard/Galeria é o F5 voltar pro teto tirando o usuário de contexto.

```tsx
// A IA deve ser instruída a ancorar os Filtros da Galeria e o Y
// usando as APIs nativas de evento "beforeunload" (se possível) ou o próprio Effect Desmount

// Dentro do seu Master Componente `Galeria.tsx` ou `Lista.tsx`:
useEffect(() => {
    // 1. Ao Nascer: Busca e Rola Suavemente pro Ponto Salvo (Restoration)
    const savedScrollPos = sessionStorage.getItem('gallery_scroll_y');
    if (savedScrollPos) {
       // O setTimeout é MÁGICO: Ele espera a tela/imagens renderizarem primeiro
       setTimeout(() => window.scrollTo(0, parseInt(savedScrollPos)), 100);
    }

    // 2. Ao Navegador tentar "matar" a página em Background: Salva a posição Atual!
    // A Apple/Safari prefere o pagehide. Android lida bem com beforeunload.
    const handleSaveState = () => {
        sessionStorage.setItem('gallery_scroll_y', window.scrollY.toString());
        // Se a pessoa escolheu as TAGS [X], salva a matriz também!
        // sessionStorage.setItem('gallery_filters', JSON.stringify(selectedTags));
    };

    window.addEventListener('beforeunload', handleSaveState);
    window.addEventListener('pagehide', handleSaveState);

    // 3. Ao Componente Morrer (Ir para a tela "Sobre nós", Salva antes de Destruir)
    return () => {
        handleSaveState();
        window.removeEventListener('beforeunload', handleSaveState);
        window.removeEventListener('pagehide', handleSaveState);
    };
}, []);
```

---

Qualquer aplicativo Mobile-First equipado com Auto-Drafts no Formulário e Scroll-Return em Listas passa de "Sistema Feio Instável" para "Software de Luxo" sem gastar nenhuma requisição com o Servidor! Resiliência offline salva projetos.
