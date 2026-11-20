import { effectiveRules } from '../authorization/effective-rules.ts';
import { evaluateGate } from '../authorization/evaluate-gate.ts';
import { errors } from '../errors/errors.ts';
import { isKeelwerkError } from '../errors/is-keelwerk-error.ts';
import { buildSnapshot } from '../flags/build-snapshot.ts';
import type { FlagProvider } from '../flags/flag-provider.ts';
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
 * request the rules or the rows hold back ends with a retryable `unavailable` error, so the job
 * tries again (`ownErasureRetry`) and the erasure starts once nothing holds it. Two things hold a
 * request back: a rule that denies `core.eraseSubject` for the module's service principal (a hold
 * the operator lifts; its flags are read through the process's providers), and a row of any module
 * that holds the subject besides the row itself (`checkOwnSubjectErasure`). A request that names
 * no tenant entity of a module with a data subject is refused for good. The messages name neither
 * the rule nor the subject.
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
  request: { readonly entity: string; readonly subjectId: string; readonly reason: string },
): Promise<void> {
  const { registry } = source;
  const entry = registry.entities.get(request.entity);
  if (
    entry === undefined ||
    entry.descriptor.tenancy !== 'tenant' ||
    entry.descriptor.dataSubject === null
  ) {
    throw refuseRequest(
      'an own-subject erasure',
      'it names no tenant entity with a data subject of the requesting module',
    );
  }
  const action = registry.actions.get(erasureAction);
  if (action === undefined) throw errors.internal(`the command "${erasureAction}" is missing`);
  const principal = moduleServicePrincipal(entry.module, {
    scope: { backend: scope.backendId, tenant: scope.tenantId },
  });
  // The flags a hold reads come from the process's providers, as for any other call of the action:
  // with the declared defaults a hold on a flag would not hold, and the shred cannot be undone.
  const flags = await buildSnapshot({
    registry,
    action,
    scope,
    principal,
    clientId: null,
    providers: source.providers,
    targeting: source.targeting,
    log: source.log,
  });
  const verdict = evaluateGate({
    rules: effectiveRules(registry),
    action,
    context: principalContextOf(registry, principal, scope, flags),
    transport: 'runtime',
    input: { subjectId: request.subjectId, reason: request.reason },
  });
  if (verdict.rules.some((match) => match.effect === 'deny')) {
    throw errors.unavailable('A rule holds this erasure; it starts once the rule lets go.');
  }
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
    if (!isKeelwerkError(cause) || cause.code !== 'core.request_not_allowed') throw cause;
    throw errors.unavailable('Another row holds this subject; the erasure starts once none does.', {
      cause,
    });
  }
}
