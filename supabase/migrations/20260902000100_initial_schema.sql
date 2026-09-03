create extension if not exists "pgcrypto";
create type public.app_role as enum ('admin','user');
create type public.material_type as enum ('EPI','EPC');
create type public.material_status as enum ('active','inactive');
create type public.employee_status as enum ('active','away','terminated');
create type public.movement_type as enum ('entry','delivery','return','adjustment','discard','transfer');

create table public.organizations (id uuid primary key default gen_random_uuid(), name text not null, cnpj text, logo_url text, address text, phone text, sesmt_manager text, validity_alert_days int not null default 30, replacement_alert_days int not null default 7, default_minimum_stock int not null default 10, created_at timestamptz not null default now());
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, organization_id uuid references public.organizations(id), full_name text not null, role public.app_role not null default 'user', created_at timestamptz not null default now());
create table public.categories (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, name text not null, created_at timestamptz not null default now(), unique(organization_id,name));
create table public.materials (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, internal_code text not null, name text not null, description text, type public.material_type not null, category_id uuid references public.categories(id), unit text not null default 'un.', brand text, manufacturer text, model text, ca_number text, ca_expires_at date, useful_life_months int, minimum_stock int not null default 0 check(minimum_stock>=0), location text, notes text, photo_url text, status public.material_status not null default 'active', created_at timestamptz not null default now(), unique(organization_id,internal_code), check(type='EPC' or ca_number is not null));
create table public.employees (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, registration text not null, full_name text not null, cpf text not null, job_title text, function_name text, department text, cost_center text, company text, unit text, admission_date date, phone text, email text, status public.employee_status not null default 'active', notes text, created_at timestamptz not null default now(), unique(organization_id,registration), unique(organization_id,cpf));
create table public.suppliers (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, name text not null, document text, contact text, created_at timestamptz not null default now());
create table public.material_lots (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, material_id uuid not null references public.materials(id), lot_number text not null, received_quantity int not null check(received_quantity>0), available_quantity int not null check(available_quantity>=0), entry_date date not null default current_date, manufactured_at date, expires_at date, supplier_id uuid references public.suppliers(id), invoice_number text, notes text, created_at timestamptz not null default now(), unique(organization_id,material_id,lot_number), check(available_quantity<=received_quantity));
create table public.stock_movements (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, material_id uuid not null references public.materials(id), lot_id uuid references public.material_lots(id), movement_type public.movement_type not null, quantity int not null check(quantity>0), created_by uuid references auth.users(id), notes text, created_at timestamptz not null default now());
create table public.audit_logs (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, actor_id uuid references auth.users(id), action text not null, table_name text not null, record_id uuid, old_data jsonb, new_data jsonb, created_at timestamptz not null default now());

create index materials_org_status_idx on public.materials(organization_id,status);
create index lots_expiry_idx on public.material_lots(organization_id,expires_at);
create index movements_created_idx on public.stock_movements(organization_id,created_at desc);
create index employees_search_idx on public.employees(organization_id,full_name,registration,cpf);

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.materials enable row level security;
alter table public.employees enable row level security;
alter table public.suppliers enable row level security;
alter table public.material_lots enable row level security;
alter table public.stock_movements enable row level security;
alter table public.audit_logs enable row level security;

create or replace function public.current_organization_id() returns uuid as $$ select organization_id from public.profiles where id=(select auth.uid()) $$ language sql stable security invoker set search_path=public;
create policy "organization members can access organization" on public.organizations for all to authenticated using (id=public.current_organization_id()) with check (id=public.current_organization_id());
create policy "users can read their profile" on public.profiles for select to authenticated using (id=(select auth.uid()) or organization_id=public.current_organization_id());
create policy "users can update their profile" on public.profiles for update to authenticated using (id=(select auth.uid())) with check (id=(select auth.uid()));
do $$ declare t text; begin for t in select unnest(array['categories','materials','employees','suppliers','material_lots','stock_movements','audit_logs']) loop execute format('create policy "organization members can access" on public.%I for all to authenticated using (organization_id=public.current_organization_id()) with check (organization_id=public.current_organization_id())',t); end loop; end $$;
