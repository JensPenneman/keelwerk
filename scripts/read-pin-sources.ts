import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PinSources } from './pin-sources.ts';

interface RootManifest {
  readonly packageManager?: unknown;
  readonly devDependencies?: Readonly<Record<string, unknown>>;
  readonly pins?: Readonly<Record<string, unknown>>;
}

const nodeDockerfile = 'pins/node.Dockerfile';
const postgresDockerfile = 'pins/postgres.Dockerfile';

function text(value: unknown, member: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`package.json: ${member} is missing or not a string`);
  }
  return value;
}

/** The image of the one FROM line of a source Dockerfile; throws an Error naming the file otherwise. */
function image(root: string, file: string): string {
  const lines = readFileSync(join(root, file), 'utf8').match(/^FROM[ \t]+.*$/gim) ?? [];
  if (lines.length !== 1) {
    throw new Error(`${file}: found ${lines.length} FROM lines, expected one`);
  }
  const found = /^FROM[ \t]+(\S+)[ \t]*$/i.exec(lines[0] ?? '')?.[1];
  if (found === undefined) {
    throw new Error(`${file}: the FROM line is not of the form "FROM <image>"`);
  }
  return found;
}

/**
 * Reads `<root>/package.json` and the two source Dockerfiles (`pins/node.Dockerfile` and
 * `pins/postgres.Dockerfile`, each with one `FROM <image>` line that Dependabot moves) into the
 * pin sources. Throws an Error naming the member (`devDependencies.vitest`, `pins.npm`,
 * `packageManager`, ...) when it is missing or not a string, when the `pins` member holds anything
 * but `npm`, when `packageManager` is not `pnpm@<semver>` with an optional `+<hash>`, and naming
 * the file when a Dockerfile does not hold exactly one FROM line.
 */
export function readPinSources(root: string): PinSources {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as RootManifest;
  const dev = (name: string): string =>
    text(manifest.devDependencies?.[name], `devDependencies.${name}`);
  const pin = (name: string): string => text(manifest.pins?.[name], `pins.${name}`);
  for (const member of Object.keys(manifest.pins ?? {})) {
    if (member !== 'npm') {
      throw new Error(
        `package.json: pins.${member} is not a pin source (the images live in pins/*.Dockerfile)`,
      );
    }
  }
  const manager = text(manifest.packageManager, 'packageManager');
  const pnpm = /^pnpm@(\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)(?:\+.+)?$/.exec(
    manager,
  )?.[1];
  if (pnpm === undefined) {
    throw new Error(`package.json: packageManager "${manager}" is not pnpm@<version>`);
  }
  return {
    biome: dev('@biomejs/biome'),
    knip: dev('knip'),
    nodeImage: image(root, nodeDockerfile),
    npm: pin('npm'),
    pnpm,
    postgresImage: image(root, postgresDockerfile),
    typescript: dev('typescript'),
    typesNode: dev('@types/node'),
    vitest: dev('vitest'),
  };
}
