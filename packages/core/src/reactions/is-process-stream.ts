import type { Registry } from '../registry/registry.ts';

/**
 * Whether a stream type is the state stream of a process (S-124): the type is the process id, so
 * the registry's reaction of that id says so, by type and never by name. The events of such a
 * stream are the process's own record, not business events: no reaction receives them (7.7), and
 * every other consumer of the log (projections, audit, live) leaves them out with this test.
 */
export function isProcessStream(
  registry: Pick<Registry, 'reactions'>,
  streamType: string,
): boolean {
  return registry.reactions.get(streamType)?.process === true;
}
