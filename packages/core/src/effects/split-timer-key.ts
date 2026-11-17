import { deadlineTimerKey } from './deadline-timer-key.ts';
import type { TimerKeyParts } from './timer-key-parts.ts';

/**
 * The module and the key of a stored timer key (`timerKey`), split at the first colon: a module id
 * holds none (5.1). It applies only to rows of the timers queue: a commands row whose key holds a
 * colon is not a timer. `job` is the kind and the principal id of the job row that holds the key. A
 * timer of an action is run as `<module>.system` of the module that set it, so the split is
 * answered only when the principal id is the module half plus `.system`; a kernel deadline (kind
 * `effect`) is answered only when the text is `deadlineTimerKey` of the effect id, as module
 * `core.deadline`. Undefined for a text with no colon or with nothing before it, and for a row of
 * another origin: a timer row written by 0.1.0 holds any key its module chose, colons included,
 * with no module half, so `invoice:42` of the module `billing` is not shown as a timer of
 * `invoice`.
 */
export function splitTimerKey(
  stored: string,
  job: { readonly kind: 'action' | 'effect'; readonly principalId: string },
): TimerKeyParts | undefined {
  const at = stored.indexOf(':');
  if (at <= 0) return undefined;
  const module = stored.slice(0, at);
  const key = stored.slice(at + 1);
  const owned =
    job.kind === 'effect'
      ? stored === deadlineTimerKey(key)
      : job.principalId === `${module}.system`;
  return owned ? { module, key } : undefined;
}
