/** `kw_namespace_identities`: the system id and timeline of each namespace, in the control store's root only (section 14.7.6, S-119). */
export function kwNamespaceIdentities(root: string): readonly string[] {
  return [
    `create table "${root}".kw_namespace_identities (
  namespace_id text primary key,
  system_id text not null,
  timeline text not null,
  recorded_at timestamptz(3) not null
)`,
  ];
}
