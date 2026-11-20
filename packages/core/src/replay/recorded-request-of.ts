import { errors } from '../errors/errors.ts';
import type { DecisionRecord } from '../events/decision-record.ts';
import type { DecisionRequest } from '../events/decision-request.ts';
import { decisionRequestBinding } from '../events/decision-request-binding.ts';
import { principalRequestOf } from '../events/principal-request-of.ts';
import type { RequestInfo } from '../invoker/request-info.ts';
import { isPrincipalValueKeyId } from '../keys/is-principal-value-key-id.ts';
import { openKwe } from '../keys/open-kwe.ts';
import type { Unit } from '../storage/unit.ts';
import { openRecordedSealed } from './open-recorded-sealed.ts';
import type { RedecideInput } from './redecide-input.ts';
import { replayKeyDestroyed } from './replay-key-destroyed.ts';

const what = 'the recorded request';
const requestMembers = ['transport', 'userAgent', 'connection'] as const;
type RequestMember = (typeof requestMembers)[number];

/** The request a re-decide hands the decision, and what the record kept of it. */
export interface RecordedRequest {
  readonly request: RequestInfo;
  readonly kept: readonly RequestMember[];
  /** Whether the record has a `request` member at all. */
  readonly recorded: boolean;
}

/**
 * The request of a re-decide. With `record.request`, the transport and user agent the decision
 * read, and whether it read the connection (an envelope under the principal subject's data key, a value under the long-lived key of
 * the principal id, or a value sealed under a key of its own; each is opened against this command) and the connection of `given`; a key
 * that is gone is `replayKeyDestroyed('the recorded request')`, so the request is not handed over
 * again. Without it, the request of M1: transport `replay` and what `given` holds. The request id
 * is always `requestId`. A member the decision did not read is not part of what it gets.
 * `kept` names the members the record kept (`transport`, `userAgent`, `connection`); a record without a request
 * keeps none (`recorded` false), so a re-decide can tell a member it reads now from one the decision read then.
 */
export async function recordedRequestOf(
  unit: Unit,
  record: DecisionRecord,
  commandId: string,
  requestId: string,
  given: RedecideInput['request'],
): Promise<RecordedRequest> {
  const { request } = record;
  if (request === undefined)
    return { request: { transport: 'replay', requestId, ...given }, kept: [], recorded: false };
  let kept: DecisionRequest;
  if ('$kwe' in request) {
    const key = await unit.keys.keyById(request.k);
    if (key === undefined) throw replayKeyDestroyed(what);
    const plain = openKwe(
      request,
      key.material,
      decisionRequestBinding(unit.namespace.id, commandId),
    );
    if (plain === undefined) {
      throw errors.internal(`${what} does not belong to command ${commandId}.`);
    }
    kept = JSON.parse(new TextDecoder().decode(plain)) as DecisionRequest;
  } else if (isPrincipalValueKeyId(request.keyId)) {
    const plain = await unit.keys.openValue(request);
    if (plain === undefined) throw replayKeyDestroyed(what);
    const own = principalRequestOf(plain, commandId);
    if (own === undefined)
      throw errors.internal(`${what} does not belong to command ${commandId}.`);
    kept = own;
  } else {
    const opened = await openRecordedSealed(unit, request, { commandId, field: 'request' }, what);
    kept = JSON.parse(new TextDecoder().decode(opened)) as DecisionRequest;
  }
  return {
    request: {
      transport: kept.transport ?? 'replay',
      requestId,
      ...(kept.userAgent === undefined || kept.userAgent === null
        ? {}
        : { userAgent: kept.userAgent }),
      ...(given?.connection === undefined ? {} : { connection: given.connection }),
    },
    kept: requestMembers.filter((member) => kept[member] !== undefined),
    recorded: true,
  };
}
