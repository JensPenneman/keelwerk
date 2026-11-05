import type { SecretRef } from '@keelwerk/core';
import { clusterOf } from './cluster-of.ts';
import type { DeploymentFacts, PlacementFact, QueueFact, WorkFact } from './deployment-facts.ts';
import type { DeploymentInput } from './deployment-input.ts';
import { personalFieldsOf } from './personal-fields-of.ts';
import { readAnchorFacts } from './read-anchor-facts.ts';
import { secretPresent } from './secret-present.ts';
import { workersOf } from './workers-of.ts';

const NO_WORK: WorkFact = {
  deadLetters: 0,
  parkedStreams: 0,
  cappedLanes: 0,
  unplaceable: 0,
  externalTableDrift: [],
};

/**
 * Collects what the checks judge: the deployment definition (socket, master key, placements,
 * queues, anchors cadence) and, when a reader is given, the running state of its control store.
 * Without a reader the running facts stay empty and `controlReachable` is undefined.
 */
export async function readDeploymentFacts(input: DeploymentInput): Promise<DeploymentFacts> {
  const { definition, reader } = input;
  const placementFact = (
    name: string,
    entry: { readonly adapter: string; readonly [member: string]: unknown },
  ): PlacementFact => ({
    name,
    adapter: entry.adapter,
    cluster: clusterOf(entry, input.env),
    capabilities: input.capabilities.get(name),
  });
  const socketPath = definition.operator?.socket;
  const masterKey: SecretRef | undefined = definition.keys?.masterKey;
  const depths = (await reader?.queueDepths?.()) ?? new Map();
  const queues: QueueFact[] = Object.entries(definition.queues ?? {}).map(([name, caps]) => ({
    name,
    queued: depths.get(name)?.queued ?? 0,
    running: depths.get(name)?.running ?? 0,
    queuedCap: caps.queued,
    runningCap: caps.running,
    workers: workersOf(definition, name),
  }));
  return {
    socket:
      socketPath === undefined
        ? undefined
        : { path: socketPath, mode: await input.modeOf(socketPath) },
    masterKey: {
      declared: masterKey !== undefined,
      present:
        masterKey !== undefined &&
        (await secretPresent(masterKey, definition.infrastructure, input.env)),
    },
    controlReachable: await reader?.reachable(),
    control: placementFact('control', definition.control),
    placements: Object.entries(definition.placements).map(([name, entry]) =>
      placementFact(name, entry),
    ),
    ledgerSinks: definition.infrastructure.filter(
      (entry) =>
        typeof entry === 'object' && entry !== null && 'append' in entry && 'read' in entry,
    ).length,
    hookFailures: (await reader?.hookFailures()) ?? [],
    work: (await reader?.work?.()) ?? NO_WORK,
    sqlNeeds: input.sqlNeeds ?? [],
    queues,
    processes: (await reader?.processes()) ?? [],
    anchors: await readAnchorFacts(
      definition.infrastructure,
      definition.anchors?.every,
      reader?.heads?.bind(reader),
    ),
    personal: personalFieldsOf(input.registries),
  };
}
