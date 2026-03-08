**⛔ REGRA N1:** JAMAIS apague/mova arquivos fora de `C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\` — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.

# Prompt Master: Geração, Download e Compartilhamento de PDF em React (Web & Mobile/PWA)

> **Objetivo Final:** Ensinar a IA a criar um fluxo robusto para lidar com Blobs de PDF gerados no frontend. O objetivo é contornar as severas limitações de navegadores in-app (Instagram/Facebook Browser) e PWAs no iOS/Android, oferecendo ao usuário um Modal interativo contendo 3 opções à prova de falhas: **Visualizar, Baixar e Compartilhar Nativo (WhatsApp, etc)**.

---

## 🛑 1. O Paradoxo do PDF no Mobile

Gerar o PDF via `jsPDF` (`const blob = doc.output('blob')`) é fácil. O pesadelo arquitetônico é como entregar esse arquivo ao usuário em um cenário Mobile (React PWA ou Web).
- Se você usar o truque clássico de injetar uma tag `<a>` com `download`, o iPhone (Safari) e vários navegadores In-App **bloqueiam ou ignoram** o download silenciosamente.
- Se você abrir numa nova aba (`window.open`), frequentemente o bloqueador de pop-up fecha, ou o WebView mostra uma tela em branco.

**Solução:** Abster-se de fazer a ação automática. A IA **DEVE** criar um `<Modal>` ou "Bottom Sheet" contendo botões explícitos e separados para as ações.

## 🛠️ 2. A Injeção de Segurança (O Modal de Ações)

Sempre que a geração do PDF terminar (assíncrono), passe o `Blob` e o `FileName` para o estado que controla este Modal central.

```tsx
// O Estado necessário
const [pdfActionModal, setPdfActionModal] = useState<{ isOpen: boolean; blob: Blob | null; fileName: string }>({
    isOpen: false, blob: null, fileName: '' 
});
```

A IA **DEVE** implementar as 3 lógicas de botões abaixo de maneira idêntica:

### A. Botão: Visualizar (Forçar In-Browser)
Permite que o navegador use o renderizador nativo de PDF na tela sem baixar fisicamente para o cartão SD. Crucial para leitura rápida.

```tsx
<button onClick={() => {
    if (!pdfActionModal.blob) return;
    const url = URL.createObjectURL(pdfActionModal.blob);
    window.open(url, '_blank', 'noopener');
    
    // Revocação de memória postergada. Dê tempo para a aba nova carregar.
    setTimeout(() => URL.revokeObjectURL(url), 60000); 
}}>
  Visualizar PDF
</button>
```

### B. Botão: Baixar (Desktop Fallback)
A tática clássica do HTML5 que funciona perfeitamente em PCs e no Android moderno, forçando o arquivo `galeria.pdf` para a pasta de Downloads.

```tsx
<button onClick={() => {
    if (!pdfActionModal.blob) return;
    const url = URL.createObjectURL(pdfActionModal.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = pdfActionModal.fileName; // Ex: 'relatorio_2026.pdf'
    a.click();
    
    setTimeout(() => URL.revokeObjectURL(url), 5000); // Limpa a RAM do Blob
}}>
  Baixar para o Dispositivo
</button>
```

### C. Botão Dourado: Compartilhar (Nativo PWA)
Esta é a função mais preciosa para Mobile. Ela invoca a API nativa do iOS/Android (Web Share API Nível 2) abrindo diretamente a bandeja do **WhatsApp, Telegram, AirDrop** etc, já enxertando o arquivo PDF nela.

**Regra Crítica para a IA**: Você **TEM** que criar um objeto `File` a partir do `Blob` antes de passar para `navigator.share`, e verificar se o browser suporta compartilhamento de arquivos!

```tsx
// 1. Condicional de Renderização do Botão: Só exiba se o telefone/browser suportar!
{typeof navigator.share === 'function' && navigator.canShare && (
    <button onClick={async () => {
        if (!pdfActionModal.blob) return;
        
        // 2. Transmutação Mágica (Blob -> File) vital para o WhatsApp entender!!
        const pdfFile = new File([pdfActionModal.blob], pdfActionModal.fileName, { type: 'application/pdf' });
        
        try {
            await navigator.share({
                title: 'Meu Relatório', // Opcional
                text: 'Veja o relatório anexo.', // Corpo da mensagem no WhatsApp
                files: [pdfFile] // O Array contendo nosso File transmutado
            });
        } catch (e) {
            // Cancelado pelo usuário (User dismissed dialog), apenas ignore.
            console.log('Compartilhamento cancelado ou falho', e);
        }
    }}>
      Compartilhar Arquivo
    </button>
)}
```

---

Quando aplicar este Blueprint em um projeto futuro, garanta que a biblioteca de PDF use puramente `.output('blob')` de forma isolada, não misturando a lógica de criação pesada com a lógica simples e reativa desta interface Mobile-First de entrega!
