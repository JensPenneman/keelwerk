import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript-6';
import type { EnvironmentFacts } from './environment-facts.ts';
import { installedVersion } from './installed-version.ts';

async function rootManifest(root: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The `@biomejs/biome` version the installed Biome preset expects (its peer dependency); undefined when the preset is not installed. */
async function presetBiomeVersion(root: string): Promise<string | undefined> {
  try {
    const text = await readFile(
      join(root, 'node_modules', '@keelwerk', 'biome-config', 'package.json'),
      'utf8',
    );
    const peers = (JSON.parse(text) as { peerDependencies?: Record<string, unknown> })
      .peerDependencies;
    const wanted = peers?.['@biomejs/biome'];
    return typeof wanted === 'string' ? wanted : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads the environment facts of the workspace at `root`. `pnpmVersion` asks the machine for the
 * installed pnpm (it runs `pnpm --version`); doctor's tests pass a fixed answer.
 */
export async function readEnvironmentFacts(
  root: string,
  node: string,
  pnpmVersion: () => Promise<string | undefined>,
): Promise<EnvironmentFacts> {
  const manifest = await rootManifest(root);
  const manager = manifest.packageManager;
  return {
    node: node.replace(/^v/, ''),
    typescript: await installedVersion(root, 'typescript'),
    typescriptSix: ts.version,
    pnpm: await pnpmVersion(),
    pnpmWanted:
      typeof manager === 'string' && manager.startsWith('pnpm@')
        ? manager.slice(5).split('+')[0]
        : undefined,
    biome: await installedVersion(root, '@biomejs/biome'),
    biomeWanted: await presetBiomeVersion(root),
  };
}
