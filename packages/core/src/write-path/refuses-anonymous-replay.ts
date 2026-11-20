import { isKernelCommandId } from '../ids/is-kernel-command-id.ts';
import type { JobCarrier } from '../invoker/job-carrier.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Receipt } from '../storage/receipt.ts';
import { declaresCredentialMember } from './declares-credential-member.ts';

/**
 * Whether a finished receipt may not be replayed (section 7.5): it has no principal reference, the
 * action declares a credential member, and the repeat is not one of the kernel's own. A repeat is
 * the kernel's own under a command id of the kernel's form (no caller can present it), and for a
 * worker's run (`job`) that meets a receipt a worker's run wrote, which is the one whose request
 * names the transport `job`. A job that meets a receipt a caller wrote directly is refused like that
 * caller. Throws `internal` as `declaresCredentialMember` does. The one test of every replay path:
 * `replayReceipt` calls it, and every other path that answers from a finished receipt must call it
 * too, so the conditions cannot drift apart.
 */
export function refusesAnonymousReplay(
  action: ActionEntry,
  registry: Pick<Registry, 'entities'>,
  receipt: Pick<Receipt, 'principal' | 'commandId' | 'request'>,
  job?: JobCarrier,
): boolean {
  return (
    receipt.principal === null &&
    !(job !== undefined && receipt.request.transport === 'job') &&
    !isKernelCommandId(receipt.commandId) &&
    declaresCredentialMember(action, registry)
  );
}
