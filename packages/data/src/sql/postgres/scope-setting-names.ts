/** The row-level security settings a unit's scope is made of (section 14.3.7), in the order they are written. */
export const scopeSettingNames: readonly [
  'keelwerk.tenant_id',
  'keelwerk.backend_id',
  'keelwerk.scope',
  'keelwerk.deployment_id',
] = ['keelwerk.tenant_id', 'keelwerk.backend_id', 'keelwerk.scope', 'keelwerk.deployment_id'];
