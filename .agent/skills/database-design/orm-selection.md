**⛔ REGRA N1:** JAMAIS apague/mova arquivos fora de `C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\` — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.

# ORM Selection (2025)

> Choose ORM based on deployment and DX needs.

## Decision Tree

```
What's the context?
│
├── Edge deployment / Bundle size matters
│   └── Drizzle (smallest, SQL-like)
│
├── Best DX / Schema-first
│   └── Prisma (migrations, studio)
│
├── Maximum control
│   └── Raw SQL with query builder
│
└── Python ecosystem
    └── SQLAlchemy 2.0 (async support)
```

## Comparison

| ORM | Best For | Trade-offs |
|-----|----------|------------|
| **Drizzle** | Edge, TypeScript | Newer, less examples |
| **Prisma** | DX, schema management | Heavier, not edge-ready |
| **Kysely** | Type-safe SQL builder | Manual migrations |
| **Raw SQL** | Complex queries, control | Manual type safety |
