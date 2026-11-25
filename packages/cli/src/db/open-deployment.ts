import type { AdapterEnvironment, DataAdapter } from '@keelwerk/core';
import { recordedDeploymentId } from '@keelwerk/core';
import type { CliHost } from '../context/cli-host.ts';
import { localFailure } from '../context/local-failure.ts';
import { adapterEnvironmentOf } from '../doctor/adapter-environment-of.ts';
import { factoryOf } from '../doctor/factory-of.ts';
import { placementConfigOf } from '../doctor/placement-config-of.ts';
import { connectAdapter } from './connect-adapter.ts';
import { controlRootNamespace } from './control-root-namespace.ts';
import { deployedApps } from './deployed-apps.ts';
import { loadDefinition } from './load-definition.ts';
import type { OpenedDeployment } from './opened-deployment.ts';
import type { OpenedPlacement } from './opened-placement.ts';
import { probeId } from './probe-id.ts';

/** The data commands wait for a connect as long as the adapter does: a schedule whose timer never fires. */
const noDeadline: CliHost['schedule'] = () => () => undefined;

async function connect(
  name: string,
  entry: { readonly adapter: string; readonly [member: string]: unknown },
  infrastructure: readonly unknown[],
  env: Readonly<Record<string, string | undefined>>,
  environment: AdapterEnvironment,
): Promise<{ readonly adapter: DataAdapter; readonly dialect: string }> {
  const factory = factoryOf(infrastructure, entry.adapter);
  if (factory === undefined) {
    throw localFailure(
      'unavailable',
      'cli.adapter_missing',
      `${name}: no infrastructure entry provides the ${entry.adapter} adapter`,
    );
  }
  const config = placementConfigOf(name, entry, env);
  if (config === undefined) {
    throw localFailure(
      'unavailable',
      'cli.placement_url_unset',
      `${name}: its url reads an environment variable that is not set`,
    );
  }
  return connectAdapter(name, factory, config, environment, noDeadline);
}

async function probeDeploymentId(
  definition: Awaited<ReturnType<typeof loadDefinition>>,
  env: Readonly<Record<string, string | undefined>>,
): Promise<string | undefined> {
  const probe = await connect('control', definition.control, definition.infrastructure, env, {
    ...adapterEnvironmentOf(env),
    deploymentId: probeId,
  });
  try {
    if (probe.dialect === 'memory') return undefined;
    return await recordedDeploymentId(probe.adapter, controlRootNamespace).catch(() => undefined);
  } finally {
    await probe.adapter.close(1000).catch(() => undefined);
  }
}

/**
 * Loads the deployment file and connects the control store and every placement, without
 * migrating or recording anything (the data commands of section 16.9.7 run against what exists).
 * The adapters are created with the deployment id recorded in the control root, so deployment-scope
 * units address the right chain.
 */
export async function openDeployment(
  path: string,
  env: Readonly<Record<string, string | undefined>>,
  progress: (done: string) => void = () => undefined,
): Promise<OpenedDeployment> {
  const definition = await loadDefinition(path);
  const deploymentId = await probeDeploymentId(definition, env);
  progress('read the recorded deployment id');
  const environment: AdapterEnvironment = {
    ...adapterEnvironmentOf(env),
    deploymentId: deploymentId ?? probeId,
  };
  const opened: DataAdapter[] = [];
  try {
    const control = await connect(
      'control',
      definition.control,
      definition.infrastructure,
      env,
      environment,
    );
    opened.push(control.adapter);
    progress('connected the control store');
    const placements: OpenedPlacement[] = [];
    for (const [name, entry] of Object.entries(definition.placements)) {
      const placement = await connect(name, entry, definition.infrastructure, env, environment);
      opened.push(placement.adapter);
      progress(`connected the placement ${name}`);
      placements.push({
        name,
        adapter: placement.adapter,
        dialect: placement.dialect,
        apps: Array.isArray(entry.apps) ? (entry.apps as readonly string[]) : undefined,
      });
    }
    return {
      definition,
      apps: deployedApps(definition.apps),
      deploymentId,
      control: {
        adapter: control.adapter,
        namespace: controlRootNamespace,
        dialect: control.dialect,
      },
      placements,
      close: async () => {
        await Promise.allSettled(opened.map((adapter) => adapter.close(1000)));
      },
    };
  } catch (error) {
    await Promise.allSettled(opened.map((adapter) => adapter.close(0)));
    throw error;
  }
}
