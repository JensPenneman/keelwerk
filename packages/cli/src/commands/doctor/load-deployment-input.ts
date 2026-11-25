import { pathToFileURL } from 'node:url';
import type { DeploymentDefinition } from '@keelwerk/core';
import type { CliHost } from '../../context/cli-host.ts';
import { findDeploymentFile } from '../../context/find-deployment-file.ts';
import type { DeploymentInput } from '../../doctor/deployment-input.ts';
import type { DoctorFinding } from '../../doctor/doctor-finding.ts';
import { findingOf } from '../../doctor/finding-of.ts';
import { modeOf } from '../../doctor/mode-of.ts';
import { openControl } from '../../doctor/open-control.ts';
import { openPlacements } from '../../doctor/open-placements.ts';
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
  /** Closes the control store the input reads; absent when none was opened. */
  readonly close?: () => Promise<void>;
}

/**
 * Loads the deployment file of project mode (section 16.9.1) and reads what the checks judge: the
 * definition, its apps' registries, the environment, the placements with the capabilities of each
 * adapter except `pglite` (connected without migrating and closed again) and the control store,
 * which stays open for the reader until `close` is called.
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
          'not-checked',
          'deployment file',
          'no keelwerk.config.ts or .launchway/deployment.ts was found, so the deployment checks did not run',
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
    const registries = definition.apps.flatMap((app) => registryOfApp(app) ?? []);
    const placements = await openPlacements(definition, host.env, host.schedule);
    const control = await openControl(definition, host.env, registries, host.schedule);
    return {
      input: {
        definition,
        env: host.env,
        modeOf,
        registries,
        placements,
        reader: control.reader,
      },
      findings: [],
      close: control.close,
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
