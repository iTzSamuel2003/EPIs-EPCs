# EPIS+

Sistema web para controle de EPIs e EPCs, iniciado pela Fase 1 do escopo.

## Arquitetura

- `src/app`: páginas do App Router e estilos globais.
- `src/lib/supabase`: clientes Supabase para browser, servidor e renovação de sessão.
- `src/types`: contratos TypeScript do domínio.
- `supabase/migrations`: modelo relacional, índices, constraints e RLS.

Fluxo: navegador → Next.js App Router → Supabase Auth/Postgres. As operações futuras de estoque deverão ser implementadas como transações no banco, registrando sempre `stock_movements` e `audit_logs`.

## Relacionamentos principais

`organizations` 1:N `profiles`, `materials`, `employees`, `categories`, `suppliers`, `material_lots`, `stock_movements` e `audit_logs`.

`materials` 1:N `material_lots`; `material_lots` 1:N `stock_movements`; categorias e fornecedores são referências opcionais. A integridade impede lote com quantidade disponível negativa e exige CA para EPI.

## Rodar localmente

```bash
npm install
Copy-Item .env.example .env.local
npm run dev
```

Preencha `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` no `.env.local`. Depois execute a migration pelo Supabase CLI ou SQL Editor. Sem essas variáveis, o dashboard continua disponível em modo demonstrativo e a rota `/login` fica pronta para conectar ao projeto.

## Validação

`npm run lint` e `npm run build` devem passar antes de cada entrega.

