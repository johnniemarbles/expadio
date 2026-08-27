-- Communication control-plane entities: platform defaults, domain verification, and template lineage.
create table if not exists platform.communication_sending_domains (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('PLATFORM','TENANT','ORGANIZATION')),
  tenant_id uuid references platform.tenants(tenant_id),
  organization_id uuid,
  domain text not null,
  status text not null default 'PENDING' check (status in ('PENDING','VERIFYING','VERIFIED','FAILED','RETIRED')),
  verification_token text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope='PLATFORM' and tenant_id is null and organization_id is null)
      or (scope='TENANT' and tenant_id is not null and organization_id is null)
      or (scope='ORGANIZATION' and organization_id is not null))
);
create unique index if not exists communication_sending_domains_scope_domain
  on platform.communication_sending_domains(scope, coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(domain));

create table if not exists platform.communication_default_assignments (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('PLATFORM','TENANT','ORGANIZATION')),
  tenant_id uuid references platform.tenants(id),
  organization_id uuid references platform.organizations(id),
  channel text not null check (channel in ('EMAIL','SMS','WHATSAPP','VOICE','PUSH')),
  connector_id uuid references platform.connectors(connector_id),
  sending_domain_id uuid references platform.communication_sending_domains(id),
  sender_identity_id uuid references platform.communication_sender_identities(sender_id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope='PLATFORM' and tenant_id is null and organization_id is null)
      or (scope='TENANT' and tenant_id is not null and organization_id is null)
      or (scope='ORGANIZATION' and organization_id is not null))
);
create unique index if not exists communication_default_assignments_active
 on platform.communication_default_assignments(scope, coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), channel)
 where is_active;

alter table platform.communication_templates
  add column if not exists cloned_source_template_id uuid references platform.communication_templates(id),
  add column if not exists cloned_source_version integer,
  add column if not exists platform_update_available boolean not null default false;

alter table platform.communication_sending_domains enable row level security;
alter table platform.communication_sending_domains force row level security;
alter table platform.communication_default_assignments enable row level security;
alter table platform.communication_default_assignments force row level security;

drop policy if exists communication_sending_domains_select on platform.communication_sending_domains;
create policy communication_sending_domains_select on platform.communication_sending_domains for select using (
  scope='PLATFORM' or tenant_id = current_setting('app.tenant_id', true)::uuid
);
drop policy if exists communication_default_assignments_select on platform.communication_default_assignments;
create policy communication_default_assignments_select on platform.communication_default_assignments for select using (
  scope='PLATFORM' or tenant_id = current_setting('app.tenant_id', true)::uuid
);
