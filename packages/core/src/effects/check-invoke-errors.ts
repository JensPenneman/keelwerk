import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { InvokeEffect } from '../protocol/invoke-effect.ts';
import type { ActionEntry } from '../registry/action-entry.ts';

/**
 * The checks of the error map of an `invoke` (7.4, open point 463), made when the effect runs
 * because the map is a runtime value: `refuseRequest` (`internal`, `core.request_not_allowed`) for
 * a map on a deferred invoke (the caller's decision is over before the command runs, so there is
 * nothing to fail), a key the invoked command does not declare, a value the calling action does not
 * declare, and a value other than the key itself whose declaration carries a `data` schema (the
 * invoked error has no details to fill it from; an error named as itself passes its own). An async reaction declares no errors, so it can map nothing; an inline one declares its command's.
 */
export function checkInvokeErrors(
  effect: InvokeEffect,
  invoked: ActionEntry,
  caller: ActionEntry,
  deferred: boolean,
): void {
  if (effect.errors === undefined) return;
  const subject = `invoke of "${invoked.ref}"`;
  if (deferred) {
    throw refuseRequest(subject, 'an error map needs the command to run in this decision');
  }
  for (const [code, mapped] of Object.entries(effect.errors)) {
    if (!invoked.errors.includes(code)) {
      throw refuseRequest(subject, `the command does not declare the error "${code}"`);
    }
    if (!caller.errors.includes(mapped)) {
      throw refuseRequest(subject, `"${caller.ref}" does not declare the error "${mapped}"`);
    }
    // A caller passes a declared error of the command it invokes through by naming it as itself
    // (`'accounts.email_taken': 'accounts.email_taken'`): both declare that one definition, so its
    // details are the invoked error's own and are passed on whole (`mapInvokeError`).
    if (code !== mapped && caller.errorSpecs?.[mapped]?.data !== undefined) {
      throw refuseRequest(
        subject,
        `the error "${mapped}" carries details, which an invoked error cannot fill`,
      );
    }
  }
}
