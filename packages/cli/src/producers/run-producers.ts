import { produceAppGeneratedFiles } from './app-generated-files.ts';
import { produceCliManifests } from './cli-manifest.ts';
import { deriveApps } from './derive-apps.ts';
import { joinResults } from './join-results.ts';
import { produceMigrationsAgainstSnapshots } from './migrations-against-snapshots.ts';
import { produceModuleManifests } from './module-manifests.ts';
import type { ProducedFiles } from './produced-files.ts';
import type { ProducerName } from './producer-name.ts';
import type { ProducerResult } from './producer-result.ts';
import { reconcileFiles } from './reconcile-files.ts';
import { produceSurfaces } from './surfaces.ts';
import { produceTransportArtefacts } from './transport-artefacts.ts';

async function settle(
  root: string,
  check: boolean,
  produced: ProducedFiles,
): Promise<ProducerResult> {
  const reconciled = await reconcileFiles(root, produced.files, check);
  return {
    written: reconciled.written,
    notes: [...produced.notes, ...reconciled.notes],
    failures: [...produced.failures, ...reconciled.failures],
  };
}

/** What `runProducers` is asked for. */
export interface RunProducersOptions {
  /** The workspace root. */
  readonly root: string;
  /** Compare instead of write. */
  readonly check: boolean;
  /** The producers to run; default: all of them. */
  readonly only?: readonly ProducerName[];
}

/**
 * Runs the producers of section 13.7 over the workspace at `root`: the module manifests first
 * (the apps import them), then everything derived from the apps. Writes every artefact, or with
 * `check` says which ones have drifted; a producer that finds a problem does not stop the others.
 */
export async function runProducers(options: RunProducersOptions): Promise<ProducerResult> {
  const { root, check } = options;
  const wanted = (name: ProducerName): boolean => options.only?.includes(name) ?? true;
  const results: ProducerResult[] = [];
  if (wanted('manifests')) results.push(await produceModuleManifests(root, check));
  if (
    ['surfaces', 'app', 'openapi', 'cli', 'migrations'].some((name) => wanted(name as ProducerName))
  ) {
    const derived = await deriveApps(root);
    results.push({ written: [], notes: derived.notes, failures: derived.failures });
    if (wanted('surfaces')) {
      results.push(await settle(root, check, await produceSurfaces(root, derived.apps, check)));
    }
    if (wanted('app')) {
      results.push(await settle(root, check, produceAppGeneratedFiles(derived.apps)));
    }
    if (wanted('openapi')) {
      results.push(
        await settle(root, check, await produceTransportArtefacts(root, derived.apps, check)),
      );
    }
    if (wanted('cli')) {
      results.push(await settle(root, check, await produceCliManifests(root, derived.apps, check)));
    }
    if (wanted('migrations')) {
      results.push(await produceMigrationsAgainstSnapshots(root, derived.apps, check));
    }
  }
  return joinResults(results);
}
