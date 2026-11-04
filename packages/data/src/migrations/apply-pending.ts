import type { NamespaceRef, SchemaOperations } from '@keelwerk/core';
import { errors, KeelwerkError } from '@keelwerk/core';
import type { TrackFiles } from './check-migration-history.ts';
import { checkMigrationHistory } from './check-migration-history.ts';
import { classifyContractSteps } from './classify-contract-steps.ts';

async function openContractGate(gate: ContractGate): Promise<void> {
  const running = await gate.liveBuildIds();
  if (running.some((build) => build !== gate.buildId)) {
    throw new KeelwerkError({
      kind: 'conflict',
      code: 'core.rollout_not_finalized',
      message: 'contract steps wait until every live process runs this build (S-44)',
    });
  }
}

/** What `db apply --contract` needs to know about the running processes (S-44). */
export interface ContractGate {
  /** The build id of the process that applies. */
  readonly buildId: string;
  /** The build ids of every live `core.process`. */
  readonly liveBuildIds: () => Promise<readonly string[]>;
}

/** How `applyPending` runs. */
export interface ApplyPendingOptions {
  /** Present: files with contract steps apply too (`--contract`), once the gate passes. */
  readonly contract?: ContractGate;
  readonly warn?: (message: string) => void;
}

/** What `applyPending` did. */
export interface ApplyPendingResult {
  readonly applied: readonly { readonly track: string; readonly id: string }[];
  /** Files left for `--contract`, with every later file of their track. */
  readonly deferred: readonly { readonly track: string; readonly id: string }[];
}

/**
 * Applies the pending files of the active tracks, given in run order (section 14.6.3), under the
 * namespace lock (`schema.lock`; the caller holds none, the locks do not nest). The history is verified first: drift refuses. A file absent from the history but
 * older than applied ones of its track (a merged parallel branch) applies with a warning. A file
 * with a contract step waits unless `contract` is given and every live process runs the same
 * build (S-44); it holds back the later files of its track, which may depend on it.
 */
export async function applyPending(
  schema: SchemaOperations,
  namespace: NamespaceRef,
  tracks: readonly TrackFiles[],
  options: ApplyPendingOptions = {},
): Promise<ApplyPendingResult> {
  return schema.lock(namespace, async () => {
    const history = await schema.history(namespace);
    const drift = checkMigrationHistory(history, tracks);
    if (drift.length > 0) throw errors.conflict(`migration drift: ${drift.join('; ')}`);
    const applied: { track: string; id: string }[] = [];
    const deferred: { track: string; id: string }[] = [];
    let gateOpen = false;
    for (const { track, files } of tracks) {
      const done = new Set(history.filter((row) => row.track === track).map((row) => row.id));
      const newest = [...done].sort().at(-1);
      let blocked = false;
      for (const file of [...files].sort((a, b) => (a.id < b.id ? -1 : 1))) {
        if (done.has(file.id)) continue;
        const contract = classifyContractSteps(file.steps).contract.length > 0;
        if (blocked || (contract && options.contract === undefined)) {
          blocked = true;
          deferred.push({ track, id: file.id });
          continue;
        }
        if (contract && options.contract !== undefined && !gateOpen) {
          await openContractGate(options.contract);
          gateOpen = true;
        }
        if (newest !== undefined && file.id < newest) {
          options.warn?.(`${track} ${file.id} is older than ${newest}, which is already applied`);
        }
        await schema.apply(namespace, file);
        applied.push({ track, id: file.id });
      }
    }
    return { applied, deferred };
  });
}
