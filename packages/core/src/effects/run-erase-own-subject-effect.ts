import { errors } from '../errors/errors.ts';
import { kernelCommandId } from '../ids/kernel-command-id.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { EraseOwnSubjectEffect } from '../protocol/erase-own-subject-effect.ts';
import { requestOwnSubjectErasure } from '../subjects/request-own-subject-erasure.ts';
import type { EffectScene } from './effect-scene.ts';

/**
 * `eraseOwnSubject(row)` (section 14.7.5): the request for the erasure of the id of a row of the
 * requesting module's own entity, written in the unit that ends the row. It writes what
 * `acceptAsyncCommand` writes for `core.eraseSubject` (`requestOwnSubjectErasure`): the `accepted`
 * receipt, the job and the receipt's change record, under the module's service principal
 * (`<module>.system`), so the unchanged worker of section 14.7.5 does every step and writes every
 * ledger record. Only a tenant unit, an entity the module owns whose data subject is a field or
 * path, and a live row are accepted here, and a request that fails these refuses the unit. Whether
 * the erasure may start is not asked here: ending a row never depends on it. The job asks when it
 * starts (`admitErasure`): a rule that denies `core.eraseSubject` for that principal, or another
 * row that holds the subject, makes it wait and try again (`erasureRetry`); no allow rule is
 * needed, because the module's own row is the ownership. The receipt carries no address or user
 * agent, and its expiry does not end the request: an accepted receipt stays, and the job is tried
 * for as long as it is held back. A unit that repeats rolls its receipt and job back with it.
 */
export async function runEraseOwnSubjectEffect(
  scene: EffectScene,
  effect: EraseOwnSubjectEffect,
  id: string,
): Promise<void> {
  const { run } = scene;
  const requested = await requestOwnSubjectErasure({
    unit: scene.unit,
    registry: run.registry,
    scope: run.scope,
    module: scene.module,
    caused: run.principal,
    row: effect.row,
    commandId: kernelCommandId('effect', id),
    causation: {
      commandId: scene.commandId,
      ...(scene.causeEventId === undefined ? {} : { eventId: scene.causeEventId }),
    },
    meta: scene.meta,
    build: run.build,
    apiVersion: run.apiVersion,
    quotas: run.quotas,
    keys: run.keys,
    ...(run.fingerprintKey === undefined ? {} : { fingerprintKey: run.fingerprintKey }),
    clock: scene.clock,
    hybridClock: scene.hybridClock,
  });
  if (requested === 'absent') {
    throw refuseRequest(`eraseOwnSubject of "${effect.row.type}"`, 'it names no live row');
  }
  if (requested === 'exists') {
    throw errors.internal(`the receipt of command ${kernelCommandId('effect', id)} exists already`);
  }
}
