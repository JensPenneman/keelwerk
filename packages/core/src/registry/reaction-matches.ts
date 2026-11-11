import type { ReactionEntry } from './reaction-entry.ts';

/** Whether `reaction` receives an event of `type`: listed, or `on: 'all'` and not excepted. */
export function reactionMatches(
  reaction: Pick<ReactionEntry, 'on' | 'except'>,
  type: string,
): boolean {
  if (reaction.on === 'all') return !(reaction.except ?? []).includes(type);
  return reaction.on.includes(type);
}
