/**
 * The scope id of the group row a job counts on, as an SQL expression over the alias of its
 * `kw_jobs` row: null for a group that spans the namespace, the job's own scope otherwise (the
 * statements' counterpart of `groupKeyOfJob`).
 */
export const jobGroupScopeSql = (alias: string): string =>
  `(case when ${alias}.group_spec ->> 'scope' = 'namespace' then null else ${alias}.scope_id end)`;
