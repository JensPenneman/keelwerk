import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DeploymentDefinition } from '@keelwerk/core';
import { devChildEnv } from './dev-child-env.ts';
import type { DevPaths } from './dev-paths.ts';
import { makePrivateDirectory } from './make-private-directory.ts';

function keyOf(path: string): string {
  try {
    const found = readFileSync(path, 'utf8').trim();
    if (found !== '') return found;
  } catch {
    // no key yet: made below
  }
  const made = randomBytes(32).toString('base64');
  makePrivateDirectory(dirname(path));
  writeFileSync(path, `${made}\n`, { mode: 0o600 });
  return made;
}

/**
 * The environment of the app child (`devChildEnv`) and, when the deployment
 * names a master key that the machine does not provide, a development key kept in
 * `.keelwerk/dev-master-key` so sealed values survive a restart.
 */
export function devEnvOf(
  definition: DeploymentDefinition,
  env: Readonly<Record<string, string | undefined>>,
  paths: DevPaths,
): Readonly<Record<string, string | undefined>> {
  const name = definition.keys?.masterKey.ref;
  const needsKey = name !== undefined && (env[name] === undefined || env[name] === '');
  return {
    ...devChildEnv(env),
    ...(needsKey ? { [name]: keyOf(paths.masterKey) } : {}),
  };
}
