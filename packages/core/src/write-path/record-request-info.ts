import { errors } from '../errors/errors.ts';
import type { DecisionRequest } from '../events/decision-request.ts';
import { decisionRequestBinding } from '../events/decision-request-binding.ts';
import { principalRequestPlain } from '../events/principal-request-record.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import { defaultRandomSource } from '../keys/default-random-source.ts';
import type { KweEnvelope } from '../keys/kwe-envelope.ts';
import { principalValueKeyId } from '../keys/principal-value-key-id.ts';
import { sealKwe } from '../keys/seal-kwe.ts';
import type { Principal } from '../principals/principal.ts';
import type { SealedValue } from '../storage/sealed-value.ts';
import type { Unit } from '../storage/unit.ts';

/**
 * The request information a decision read (S-126), sealed for its record; the address is never part
 * of it. Under a user principal in a tenant it is canonical JSON of the members it read as a `$kwe`
 * envelope under the principal subject's data key, bound to the command, so erasing the subject
 * makes it unreadable with no lookup; a subject that is already erased refuses the decision, as any
 * personal value does. Under any other principal that has a principal id (`ref.principalId`, the id
 * its receipts carry; a user outside a tenant too) it is sealed under that id's long-lived value
 * key (`principalValueKeyId`), which the erasure of a subject destroys when it matches the id and
 * the key is in the subject's tenant (a record written in another scope stays under that scope's
 * live key), and the command travels inside the sealed text. Under a principal with no id it is a value sealed
 * under a key of its own, bound to the command: erasure destroys that key for the commands that
 * wrote in a row the subject owns (a sign-up, a login).
 */
export async function recordRequestInfo(
  unit: Unit,
  commandId: string,
  principal: Principal,
  read: DecisionRequest,
): Promise<SealedValue | KweEnvelope> {
  if (principal.kind === 'user' && unit.scope.level === 'tenant') {
    const plain = new TextEncoder().encode(canonicalizeJson(read));
    const key = await unit.keys.dataKey(principal.subject, { create: true });
    if (key === undefined) {
      throw errors.forbidden(
        'The data subject was erased: the request a decision read cannot be recorded.',
      );
    }
    return sealKwe(
      key,
      plain,
      decisionRequestBinding(unit.namespace.id, commandId),
      defaultRandomSource,
    );
  }
  const principalId = principal.ref?.principalId;
  if (principalId !== undefined) {
    return unit.keys.sealValue(
      { entity: 'core.principal', id: principalId, field: 'request' },
      principalRequestPlain(commandId, read),
      { keyId: principalValueKeyId(principalId) },
    );
  }
  return unit.keys.sealValue(
    { entity: 'core.decision', id: commandId, field: 'request' },
    new TextEncoder().encode(canonicalizeJson(read)),
  );
}
