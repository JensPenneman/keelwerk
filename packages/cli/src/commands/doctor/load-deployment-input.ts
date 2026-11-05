import { pathToFileURL } from 'node:url';
import type { DeploymentDefinition } from '@keelwerk/core';
import type { CliHost } from '../../context/cli-host.ts';
import { findDeploymentFile } from '../../context/find-deployment-file.ts';
import type { DeploymentInput } from '../../doctor/deployment-input.ts';
import type { DoctorFinding } from '../../doctor/doctor-finding.ts';
import { findingOf } from '../../doctor/finding-of.ts';
import { modeOf } from '../../doctor/mode-of.ts';
import { openCapabilities } from '../../doctor/open-capabilities.ts';
import { registryOfApp } from '../../doctor/registry-of-app.ts';

function isDefinition(value: unknown): value is DeploymentDefinition {
  const candidate = value as Partial<DeploymentDefinition> | null;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    Array.isArray(candidate.apps) &&
    Array.isArray(candidate.infrastructure) &&
    typeof candidate.control?.adapter === 'string' &&
    typeof candidate.placements === 'object'
  );
}

/** The deployment file's definition as doctor's input, or the finding that says why there is none. */
export interface LoadedDeployment {
  readonly input: DeploymentInput | undefined;
  readonly findings: readonly DoctorFinding[];
}

/**
 * Loads the deployment file of project mode (section 16.9.1) and reads what can be judged without
 * the control store's rows (none, while doctor has no connection): the definition, its apps' registries, the environment and the
 * capabilities of each adapter, which are connected without migrating and closed again.
 */
export async function loadDeploymentInput(
  host: CliHost,
  explicit: string | undefined,
): Promise<LoadedDeployment> {
  const path = await findDeploymentFile(host, explicit);
  if (path === undefined || !(await host.files.exists(path))) {
    return {
      input: undefined,
      findings: [
        findingOf(
          'deployment',
          'note',
          'deployment file',
          'no keelwerk.config.ts or .launchway/deployment.ts was found, so the deployment checks were skipped',
          'run doctor in a project, or pass --config',
        ),
      ],
    };
  }
  try {
    const loaded: unknown = await import(pathToFileURL(path).href);
    const definition = (loaded as { default?: unknown }).default;
    if (!isDefinition(definition)) {
      throw new Error('the default export is not a deployment');
    }
    const opened = await openCapabilities(definition, host.env);
    return {
      input: {
        definition,
        env: host.env,
        modeOf,
        registries: definition.apps.flatMap((app) => registryOfApp(app) ?? []),
        capabilities: opened.capabilities,
        reader: undefined,
      },
      findings: opened.findings,
    };
  } catch (error) {
    return {
      input: undefined,
      findings: [
        findingOf(
          'deployment',
          'error',
          path,
          `the deployment file could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
          'run the file with node to see the error',
        ),
      ],
    };
  }
}
