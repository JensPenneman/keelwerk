/** `kw_ledger`: the append-only ledger of the deployment, in the control store's root only (section 14.7.5, S-125). */
export function kwLedger(root: string): readonly string[] {
  return [
    `create table "${root}".kw_ledger (
  seq bigint generated always as identity primary key,
  type text not null,
  record jsonb not null,
  recorded_at timestamptz(3) not null
)`,
  ];
}
