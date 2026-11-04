/** The group row a job counts on: its declared id, and its scope unless the group spans the namespace. */
export function groupKeyOfJob(
  groupId: string | null,
  groupScope: unknown,
  scopeId: string,
): { readonly id: string; readonly scopeId: string | null } | undefined {
  if (groupId === null) return undefined;
  return { id: groupId, scopeId: groupScope === 'namespace' ? null : scopeId };
}
