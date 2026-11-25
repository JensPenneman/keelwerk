import type { DeploymentDefinition, Registry } from '@keelwerk/core';
import { recordedDeploymentId } from '@keelwerk/core';
import type { CliHost } from '../context/cli-host.ts';
import { connectAdapter } from '../db/connect-adapter.ts';
import { controlRootNamespace } from '../db/control-root-namespace.ts';
import { probeId } from '../db/probe-id.ts';
import { absent } from './absent.ts';
import { adapterEnvironmentOf } from './adapter-environment-of.ts';
import { controlReaderOf } from './control-reader-of.ts';
import type { ControlSource } from './control-source.ts';
import { controlSourceOf } from './control-source-of.ts';
import { factoryOf } from './factory-of.ts';
import { known } from './known.ts';
import type { OpenedControl } from './opened-control.ts';
import { pgliteId } from './pglite-id.ts';
import { placementConfigOf } from './placement-config-of.ts';
import { unanswered } from './unanswered.ts';
import { withinDeadline } from './within-deadline.ts';

const nothingOpened = async (): Promise<void> => undefined;

/** Why doctor reads nothing, and what the operator can do about it. */
function unread(reason: string, fix: string): OpenedControl {
  return { reader: absent(reason, fix), close: nothingOpened };
}

/** A control store that did not answer: every read of it fails with what went wrong, so the reachability check says so. */
function failedSource(error: unknown): ControlSource {
  return { read: () => Promise.reject(error) };
}

/**
 * Opens the control store of the deployment to read it. The recorded deployment id is read over a
 * probe connection, through the adapter's schema client, which connects with the owner's url when
 * the adapter has one; that read is a read-only transaction (the schema operations' `history` sets
 * it first, so the database refuses a write in it), and doctor waits for it no longer than its
 * deadline.
 * Then one adapter is created with that id and connected without migrating: every other read
 * goes through it as a read-only unit of the application's role. Doctor never opens a store that
 * only the process running it can read (the adapter `pglite`, an adapter of the `memory`
 * dialect), none when no app is selected or no deployment id is recorded. A store that does not
 * connect, or does not answer, gives a reader whose reads fail with the reason, and what doctor
 * opened is closed without waiting for what does not answer.
 */
export async function openControl(
  definition: DeploymentDefinition,
  env: Readonly<Record<string, string | undefined>>,
  registries: readonly Registry[],
  schedule: CliHost['schedule'],
): Promise<OpenedControl> {
  const entry = definition.control;
  const factory = factoryOf(definition.infrastructure, entry.adapter);
  if (entry.adapter === pgliteId || factory?.dialect === 'memory') {
    return unread(
      'the control store is an embedded or in-memory store, which only the process that runs it can read',
      'nothing to do: doctor never opens such a store',
    );
  }
  if (factory === undefined) {
    return unread(
      `no infrastructure entry provides the ${entry.adapter} adapter of the control store`,
      `add the ${entry.adapter} adapter to \`infrastructure\` in the deployment file`,
    );
  }
  const config = placementConfigOf('control', entry, env);
  if (config === undefined) {
    return unread(
      'the url of the control store reads an environment variable that is not set',
      'set the environment variable the url reads, then run doctor again',
    );
  }
  const registry = registries[0];
  if (registry === undefined) {
    return unread(
      'no app is selected, so doctor has no descriptor of the control store',
      'add an app to the deployment file',
    );
  }
  const now = (): Temporal.Instant => Temporal.Now.instant();
  const environment = adapterEnvironmentOf(env);
  try {
    const probe = await connectAdapter(
      'control',
      factory,
      config,
      { ...environment, deploymentId: probeId },
      schedule,
    );
    let deploymentId: string | undefined;
    let answered = false;
    try {
      deploymentId = await withinDeadline(
        schedule,
        recordedDeploymentId(probe.adapter, controlRootNamespace),
        unanswered,
      );
      answered = true;
    } finally {
      const closing = probe.adapter.close(1000);
      if (answered) await withinDeadline(schedule, closing, () => undefined);
      else void closing.catch(() => undefined);
    }
    if (deploymentId === undefined) {
      return unread(
        'no deployment id is recorded in the control store: the deployment has never started',
        'start the deployment, then run doctor again',
      );
    }
    const { adapter } = await connectAdapter(
      'control',
      factory,
      config,
      { ...environment, deploymentId },
      schedule,
    );
    const source = controlSourceOf(adapter, controlRootNamespace, registry, schedule);
    return {
      reader: known(controlReaderOf(source, now)),
      close: () => withinDeadline(schedule, adapter.close(1000), () => undefined),
    };
  } catch (error) {
    return { reader: known(controlReaderOf(failedSource(error), now)), close: nothingOpened };
  }
}
