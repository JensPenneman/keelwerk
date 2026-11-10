const setting = (name: string): string =>
  `nullif(current_setting('keelwerk.${name}', true), '')::uuid`;

/**
 * The predicates and statements of forced row-level security, shared by framework steps 0001 and
 * 0002. Each setting is wrapped in `nullif` because a pooled connection keeps a finished unit's
 * setting as `''` (decision 111).
 */
export const rlsParts: {
  /** `scope_id` against the unit's scope: the deployment id in the control root; tenant, else backend, else deployment in an application root. */
  unitScope(control: boolean): string;
  /** `current_setting('keelwerk.scope', true) = 'namespace'`: the `take` and `maintenance` sets. */
  readonly inNamespaceScope: string;
  /** A unit that sets `keelwerk.deployment_id`: the `deployment` set. */
  readonly inDeploymentScope: string;
  /** `enable` then `force row level security`. */
  enable(root: string, table: string): readonly string[];
  /** `create policy <name> on "<root>".<table> using (<p>) with check (<p>)`. */
  policy(root: string, table: string, name: string, predicate: string): string;
} = {
  /**
   * The scope a unit runs in (section 14.3.7, decision 111). An application root admits one scope:
   * the tenant when the unit sets one, otherwise the backend, otherwise the deployment (whose event
   * log and counters live in the application root too), so a unit never spans two scopes. The
   * control root belongs to the deployment and admits its id only.
   */
  unitScope: (control) =>
    control
      ? `scope_id = ${setting('deployment_id')}`
      : `scope_id = coalesce(${setting('tenant_id')}, ${setting('backend_id')}, ${setting('deployment_id')})`,
  inNamespaceScope: `current_setting('keelwerk.scope', true) = 'namespace'`,
  inDeploymentScope: `nullif(current_setting('keelwerk.deployment_id', true), '') is not null`,
  enable: (root, table) => [
    `alter table "${root}".${table} enable row level security`,
    `alter table "${root}".${table} force row level security`,
  ],
  policy: (root, table, name, predicate) =>
    `create policy ${name} on "${root}".${table} using (${predicate}) with check (${predicate})`,
};
