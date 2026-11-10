/**
 * `kw_api_usage`: the daily request counts per backend, tenant, API version, transport and item, in
 * the control store's root only (section 18.5, S-144). `day` is the UTC calendar date of the adapter
 * clock at the request. A request with no tenant counts under `tenant_id = backend_id` (the scope
 * M1's `coalesce(tenant_id, backend_id)` gives it), and `item = ''` holds the total of the API version.
 */
export function kwApiUsage(root: string): readonly string[] {
  return [
    `create table "${root}".kw_api_usage (
  day date not null,
  backend_id uuid not null,
  tenant_id uuid not null,
  api_version text not null,
  transport text not null,
  item text not null,
  count bigint not null,
  primary key (day, backend_id, tenant_id, api_version, transport, item)
)`,
  ];
}
