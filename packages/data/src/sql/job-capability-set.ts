/** The text of a lane's capability set: the sorted, distinct capabilities joined by a comma; empty for none (21.2). */
export function jobCapabilitySet(capability: readonly string[] | undefined): string {
  return [...new Set(capability ?? [])].sort().join(',');
}
