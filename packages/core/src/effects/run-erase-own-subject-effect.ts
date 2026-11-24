import { errors } from '../errors/errors.ts';
import { buildEventMeta } from '../events/build-event-meta.ts';
import { kernelCommandId } from '../ids/kernel-command-id.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import { deriveScopeSecrets } from '../keys/derive-scope-secrets.ts';
import type { EraseOwnSubjectEffect } from '../protocol/erase-own-subject-effect.ts';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import { canonicalSubject } from '../subjects/canonical-subject.ts';
import { erasureAction } from '../subjects/erasure-action.ts';
import { ownErasureRetry } from '../subjects/own-erasure-retry.ts';
import { appendReceiptChange } from '../write-path/append-receipt-change.ts';
import { commandDigests } from '../write-path/command-digests.ts';
import { receiptRow } from '../write-path/receipt-row.ts';
import { commandJobRun } from './command-job-run.ts';
import { commandQueue } from './command-queue.ts';
import type { EffectScene } from './effect-scene.ts';
import { jobInput } from './job-input.ts';
import { sealJobInput } from './seal-job-input.ts';
import { validateEffectInput } from './validate-effect-input.ts';

/**
 * `eraseOwnSubject(row)` (section 14.7.5): the request for the erasure of the id of a row of the
 * requesting module's own entity, written in the unit that ends the row. It writes what
 * `acceptAsyncCommand` writes for `core.eraseSubject`: the `accepted` receipt, the job and the
 * receipt's change record, under the module's service principal (`<module>.system`), so the
 * unchanged worker of section 14.7.5 does every step and writes every ledger record. Only a tenant
 * unit, an entity the module owns whose data subject is a field or path, and a live row are
 * accepted here, and a request that fails these refuses the unit. Whether the erasure may start
 * is not asked here: ending a row never depends on it. The job asks when it starts
 * (`admitOwnSubjectErasure`): a rule that denies `core.eraseSubject` for that principal, or another
 * row that holds the subject, makes it wait and try again (`ownErasureRetry`); no allow rule is
 * needed, because the module's own row is the ownership. The receipt carries no address or user
 * agent, and its expiry does not end the request: an accepted receipt stays, and the job is tried
 * for as long as it is held back. A unit that repeats rolls its receipt and job back with it.
 */
export async function runEraseOwnSubjectEffect(
  scene: EffectScene,
  effect: EraseOwnSubjectEffect,
  id: string,
): Promise<void> {
  const { run, unit } = scene;
  if (run.scope.level !== 'tenant') {
    throw refuseRequest(
      `eraseOwnSubject of "${effect.row.type}"`,
      'a subject is erased in a tenant',
    );
  }
  const entry = run.registry.entities.get(effect.row.type);
  if (
    entry === undefined ||
    entry.module !== scene.module ||
    entry.descriptor.tenancy !== 'tenant' ||
    entry.descriptor.dataSubject === null
  ) {
    throw refuseRequest(
      `eraseOwnSubject of "${effect.row.type}"`,
      'it names no tenant entity with a data subject of the requesting module',
    );
  }
  const action = run.registry.actions.get(erasureAction);
  if (action === undefined) throw errors.internal(`the command "${erasureAction}" is missing`);
  const subjectId = canonicalSubject(effect.row.id);
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
  if (found === undefined) {
    throw refuseRequest(`eraseOwnSubject of "${effect.row.type}"`, 'it names no live row');
  }
  const principal = moduleServicePrincipal(scene.module, run.principal);
  const commandId = kernelCommandId('effect', id);
  const now = scene.clock.now();
  const fingerprintKey =
    run.fingerprintKey ?? (await deriveScopeSecrets(run.keys, run.scope)).fingerprintKey;
  const digests = commandDigests({
    registry: run.registry,
    action,
    fingerprintKey,
    apiVersion: run.apiVersion,
    input,
  });
  const receipt = {
    ...receiptRow({
      commandId,
      action: erasureAction,
      fingerprint: digests.fingerprint,
      principal,
      apiVersion: run.apiVersion,
      request: { transport: 'runtime', requestId: commandId },
      now,
    }),
    status: 'accepted' as const,
  };
  if ((await unit.receipts.claim(receipt)) === 'exists') {
    throw errors.internal(`the receipt of command ${commandId} exists already`);
  }
  await unit.jobs.enqueue({
    ...jobInput({
      scope: run.scope,
      principal,
      caller: scene.module,
      action,
      causation: {
        commandId: scene.commandId,
        ...(scene.causeEventId === undefined ? {} : { eventId: scene.causeEventId }),
      },
      build: run.build,
      apiVersion: run.apiVersion,
      now,
      queue: commandQueue,
      limits: run.quotas,
    }),
    kind: 'action',
    retry: ownErasureRetry,
    // The entity names what the job's admission checks; only a kernel command id may carry it.
    run: commandJobRun(
      erasureAction,
      {
        ...((await sealJobInput(unit, run.registry, commandId, action, input)) as object),
        entity: entry.ref,
      },
      commandId,
    ),
  });
  await appendReceiptChange(unit, {
    registry: run.registry,
    scope: run.scope,
    receipt,
    meta: buildEventMeta({
      principal,
      commandId,
      action: erasureAction,
      correlationId: scene.meta.correlationId ?? commandId,
      build: run.build,
      flags: [],
      decision: null,
    }),
    hybridClock: scene.hybridClock,
    now,
  });
}
