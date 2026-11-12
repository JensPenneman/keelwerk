import type { DeprecationNotice } from '@keelwerk/core';

/** `warning: API version 2026-11-04 is deprecated since 2026-11-10 and retired after 2026-12-01.` (or `action <ref>`; without sunset the last clause is dropped, without a date `is deprecated`). */
export function deprecationWarning(notice: DeprecationNotice): string {
  const subject =
    notice.apiVersion !== undefined
      ? `API version ${notice.apiVersion}`
      : `action ${notice.action ?? ''}`;
  const retired = notice.sunset === undefined ? '' : ` and retired after ${notice.sunset}`;
  const since = notice.at === undefined ? '' : ` since ${notice.at}`;
  return `warning: ${subject} is deprecated${since}${retired}.`;
}
