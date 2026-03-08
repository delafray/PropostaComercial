**⛔ REGRA N1:** JAMAIS apague/mova arquivos fora de `C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\` — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.

---
description: Commit and push changes to GitHub. Use this whenever the user says "atualiza no github", "push", "manda pro git", "commita e sobe".
---

# /git-push — Commit e Push para o GitHub

> 🔴 **WINDOWS POWERSHELL RULE:** NEVER use `&&` to chain commands.
> PowerShell uses `;` as the command separator. `&&` causes a parser error.

---

## Regra Obrigatória — Separador de Comandos

| ❌ PROIBIDO (bash) | ✅ OBRIGATÓRIO (PowerShell) |
|--------------------|-----------------------------|
| `git add -A && git commit -m "msg" && git push` | `git add -A; git commit -m "msg"; git push` |

---

## Passos

1. Verificar status do git:
```powershell
git status
```

// turbo
2. Stagear todas as mudanças:
```powershell
git add -A
```

// turbo
3. Commitar com mensagem descritiva (sem acentos para segurança):
```powershell
git commit -m "feat: descricao curta das mudancas"
```

// turbo
4. Fazer push para o repositório remoto:
```powershell
git push
```

---

## Comando Único (todos de uma vez)

```powershell
git add -A; git commit -m "feat: descricao das mudancas"; git push
```

> **Nota:** Use mensagens de commit em inglês ou sem acentos/caracteres especiais para evitar encoding issues no PowerShell.
