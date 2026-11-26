import { effectiveRules } from '../authorization/effective-rules.ts';
import { evaluateGate } from '../authorization/evaluate-gate.ts';
import { errors } from '../errors/errors.ts';
import { isKeelwerkError } from '../errors/is-keelwerk-error.ts';
import { buildSnapshot } from '../flags/build-snapshot.ts';
import type { FlagProvider } from '../flags/flag-provider.ts';
import type { FlagSnapshot } from '../flags/flag-snapshot.ts';
import { principalContextOf } from '../interpreter/principal-context-of.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { Logger } from '../observability/logger.ts';
import type { Principal } from '../principals/principal.ts';
import type { Registry } from '../registry/registry.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { Scope } from '../storage/scope.ts';
import { canonicalSubject } from './canonical-subject.ts';
import { checkOwnSubjectErasure } from './check-own-subject-erasure.ts';
import { erasureAction } from './erasure-action.ts';

/**
 * The admission of an erasure (section 14.7.5), taken when its job starts, directly before the
 * record in the ledger, the point of no return. An erasure that something holds back ends with a
 * retryable `unavailable` error, so the job tries again (`erasureRetry`) for as long as it is held
 * back, and the erasure starts once nothing holds it. For the request of a module for the id of
 * its own row (`eraseOwnSubject`, which names an entity) the ownership is read first: a row of any
 * module that holds the subject besides the row itself holds it back (`checkOwnSubjectErasure`).
 * For every erasure the hold is read last: a rule that targets `core.eraseSubject` and denies it
 * for the requester (a rule over a selector is not asked again: it was applied at acceptance), a
 * hold the operator lifts; its flags are read through the process's providers, and the requester is
 * the actor of the job as `principalOfActor` makes a principal of it. A hold nobody could see holds
 * as well: a flag that a rule read and that answered `STALE` or `ERROR`, or a rule, a provider or
 * the gate that failed; these are logged as a warning with the command id and the kind of reason,
 * never the subject. A hold in force at that read holds the erasure and one that comes after it
 * does not. A request that names an entity the registry does not know is refused for good. The
 * messages name neither the rule nor the subject.
 */
export async function admitErasure(
  source: {
    readonly registry: Registry;
    readonly namespace: NamespaceRef;
    readonly adapter: DataAdapter;
    /** The process's flag providers: the hold's `when` reads its flags through them. */
    readonly providers: readonly FlagProvider[];
    /** The process's targeting cache, awaited first so the hold reads rows no older than an invocation's. */
    readonly targeting?: { fresh(): Promise<void> } | undefined;
    readonly log: Logger;
  },
  scope: Extract<Scope, { readonly level: 'tenant' }>,
  request: {
    readonly commandId: string;
    /** The entity of an own-subject request; absent for an operator's. */
    readonly entity?: string;
    readonly requester: Principal;
    readonly subjectId: string;
    readonly reason: string;
  },
): Promise<void> {
  const { registry } = source;
  const entry = request.entity === undefined ? undefined : registry.entities.get(request.entity);
  if (request.entity !== undefined && entry === undefined) {
    throw refuseRequest('an own-subject erasure', 'it names no entity');
  }
  const action = registry.actions.get(erasureAction);
  if (action === undefined) throw errors.internal(`the command "${erasureAction}" is missing`);
  const putOff = (kind: string) => {
    source.log.warn('an erasure is put off', { commandId: request.commandId, kind });
    return errors.unavailable(
      'Something that holds erasures cannot be read; the erasure starts once it can.',
    );
  };
  if (entry !== undefined) {
    try {
      await source.adapter.unit(
        source.namespace,
        scope,
        (unit) =>
          checkOwnSubjectErasure(unit, registry, {
            type: entry.ref,
            id: canonicalSubject(request.subjectId),
          }),
        { readOnly: true },
      );
    } catch (cause) {
      if (!isKeelwerkError(cause) || cause.code !== 'core.request_not_allowed') {
        throw putOff('ownership');
      }
      throw errors.unavailable(
        'Another row holds this subject; the erasure starts once none does.',
        { cause },
      );
    }
  }
  const principal = request.requester;
  // A rule over a selector (a read-only key, say) judges the caller and was applied when the
  // request was accepted; only a rule that targets the erasure itself holds it.
  const rules = effectiveRules(registry).filter((rule) => rule.target.kind !== 'selector');
  // The flags a hold reads come from the process's providers, as for any other call of the action:
  // with the declared defaults a hold on a flag would not hold, and the shred cannot be undone.
  let flags: FlagSnapshot;
  try {
    flags = await buildSnapshot({
      registry,
      action,
      scope,
      principal,
      clientId: null,
      providers: source.providers,
      rules,
      targeting: source.targeting,
      log: source.log,
    });
  } catch {
    throw putOff('flag');
  }
  let verdict: ReturnType<typeof evaluateGate>;
  try {
    verdict = evaluateGate({
      rules,
      action,
      context: principalContextOf(registry, principal, scope, flags),
      transport: 'runtime',
      input: { subjectId: request.subjectId, reason: request.reason },
    });
  } catch {
    throw putOff('rule');
  }
  if (verdict.rules.some((match) => match.effect === 'deny')) {
    throw errors.unavailable('A rule holds this erasure; it starts once the rule lets go.');
  }
  // A flag a rule read that answered its default because its rows were stale or its provider failed
  // cannot show whether a hold is on, and the shred cannot be undone: the erasure waits until it can.
  if (flags.evaluations.some(({ reason }) => reason === 'STALE' || reason === 'ERROR')) {
    throw putOff('flag');
  }
}
