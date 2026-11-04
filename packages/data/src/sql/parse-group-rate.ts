import { malformedQuery } from './malformed-query.ts';

const units: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** A group's rate, `'60/1m'`: that many jobs per period (units ms, s, m, h, d). */
export function parseGroupRate(rate: string): {
  readonly count: number;
  readonly periodMs: number;
} {
  const match = /^(\d+)\/(\d+)(ms|s|m|h|d)$/.exec(rate);
  const unit = match?.[3];
  const factor = unit === undefined ? undefined : units[unit];
  if (match === null || factor === undefined) {
    throw malformedQuery(`the group rate ${rate} is not '<count>/<number><ms|s|m|h|d>'`);
  }
  const count = Number(match[1]);
  const periodMs = Number(match[2]) * factor;
  if (count < 1 || periodMs < 1) throw malformedQuery(`the group rate ${rate} must be positive`);
  return { count, periodMs };
}
