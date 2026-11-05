import { pathToFileURL } from 'node:url';
import type { DeploymentDefinition } from '@keelwerk/core';
import { localFailure } from '../context/local-failure.ts';

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

/** The deployment the file at `path` exports as its default; anything else is an `unavailable` failure that names the file. */
export async function loadDefinition(path: string): Promise<DeploymentDefinition> {
  let loaded: unknown;
  try {
    loaded = await import(pathToFileURL(path).href);
  } catch (error) {
    throw localFailure(
      'unavailable',
      'cli.deployment_not_loadable',
      `${path} could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const definition = (loaded as { default?: unknown }).default;
  if (!isDefinition(definition)) {
    throw localFailure(
      'unavailable',
      'cli.deployment_not_loadable',
      `${path}: the default export is not a deployment`,
    );
  }
  return definition;
}
