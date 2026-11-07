# Platform Organization Management Mode Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents are available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let platform administrators securely open and configure a single organization before its first administrator accepts an invitation.

**Architecture:** Keep platform identities separate from tenant profiles. Store a short-lived management session in the private schema, bound to the authenticated Supabase `session_id`, organization, actor, reason, and fixed expiry. Resolve tenant scope only inside database authorization helpers; show a persistent management banner in the app shell and audit management starts, stops, sensitive-page reads, and tenant writes.

**Tech Stack:** Next.js 16, React 19, Supabase Auth/Postgres/RLS, pgTAP, Supabase CLI.

**Approved design:** `docs/superpowers/specs/2026-11-06-gestao-plataforma-organizacoes-design.md`, section “Abrir a gestão de uma organização”.

---

## File Map

- Create a Supabase migration using `supabase migration new organization_management_mode`; add the private session table, session-bound context helpers, start/stop/context/read RPCs, tenant-scope policies, and management audit capture.
- Create `supabase/tests/organization_management_mode.test.sql` for session validity, platform authorization, tenant isolation, draft access, scope changes, expiry, revocation, and audit behavior.
- Modify `src/app/settings/organizations/page.tsx` to expose “Abrir gestão”, collect a required access reason, and begin the scoped session.
- Modify `src/components/app-shell.tsx` to load the trusted management context, refresh tenant-dependent state on context changes, render the persistent banner, and end the session.
- Modify `src/app/globals.css` for responsive, accessible management-mode banner and confirmation styling.
- Update `docs/superpowers/specs/2026-11-06-gestao-plataforma-organizacoes-design.md` only if implementation decisions require a documented clarification.

## Task 1: Specify session security with failing database tests

**Files:**
- Create: `supabase/tests/organization_management_mode.test.sql`
- Test against the disposable Supabase stack; never run pgTAP against production.

- [ ] Add tests proving a platform administrator with no active management session has no tenant scope.
- [ ] Add tests for start authorization: reject non-platform users, missing/blank reason, missing Auth `session_id`, nonexistent Auth session, inactive organization, and invalid organization ID.
- [ ] Add tests proving an authorized session resolves only its selected organization and does not create or mutate a tenant profile.
- [ ] Add tests for same-Auth-session scope replacement, manual close, fixed expiry, Auth-session revocation, and platform-admin revocation.
- [ ] Add tests proving expired, closed, revoked, or mismatched sessions immediately lose tenant access, including writes.
- [ ] Run the focused pgTAP file and confirm it fails because management RPCs/helpers do not exist yet.

## Task 2: Implement private session lifecycle and trusted scope

**Files:**
- Create: CLI-generated `supabase/migrations/<timestamp>_organization_management_mode.sql`
- Test: `supabase/tests/organization_management_mode.test.sql`

- [ ] Create `private.platform_organization_management_sessions` with actor, Auth session ID, organization, reason, start/expiry/end timestamps, end reason, RLS enabled, and no client table grants.
- [ ] Enforce one open scope per authenticated Supabase session with a partial unique index; allow a new scope after the old one is ended or expired.
- [ ] Add a private helper that validates `auth.uid()`, the JWT `session_id`, the matching row in `auth.sessions`, unexpired/unended state, and a still-active platform-admin grant every time scope is resolved.
- [ ] Update `private.current_organization_id()` to prefer a valid management scope, otherwise preserve the existing active tenant-profile behavior; never accept an organization ID from the browser as scope authority.
- [ ] Add authenticated RPCs to begin a session, end the current session, and read the trusted current management context; bind every operation to the current Auth session.
- [ ] On scope switch, atomically end the prior session before creating the new one; use a fixed 60-minute expiry with no implicit renewal.
- [ ] Add pgTAP coverage for the session helpers and RPCs; rerun the focused test file until green.

## Task 3: Extend tenant authorization without widening platform access

**Files:**
- Modify: CLI-generated management migration
- Test: `supabase/tests/organization_management_mode.test.sql`

- [ ] Audit current RLS policies, storage policies, and `SECURITY DEFINER` functions for direct profile-role/organization checks that bypass `private.current_organization_id()`.
- [ ] Inventory every page permission, RPC, storage bucket, and Edge Function used by tenant pages; keep unverified routes blocked until its authorization path is covered.
- [ ] Permit the management context only the tenant-admin-equivalent checks needed for the selected organization; do not satisfy or bypass platform-admin-only controls such as `platform_admins` administration.
- [ ] Permit management writes to draft and awaiting-admin organizations while retaining the existing active-organization restrictions for ordinary tenant users; do not open suspended organizations through management mode.
- [ ] Preserve all existing tenant isolation predicates and verify queries against a second organization return zero rows and cannot mutate its data.
- [ ] Add append-only management events for session start/end and a row-level audit trigger on tenant tables with `organization_id`; store only actor, session, organization, table, operation, record key, and timestamp, not business payloads or PII.
- [ ] Add an authenticated read-audit RPC with an allowlist of sensitive HR resource routes; reject arbitrary resource names and calls without a valid management session.
- [ ] Test cross-tenant reads/writes under `authenticated` and anonymous denial under `anon`, using privileged role only for fixture setup.
- [ ] Test cross-tenant storage reads/writes, sensitive attachment access, direct RPC attempts, sensitive-read auditing, and audit immutability.
- [ ] Record expiry and platform-admin revocation as auditable session events; test both paths.
- [ ] Pin `search_path`, schema-qualify references, and explicitly revoke default `PUBLIC`/`anon` execution for every privileged function.
- [ ] Run the focused and full pgTAP suites and SQL lint on the disposable stack.

## Task 4: Add organization entry and visible session controls

**Files:**
- Modify: `src/app/settings/organizations/page.tsx`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/app/globals.css`

- [ ] Add “Abrir gestão” to eligible organization cards; require a nonblank reason and show a confirmation naming the organization and the 60-minute limit.
- [ ] Start the session through the RPC, then navigate to the organization dashboard and reload tenant data under the database-resolved scope.
- [ ] Load the management context from the trusted context RPC; do not derive the target tenant from local storage, URL query parameters, or editable profile fields.
- [ ] Render a persistent banner identifying the organization, platform-management mode, expiry, and a clear “Sair da gestão” action on every tenant page.
- [ ] On exit, call the end-session RPC before navigating back to platform organization management; handle expired/revoked sessions by clearing tenant UI state and returning to the platform scope.
- [ ] Notify other tabs on session start/end and force them to reload context before showing any tenant data.
- [ ] Record entry to the allowlisted sensitive HR routes through the read-audit RPC, deduplicated per route/session to avoid logging every rerender.
- [ ] Test keyboard access, responsive layout, reason validation, loading/errors, session expiry handling, and screen-reader labels.

## Task 5: Verify and publish safely

**Files:**
- Update: `docs/superpowers/specs/2026-11-06-gestao-plataforma-organizacoes-design.md` if behavior changed
- Test: `supabase/tests/organization_management_mode.test.sql`

- [ ] Run the full disposable-database pgTAP suite, SQL lint, `npm.cmd run lint`, `npm.cmd run check:encoding`, and `npm.cmd run build`.
- [ ] Before any production apply, confirm linked project ref, remote migration ledger, and a recoverable backup; the dry-run must list exactly the reviewed migration.
- [ ] Keep the migration backward-compatible with the currently deployed app; apply DB, deploy only required Edge Functions, then app, and smoke-test each stage.
- [ ] Deploy only changed Edge Functions if the authorization audit finds a tenant-access path through them; verify deployed versions afterward.
- [ ] Push the tested commit to GitHub `main`, verify the Vercel production deployment is `READY`, then check the login and organization-management routes.
- [ ] Validate with the platform administrator account that a draft opens in the selected tenant, writes stay within it, the banner identifies the scope, exit restores platform mode, and audit events exist without PII payloads.

