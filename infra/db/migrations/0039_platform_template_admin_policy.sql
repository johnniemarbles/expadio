-- Governed platform template writes require an explicit platform-admin database context.
drop policy if exists communication_templates_platform_admin_write on platform.communication_templates;
create policy communication_templates_platform_admin_write
  on platform.communication_templates
  for all
  using (
    scope = 'PLATFORM'
    and current_setting('app.platform_admin', true) = 'true'
  )
  with check (
    scope = 'PLATFORM'
    and tenant_id is null
    and organization_id is null
    and current_setting('app.platform_admin', true) = 'true'
  );
