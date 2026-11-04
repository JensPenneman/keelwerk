import type { DecisionLogEntry } from './decision-log-entry.ts';
import type { DecisionLogSink } from './decision-log-sink.ts';

/**
 * Hands a decision to the hook per `authorization.decisionLog` (section 8.7): `all` every
 * decision, `denials` the ones that refused, `none` nothing (the default when unset is the
 * caller's).
 */
export function decisionLog(
  mode: 'denials' | 'all' | 'none',
  sink: DecisionLogSink,
  entry: DecisionLogEntry,
): void {
  if (mode === 'none') return;
  if (mode === 'denials' && entry.allowed) return;
  sink(entry);
}
