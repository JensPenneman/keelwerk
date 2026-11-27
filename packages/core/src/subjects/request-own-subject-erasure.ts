import type { HybridClock } from '../clock/hybrid-clock.ts';
import { commandJobRun } from '../effects/command-job-run.ts';
import { commandQueue } from '../effects/command-queue.ts';
import { jobInput } from '../effects/job-input.ts';
import { sealJobInput } from '../effects/seal-job-input.ts';
import { validateEffectInput } from '../effects/validate-effect-input.ts';
import { errors } from '../errors/errors.ts';
import { buildEventMeta } from '../events/build-event-meta.ts';
import type { EventMeta } from '../events/event-meta.ts';
import type { StreamRef } from '../events/stream-ref.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { Clock } from '../kernel/clock.ts';
import type { KeyService } from '../kernel/key-service.ts';
import { deriveScopeSecrets } from '../keys/derive-scope-secrets.ts';
import type { Principal } from '../principals/principal.ts';
import type { QuotaView } from '../quotas/quota-view.ts';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import type { Unit } from '../storage/unit.ts';
import { appendReceiptChange } from '../write-path/append-receipt-change.ts';
import { commandDigests } from '../write-path/command-digests.ts';
import { receiptRow } from '../write-path/receipt-row.ts';
import { canonicalSubject } from './canonical-subject.ts';
import { erasureAction } from './erasure-action.ts';
import { erasureRetry } from './erasure-retry.ts';

/** What the request for the erasure of the id of a module's own row is written from. */
export interface OwnSubjectErasureRequest {
  readonly unit: Unit;
  readonly registry: Registry;
  readonly scope: Scope;
  /** The module that asks: its entity holds the row. */
  readonly module: string;
  /** A principal of the scope: the request runs as the module's service principal there. */
  readonly caused: Pick<Principal, 'scope'>;
  readonly row: StreamRef;
  /** The command id the request is written under: a second request under it finds the first one's receipt. */
  readonly commandId: string;
  /** The command and event the request follows from. */
  readonly causation: { readonly commandId: string; readonly eventId?: string };
  /** The meta of the request's change record: its correlation id. */
  readonly meta: Pick<EventMeta, 'correlationId'>;
  readonly build: { readonly id: string; readonly revision: number };
  readonly apiVersion: string;
  readonly quotas: QuotaView | undefined;
  readonly keys: KeyService;
  readonly fingerprintKey?: Uint8Array;
  readonly clock: Clock;
  readonly hybridClock: HybridClock;
}

/**
 * Writes, in the unit given, what `acceptAsyncCommand` writes for `core.eraseSubject`: the
 * `accepted` receipt, the job and the receipt's change record, for the id of a live row of an
 * entity the requesting module owns and whose data subject is a field or path, under the module's
 * service principal. Answers `exists` when a receipt of the command id is there already, and
 * `absent` when no live row has the id; it writes nothing then. A request for an entity the module
 * does not own, or one without a data subject, refuses the unit. Whether the erasure may start is
 * asked by the job (`admitErasure`).
 */
export async function requestOwnSubjectErasure(
  request: OwnSubjectErasureRequest,
): Promise<'requested' | 'exists' | 'absent'> {
  const { unit, registry, scope, row } = request;
  const what = `eraseOwnSubject of "${row.type}"`;
  if (scope.level !== 'tenant') throw refuseRequest(what, 'a subject is erased in a tenant');
  const entry = registry.entities.get(row.type);
  if (
    entry === undefined ||
    entry.module !== request.module ||
    entry.descriptor.tenancy !== 'tenant' ||
    entry.descriptor.dataSubject === null
  ) {
    throw refuseRequest(
      what,
      'it names no tenant entity with a data subject of the requesting module',
    );
  }
  const action = registry.actions.get(erasureAction);
  if (action === undefined) throw errors.internal(`the command "${erasureAction}" is missing`);
  const subjectId = canonicalSubject(row.id);
  const input = validateEffectInput(
    action.input,
    { subjectId, reason: 'retention' },
    `"${erasureAction}"`,
  );
  const found = await unit.rows.findOne(entry.descriptor, {
    where: { op: 'eq', field: 'id', value: subjectId },
    includeArchived: true,
    includeErased: false,
  });
  if (found === undefined) return 'absent';
  const principal = moduleServicePrincipal(request.module, request.caused);
  const { commandId } = request;
  const now = request.clock.now();
  const fingerprintKey =
    request.fingerprintKey ?? (await deriveScopeSecrets(request.keys, scope)).fingerprintKey;
  const digests = commandDigests({
    registry,
    action,
    fingerprintKey,
    apiVersion: request.apiVersion,
    input,
  });
  const receipt = {
    ...receiptRow({
      commandId,
      action: erasureAction,
      fingerprint: digests.fingerprint,
      principal,
      apiVersion: request.apiVersion,
      request: { transport: 'runtime', requestId: commandId },
      now,
    }),
    status: 'accepted' as const,
  };
  if ((await unit.receipts.claim(receipt)) === 'exists') return 'exists';
  await unit.jobs.enqueue({
    ...jobInput({
      scope,
      principal,
      caller: request.module,
      action,
      causation: request.causation,
      build: request.build,
      apiVersion: request.apiVersion,
      now,
      queue: commandQueue,
      limits: request.quotas,
    }),
    kind: 'action',
    retry: erasureRetry,
    // The entity names what the job's admission checks; only a kernel command id may carry it.
    run: commandJobRun(
      erasureAction,
      {
        ...((await sealJobInput(unit, registry, commandId, action, input)) as object),
        entity: entry.ref,
      },
      commandId,
    ),
  });
  await appendReceiptChange(unit, {
    registry,
    scope,
    receipt,
    meta: buildEventMeta({
      principal,
      commandId,
      action: erasureAction,
      correlationId: request.meta.correlationId,
      build: request.build,
      flags: [],
      decision: null,
    }),
    hybridClock: request.hybridClock,
    now,
  });
  return 'requested';
}
