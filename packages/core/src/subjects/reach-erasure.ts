import { sha256 } from '../crypto/sha256.ts';
import { errors } from '../errors/errors.ts';
import type { StreamRef } from '../events/stream-ref.ts';
import { kernelCommandId } from '../ids/kernel-command-id.ts';
import { placeholderPrincipal } from '../invoker/edge/placeholder-principal.ts';
import { askReaches } from './ask-reaches.ts';
import { erasureKey } from './erasure-key.ts';
import { erasureReachPoint } from './erasure-reach-point.ts';
import { namedBuckets } from './named-buckets.ts';
import { personAddresses } from './person-addresses.ts';
import type { ReachErasureInput } from './reach-erasure-input.ts';
import { requestOwnSubjectErasure } from './request-own-subject-erasure.ts';

/**
 * The step of section 14.7.5 that runs right before the subject's keys are destroyed. Each filler
 * of `core.erasureReach` is asked for the addresses it holds for the subject (`addressesOf`, opened
 * under the subject's key, so only before the shred); the addresses that a living subject other than
 * the person holds are dropped once (`heldByOthers` of every filler, `personAddresses`); then each
 * filler is asked for the pending rows of its own entities that name one of the addresses that are
 * left (`heldBy`) and for the buckets that name the subject or one of them (`bucketsOf`). In one
 * writing unit it requests the erasure of each such row's id as the module's own request
 * (`requestOwnSubjectErasure`, the request of `eraseOwnSubject`), under a command id made from the
 * erasure's identity and the row (a row whose request exists already, or that is gone, is done),
 * and forgets the buckets. The step does nothing once a key of the subject is shredded, because it
 * committed before the shred did, and nothing when no filler answers. It writes no personal value
 * and no address: the requests carry the row's id only.
 */
export async function reachErasure(input: ReachErasureInput): Promise<void> {
  const { context, source, target, record } = input;
  const fills = source.registry.fills.get(erasureReachPoint) ?? [];
  if (fills.length === 0) return;
  const { adapter } = target.handle;
  const shredded = await adapter.unit(
    target.namespace,
    target.scope,
    async (unit) => (await unit.keys.shreddedKeys(record.subjectId)).length > 0,
    { readOnly: true },
  );
  if (shredded) return;
  const { rows, buckets } = await askReaches(input, async (reaches, drive) => {
    const addresses = await personAddresses(reaches, drive, record.subjectId);
    const held: (StreamRef & { readonly module: string })[] = [];
    if (addresses.length > 0) {
      for (const { module, reach } of reaches) {
        if (reach.heldBy === undefined) continue;
        for (const row of await drive<readonly StreamRef[]>(reach.heldBy(addresses), module)) {
          held.push({ type: row.type, id: row.id, module });
        }
      }
    }
    return { rows: held, buckets: await namedBuckets(input, reaches, addresses) };
  });
  if (rows.length === 0 && buckets.length === 0) return;
  const app = context.apps.get(source.namespace.appId);
  if (app === undefined) throw errors.internal('The served app of the erasure is missing.');
  const quotas = await context.quotas?.fresh();
  const identity = sha256(erasureKey(record));
  const { writer } = context.control;
  await adapter.unit(target.namespace, target.scope, async (unit) => {
    await input.insideUnit?.();
    for (const { module, ...row } of rows) {
      await requestOwnSubjectErasure({
        unit,
        registry: source.registry,
        scope: target.scope,
        module,
        caused: placeholderPrincipal(target.scope),
        row,
        commandId: kernelCommandId('erasure', identity, 'reach', row.id),
        causation: { commandId: record.commandId },
        meta: { correlationId: record.commandId },
        build: context.build,
        apiVersion: app.head,
        quotas,
        keys: context.keys,
        clock: context.clock,
        hybridClock: writer.hybridClock,
      });
    }
    await unit.buckets.forget(buckets);
  });
}
