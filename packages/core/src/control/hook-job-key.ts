import { enqueueKey } from '../effects/enqueue-key.ts';

/**
 * The stored key of the job of one `onTenantCreated` hook, in the kernel's own key naming
 * (`core.hook:<hook id>`, as `core.continuation` names the continuations of effects). The enqueue
 * of the job and the cancel of a rerun both build it here, so the two can never disagree.
 */
export function hookJobKey(hookId: string): string {
  return enqueueKey('core.hook', hookId);
}
