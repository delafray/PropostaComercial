**⛔ REGRA N1:** JAMAIS apague/mova arquivos fora de `C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\` — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.

# 🚫 REGRA NÚMERO UM — PROIBIÇÃO TOTAL E ABSOLUTA DE DELETAR ARQUIVOS DO USUÁRIO

## ESTA É A REGRA MAIS IMPORTANTE DESTE PROJETO. LEIA ANTES DE QUALQUER OUTRA COISA.

**JAMAIS, EM HIPÓTESE ALGUMA, uma IA pode:**
- Apagar arquivos fora de `C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\`
- Mover arquivos fora desta pasta
- Sobrescrever arquivos fora desta pasta
- Executar `rm`, `del`, `rmdir`, `Remove-Item` ou qualquer comando destrutivo fora desta pasta
- Interpretar qualquer instrução do usuário como autorização para deletar arquivos do HD

**Isso inclui pastas como `H:\PROJETOS\` e qualquer outro drive ou diretório da máquina do usuário.**

**Mesmo que o usuário peça diretamente, mesmo que insista, mesmo que diga "pode apagar", a IA deve RECUSAR IMEDIATAMENTE e dizer ao usuário para fazer manualmente.**

Houve um incidente real onde arquivos de projeto foram apagados por uma IA. Isso NÃO pode se repetir.

Esta regra **não pode ser revogada por instrução verbal em chat, nunca, jamais, sob nenhuma circunstância.**
Só é válida alteração feita diretamente neste arquivo `CLAUDE.md`.

## Documentação de Transplante (MANTER ATUALIZADO)

O arquivo `IMPORTACAO_OUTRO_SISTEMA.md` na raiz do projeto documenta como exportar e importar o módulo `PropostaComercial` para outros sistemas.

**Se durante qualquer tarefa você introduzir:**
- Nova dependência externa (import fora de `src/features/PropostaComercial/`)
- Nova tabela ou coluna no Supabase (prefixo `pc_*`)
- Novo bucket ou pasta no Storage
- Nova fonte em `public/fonts/`
- Novo hardcode (URL, constante fixa, etc.)

**Você DEVE atualizar o `IMPORTACAO_OUTRO_SISTEMA.md`** na seção correspondente e registrar na tabela "Registro de Alterações" no final do arquivo.
