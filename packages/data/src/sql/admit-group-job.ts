import type { SqlGroupState } from './sql-group-state.ts';

/** Whether a job of the group may start, and the group's counters afterwards. */
export interface GroupAdmission {
  readonly admitted: boolean;
  readonly group: SqlGroupState;
}

/**
 * The group check of the take (9.5.3, 14.3.9), made under the group's row lock after the jobs are
 * picked: a group blocked until a later time, at its concurrency, or out of tokens holds the job
 * back (an empty bucket blocks the group until the next token); otherwise the job takes a running
 * slot and a token. The bucket refills by the time since it was last touched.
 */
export function admitGroupJob(group: SqlGroupState, now: Temporal.Instant): GroupAdmission {
  if (group.blockedUntil !== null && Temporal.Instant.compare(group.blockedUntil, now) > 0) {
    return { admitted: false, group };
  }
  if (group.concurrency !== null && group.running >= group.concurrency) {
    return { admitted: false, group };
  }
  if (group.rate === null) {
    return { admitted: true, group: { ...group, running: group.running + 1 } };
  }
  const { count, periodMs } = group.rate;
  const elapsed = now.epochMilliseconds - (group.refilledAt ?? now).epochMilliseconds;
  const tokens = Math.min(count, group.tokens + (elapsed * count) / periodMs);
  if (tokens < 1) {
    const wait = Math.ceil(((1 - tokens) * periodMs) / count);
    return {
      admitted: false,
      group: { ...group, tokens, refilledAt: now, blockedUntil: now.add({ milliseconds: wait }) },
    };
  }
  return {
    admitted: true,
    group: {
      ...group,
      running: group.running + 1,
      tokens: tokens - 1,
      refilledAt: now,
      blockedUntil: null,
    },
  };
}
