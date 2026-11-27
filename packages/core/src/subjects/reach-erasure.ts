import { trace } from '@opentelemetry/api';
import { effectiveRules } from '../authorization/effective-rules.ts';
import { sha256 } from '../crypto/sha256.ts';
import type { ErasureReach } from '../edge/erasure-reach.ts';
import { errors } from '../errors/errors.ts';
import type { StreamRef } from '../events/stream-ref.ts';
import { kernelCommandId } from '../ids/kernel-command-id.ts';
import { placeholderPrincipal } from '../invoker/edge/placeholder-principal.ts';
import { type ResolverEnv, withResolverKit } from '../invoker/edge/with-resolver-kit.ts';
import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { ErasureRecord } from '../ledger/erasure-record.ts';
import type { RuntimeServiceContext } from '../runtime/runtime-service-context.ts';
import type { QueueSource } from '../worker/queue-source.ts';
import { erasureKey } from './erasure-key.ts';
import { personAddresses } from './person-addresses.ts';
import { requestOwnSubjectErasure } from './request-own-subject-erasure.ts';

const point = 'core.erasureReach';

function isReach(value: unknown): value is ErasureReach {
  return typeof value === 'object' && value !== null && 'id' in value;
}

/** What `reachErasure` runs with: the process's services, the tenant's source and target, the record. */
export interface ReachErasureInput {
  readonly context: Pick<
    RuntimeServiceContext,
    'apps' | 'build' | 'clock' | 'compute' | 'control' | 'keys' | 'log' | 'quotas'
  >;
  readonly source: QueueSource;
  /** The tenant's target; its adapter is the worker's guarded one, so the units it opens stop with the worker. */
  readonly target: ScopeTarget;
  readonly record: ErasureRecord;
  /** Runs inside the writing unit, before its writes: the seam of the step. */
  readonly insideUnit?: () => Promise<void>;
}

/**
 * The step of section 14.7.5 that runs right before the subject's keys are destroyed. Each filler
 * of `core.erasureReach` is asked for the addresses it holds for the subject (`addressesOf`, opened
 * under the subject's key, so only before the shred), the addresses that a living subject other than
 * the person holds are dropped once (`heldByOthers` of every filler, `personAddresses`), and then
 * each filler is asked for the pending rows of its own entities that name one of the addresses
 * that are left (`heldBy`). In one writing unit it requests the erasure of each
 * such row's id as the module's own request (`requestOwnSubjectErasure`, the request of
 * `eraseOwnSubject`), under a command id made from the erasure's identity and the row: a row whose
 * request exists already, or that is gone, is done. The step does nothing once a key of the subject
 * is shredded, because it committed before the shred did, and nothing when no filler answers. It
 * writes no personal value and no address: the requests carry the row's id only.
 */
export async function reachErasure(input: ReachErasureInput): Promise<void> {
  const { context, source, target, record } = input;
  const fills = source.registry.fills.get(point) ?? [];
  if (fills.length === 0) return;
  const { adapter } = target.handle;
  const shredded = await adapter.unit(
    target.namespace,
    target.scope,
    async (unit) => (await unit.keys.shreddedKeys(record.subjectId)).length > 0,
    { readOnly: true },
  );
  if (shredded) return;
  const env: ResolverEnv = {
    options: {
      clock: context.clock,
      keys: context.keys,
      compute: context.compute,
      log: context.log,
    },
    rulesOf: effectiveRules,
  };
  const span = trace.getTracer('keelwerk').startSpan('keelwerk.erasure.reach');
  let rows: readonly (StreamRef & { readonly module: string })[];
  try {
    rows = await withResolverKit(
      {
        env,
        registry: source.registry,
        target,
        backendTarget: null,
        config: () => undefined,
        transport: 'erasure',
        requestId: record.commandId,
        span,
        // An archived row still holds its values: the step sees what the person still holds.
        includeArchived: true,
      },
      async (kit) => {
        const placeholder = placeholderPrincipal(target.scope);
        const reaches = kit.fills(point, placeholder).map(({ module, value }) => {
          if (!isReach(value)) {
            throw errors.internal(`A fill of ${point} by "${module}" is not an erasure reach.`);
          }
          return { module, reach: value };
        });
        const addresses = await personAddresses(
          reaches,
          (generator, module) => kit.drive(generator, module, placeholder),
          record.subjectId,
        );
        if (addresses.length === 0) return [];
        const held: (StreamRef & { readonly module: string })[] = [];
        for (const { module, reach } of reaches) {
          if (reach.heldBy === undefined) continue;
          for (const row of await kit.drive<readonly StreamRef[]>(
            reach.heldBy(addresses),
            module,
            placeholder,
          )) {
            held.push({ type: row.type, id: row.id, module });
          }
        }
        return held;
      },
    );
  } finally {
    span.end();
  }
  if (rows.length === 0) return;
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
  });
}
