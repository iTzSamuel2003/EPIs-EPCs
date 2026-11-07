# Organization Drafts and Invitations Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let platform administrators create and configure organization drafts without administrator contact details, then invite the first organization administrator later without disrupting existing tenants.

**Architecture:** Keep platform administrators separate from company profiles. Add a lifecycle status to organizations, classify invitations as first-admin or member, and perform lifecycle transitions through narrowly scoped private database functions exposed by authenticated wrappers. Update the existing organization-management page to create drafts, edit draft details, manage first-admin invitations, and show status. A later implementation plan will cover the temporary organization-management session and access to all tenant modules, as specified in `docs/superpowers/specs/2026-11-06-gestao-plataforma-organizacoes-design.md`.

**Tech Stack:** Next.js 16, React 19, Supabase Postgres/RLS/Auth, Supabase CLI, TypeScript.

---

## File Map

- Create a Supabase migration using `supabase migration new organization_drafts_and_lifecycle`; the CLI-generated file will add lifecycle/invitation metadata, platform audit events, and restricted RPCs.
- Create `docs/superpowers/specs/2026-11-06-organizacao-schema-inventory.md` with the verified remote/local schema, RLS policies, invitation RPCs, tenant references, and Storage paths that the draft-deletion guard must cover.
- Create `supabase/tests/organization_lifecycle.test.sql` for database-level lifecycle, authorization, and compatibility checks.
- Modify `src/app/settings/organizations/page.tsx` to separate draft creation/editing from first-admin invitation and display lifecycle state.
- Modify `src/app/settings/users/page.tsx` only if needed to block existing member-invitation creation/revocation while an organization is suspended.
- Modify `src/app/globals.css` only for lifecycle badges and responsive controls on the organization-management page.
- Modify generated/hand-maintained Supabase types only if this repository has an existing type-generation workflow; otherwise keep typed RPC result interfaces local to the page.
- Update the relevant organization-management documentation after implementation.

## Task 1: Inventory current tenant boundaries

**Files:**
- Create: `docs/superpowers/specs/2026-11-06-organizacao-schema-inventory.md`

- [x] Inspect local migrations and the linked Supabase schema in read-only mode before designing DDL.
- [x] Inventory public tables with `organization_id`, tables referencing organization-owned rows indirectly, organization/invitation policies and RPCs, profile/Auth behavior, Storage buckets and path conventions, scheduled database jobs, all Edge Functions that use organization scope or service-role credentials, and any platform scope/session table.
- [x] Compare local migration history with the hosted migration history; record drift or missing migrations.
- [x] Record the inventory and use it to define the exact tenant-row and Storage checks for safe draft deletion.
- [x] Confirm no management-session table exists in this phase; require the follow-up migration to extend the deletion guard before enabling session creation.

## Task 2: Add failing database behavior tests

**Files:**
- Create: `supabase/tests/organization_lifecycle.test.sql`

- [ ] Write pgTAP cases for a platform administrator creating a draft with no admin email or invitation.
- [x] Add the initial 12 structural assertions for lifecycle columns, RPCs, audit table, and active-organization scope; run them against the baseline and confirm all 12 fail.
- [ ] Assert a non-platform user cannot create or edit organization drafts.
- [ ] Assert creating a first-admin invitation moves `draft` to `awaiting_admin`, records `invite_kind = 'first_admin'`, and sets a seven-day expiry.
- [ ] Assert revoking the last pending first-admin invitation returns the organization to `draft`; reissuing makes the prior token unusable.
- [ ] Assert an unlinked user can accept a valid first-admin invitation, an existing same-organization member is promoted only by that explicit invitation, and a same-organization admin retry is idempotent.
- [ ] Assert unverified email, wrong token/email, expired token, revoked token, suspended organization, and a profile linked to another organization are rejected without consuming the invitation or moving the profile.
- [ ] Assert member invitation creation and revocation are denied while the organization is suspended.
- [ ] Assert empty-draft deletion writes an audit event and deletion is refused if any profile, invitation (including revoked), tenant row, or organization-prefixed Storage object exists; in phase 1, verify the guard handles the absent session table as “no session can exist.” Defer a positive active-session deletion test until the follow-up creates the table and concrete guard.
- [ ] Assert every manual lifecycle transition records actor, reason, prior state, and new state; verify reactivation restores each possible prior state (`draft`, `awaiting_admin`, and `active`).
- [ ] Assert the first-admin invitee is linked as `admin` with the full page set scoped to that organization, and verify only a token hash is persisted and the old raw token cannot be recovered after reissue.
- [ ] Assert company-member reads and writes are denied in `draft`, `awaiting_admin`, and `suspended`, and restored for `active` organizations.
- [ ] Assert active legacy organizations and legacy member invitations retain their existing acceptance behavior.
- [ ] Run `supabase.cmd test db`; confirm the new behavior tests fail because the lifecycle RPCs/schema are not implemented yet.

## Task 3: Add lifecycle schema and audit trail

**Files:**
- Create: CLI-generated migration `supabase/migrations/<timestamp>_organization_drafts_and_lifecycle.sql`

- [ ] Add `organizations.lifecycle_status` with allowed values `draft`, `awaiting_admin`, `active`, `suspended`; migrate all existing organizations to `active`.
- [ ] Add `organization_invitations.invite_kind`, `revoked_at`, and `revoked_by`; migrate all existing invitations to `member`.
- [ ] Add a private append-only platform organization event table that can retain the organization ID and minimal snapshot after a draft deletion.
- [ ] Add uniqueness/index constraints preventing more than one unaccepted, unrevoked first-admin invitation per organization.
- [ ] Treat absence of a management-session table as “no management sessions can exist” in this phase; use an existence-aware guard and require the future management-mode migration to replace it with a concrete active-session check before granting session-start execution.
- [ ] Make ordinary organization scope resolve only to `active` organizations, so existing tenant RLS and functions using the scope helper deny company-member data access for `draft`, `awaiting_admin`, and `suspended` states; audit and update any policies/functions that bypass the shared helper.
- [ ] Revoke direct table writes that would bypass lifecycle transitions; retain only the grants required by existing organization-member invitation flows.
- [ ] Use private-schema `SECURITY DEFINER` functions only where bypassing RLS is required; pin `search_path` to empty, schema-qualify references, and grant execution only to `authenticated`.

## Task 4: Implement platform lifecycle RPCs

**Files:**
- Modify: CLI-generated migration `supabase/migrations/<timestamp>_organization_drafts_and_lifecycle.sql`

- [ ] Add authenticated wrappers and private implementations for listing organizations with lifecycle state, creating a draft, editing draft details, and recording lifecycle events.
- [ ] Add first-admin invitation creation/reissue/revocation; validate actor, organization state, email format, page paths, token format, and active-invitation uniqueness inside the database transaction.
- [ ] Set invitation expiry to seven days; when reissuing, revoke expired or replaced pending tokens before creating the new invitation.
- [ ] Block first-admin invitation create/reissue/revoke while `suspended`; permit them only in the lifecycle states specified for first-admin setup.
- [ ] Gate existing member invitation creation/revocation and its RLS policy on an `active` organization; keep first-admin invitation operations separate from member invitation permissions.
- [ ] Ensure every tenant-scoped read/write policy, Storage policy, and security-definer RPC discovered in the preflight denies inactive-organization members; explicitly guard any function that accepts an organization ID instead of deriving it from the shared helper.
- [ ] Add explicit active-organization checks to privileged Edge Functions that bypass RLS for portal, request/course submission, and employee signature-link reads/writes; deny access when organization state is not `active`.
- [ ] Implement suspension as a lifecycle transition that records the prior state and reason; reactivation restores that exact state.
- [ ] Add draft deletion only through an RPC that locks the organization and refuses deletion if any profile, invitation (including revoked), tenant row, organization-prefixed Storage object, or active management session exists.
- [ ] Ensure every successful manual transition records actor, previous/new state, reason, and timestamp in the append-only event table.

## Task 5: Preserve invitation acceptance rules

**Files:**
- Modify: CLI-generated migration `supabase/migrations/<timestamp>_organization_drafts_and_lifecycle.sql`
- Test: `supabase/tests/organization_lifecycle.test.sql`

- [ ] Replace the internal acceptance implementation without changing the current public RPC signatures used by `/invite/[token]` and `/organization-pending`.
- [ ] Atomically require the matching token, verified Auth email, `accepted_at IS NULL`, `revoked_at IS NULL`, and `expires_at > now()` for token-based and email-based pending-invitation entry points.
- [ ] Permit `first_admin` acceptance only in `awaiting_admin`; activate the organization on success.
- [ ] Permit existing `member` invitations only for active organizations; preserve unlinked-user association, same-organization idempotence, and reject users linked to another organization without consuming the invitation.
- [ ] Allow an explicit `first_admin` invitation to promote an existing same-organization member to `admin`; do not move profiles between organizations.
- [ ] Block invitation acceptance while the organization is suspended; record the resulting lifecycle event on successful first-admin activation.
- [ ] Confirm first-admin invitee permissions include all current `PAGE_PERMISSIONS` and remain restricted to the invited organization.
- [ ] Re-run the database tests and verify all compatibility cases pass.

## Task 6: Update organization-management UI

**Files:**
- Modify: `src/app/settings/organizations/page.tsx`
- Modify: `src/components/app-shell.tsx` if needed to show a blocked-state message to members of non-active organizations.
- Modify: `src/app/globals.css`

- [ ] Change the create form to require only an organization label/name; keep CNPJ and other company details optional and remove admin email from creation.
- [ ] Add clear `Rascunho`, `Aguardando administrador`, `Ativa`, and `Suspensa` status indicators.
- [ ] Ensure company members in non-active organizations cannot navigate into modules and receive a clear status message; database RLS remains the authority.
- [ ] Add editing for draft company details and a distinct first-admin invitation flow; generate/copy the invitation URL only after an email is available.
- [ ] Show invitation pending/expired/revoked state; expose the raw link only in the immediate create/reissue response, and explain that reissuing invalidates the prior link and returns a replacement.
- [ ] Add suspension/reactivation and empty-draft deletion controls with explicit confirmation and reason where required.
- [ ] Keep the platform administrator visibly distinct; do not add them to company members or mutate their profile role/organization.
- [ ] Verify responsive layout and accessible status/feedback text.

## Task 7: Verify and document

**Files:**
- Update: relevant organization-management documentation and schema inventory

- [ ] Run `supabase.cmd test db` against the local Supabase stack; if the stack is unavailable, report the limitation and still run SQL lint/static checks available in the repo.
- [ ] Run `npm.cmd run lint`, `npm.cmd run build`, and `npm.cmd run check:encoding`.
- [ ] Inspect the generated migration for correct RLS, grants, function search paths, and legacy-data backfill.
- [ ] Reconfirm that the follow-up management-mode migration extends the deletion guard with an actual active-session check before exposing any session-start RPC.
- [ ] Do not apply migrations to the hosted Supabase project or push/deploy until the local migration and app have been verified.
- [ ] Report that the later session-scoped organization-management mode remains a separate next implementation phase; this plan alone does not yet grant the platform administrator access to tenant modules.

## Status da execução local — 2026-11-07

- Implementados nesta fase: cadastro e edição de rascunhos sem dados do administrador, convite posterior do primeiro administrador, auditoria de ciclo de vida, suspensão/reativação, exclusão segura de rascunho vazio, bloqueio de escopo inativo, proteção das Edge Functions do portal e interface de gestão da plataforma.
- Validação local: 80 testes pgTAP passam no projeto Supabase descartável; lint SQL, lint frontend, build e verificação de codificação foram executados localmente.
- Ainda não validado por navegador autenticado: fluxo visual completo de criar rascunho, convidar administrador e concluir o primeiro acesso.
- Cenários de borda ainda não cobertos por pgTAP: promoção/idempotência de perfil já vinculado à mesma organização e autorização direta de leitura/escrita em cada tabela tenant para todos os estados inativos. O fluxo de exclusão já é testado contra perfil, convite revogado, linha com `organization_id` e objeto Storage.
- Não publicado: o histórico local e o remoto do Supabase ainda divergem. As duas migrações remotas de grants para `base_id` foram reconstruídas localmente; a nova migração de ciclo de vida não foi aplicada no projeto hospedado, e ainda não houve push/deploy.
- Fora desta fase: sessão temporária de gestão que permita ao administrador da plataforma entrar nos módulos de uma organização. A exclusão deverá verificar sessões ativas quando essa tabela for criada.
