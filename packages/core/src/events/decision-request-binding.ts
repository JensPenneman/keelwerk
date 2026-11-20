import type { KweBinding } from '../keys/kwe-aad.ts';

/**
 * The binding of a decision's request record when it is sealed under the principal subject's data
 * key: the namespace, the command as stream and event, and a field name that no entity field
 * (which carry no dot) and no job input envelope (`input.<name>`) can take.
 */
export function decisionRequestBinding(namespace: string, commandId: string): KweBinding {
  return { namespace, streamId: commandId, eventId: commandId, field: 'decision.request' };
}
