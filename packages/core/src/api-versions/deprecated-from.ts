import { declaredInstantOf } from './declared-instant-of.ts';
import { utcDayOf } from './utc-day-of.ts';

/**
 * Whether a deprecation declared `at` is in force on `today` (`YYYY-MM-DD`, UTC): from the UTC day
 * of `at` on, so the whole of that day is covered. Without `at` it is in force from its
 * declaration. A text that names no instant (`declaredInstantOf`) is refused when the action is
 * defined and never reaches here; it counts as not begun.
 */
export function deprecatedFrom(at: string | undefined, today: string): boolean {
  if (at === undefined) return true;
  const instant = declaredInstantOf(at);
  return instant !== undefined && utcDayOf(instant) <= today;
}
