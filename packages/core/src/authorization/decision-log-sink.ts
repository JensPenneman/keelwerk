import type { DecisionLogEntry } from './decision-log-entry.ts';

/** The hook `authorization.decisionLog` feeds; the audit module writes it to the chain. */
export type DecisionLogSink = (entry: DecisionLogEntry) => void;
