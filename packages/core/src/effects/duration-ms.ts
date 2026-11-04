import { KeelwerkError } from '../errors/keelwerk-error.ts';

const units = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/**
 * A duration in milliseconds: the short form of timers and timeouts ('45s', '2m', '500ms', '1h',
 * '2d') or an ISO 8601 duration of days and below ('PT24H', 'P30D'). Anything else is a
 * `validation` error naming the text.
 */
export function durationMs(text: string): number {
  const short = /^(\d+)(ms|s|m|h|d)$/.exec(text);
  const unit = short?.[2] as keyof typeof units | undefined;
  if (short !== null && unit !== undefined) return Number(short[1]) * units[unit];
  try {
    const total = Temporal.Duration.from(text).total({ unit: 'millisecond' });
    if (Number.isFinite(total) && total >= 0) return total;
  } catch {
    // falls through to the refusal below
  }
  throw new KeelwerkError({
    kind: 'validation',
    code: 'core.malformed_request',
    message: `"${text}" is not a duration: use '45s', '2m', '1h' or an ISO 8601 duration such as 'PT24H'.`,
  });
}
