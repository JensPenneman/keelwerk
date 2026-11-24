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
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import type { Registry } from '../registry/registry.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { Scope } from '../storage/scope.ts';
import { canonicalSubject } from './canonical-subject.ts';
import { checkOwnSubjectErasure } from './check-own-subject-erasure.ts';
import { erasureAction } from './erasure-action.ts';

/**
 * The admission of an `eraseOwnSubject` request (section 14.7.5), taken when its job starts, not
 * when the row ends: ending a row must never depend on whether its erasure may start yet. A
 * request that something holds back ends with a retryable `unavailable` error, so the job tries
 * again (`ownErasureRetry`) for as long as it is held back, and the erasure starts once nothing
 * holds it. A row of any module that holds the subject besides the row itself holds it back
 * (`checkOwnSubjectErasure`). So does a rule that denies `core.eraseSubject` for the module's
 * service principal (a hold the operator lifts; its flags are read through the process's
 * providers), and a hold nobody could see: a flag that a rule read and that answered `STALE` or
 * `ERROR`, or a rule, a provider or the gate that failed. These last are logged as a warning with
 * the command id and the kind of reason, never the subject. The point of no return is the record
 * in the ledger that follows: the ownership is read first and the hold last, directly before the
 * record, so a hold in force at that read holds the erasure and one that comes after it does not.
 * A request that names no entity is refused for good. The messages name neither the rule nor the
 * subject.
 */
export async function admitOwnSubjectErasure(
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
    readonly entity: string;
    readonly subjectId: string;
    readonly reason: string;
  },
): Promise<void> {
  const { registry } = source;
  const entry = registry.entities.get(request.entity);
  if (entry === undefined) {
    throw refuseRequest('an own-subject erasure', 'it names no entity');
  }
  const action = registry.actions.get(erasureAction);
  if (action === undefined) throw errors.internal(`the command "${erasureAction}" is missing`);
  const putOff = (kind: string) => {
    source.log.warn('an own-subject erasure is put off', { commandId: request.commandId, kind });
    return errors.unavailable(
      'Something that holds erasures cannot be read; the erasure starts once it can.',
    );
  };
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
    throw errors.unavailable('Another row holds this subject; the erasure starts once none does.', {
      cause,
    });
  }
  const principal = moduleServicePrincipal(entry.module, {
    scope: { backend: scope.backendId, tenant: scope.tenantId },
  });
  const rules = effectiveRules(registry);
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
