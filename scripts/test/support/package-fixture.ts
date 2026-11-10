import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** One package of a fixture repository: its directory below packages/ and its manifest members. */
export interface FixturePackage {
  readonly directory: string;
  readonly manifest: Readonly<Record<string, unknown>>;
}

/** Writes a repository root with the given packages and the release manifest; returns the root. */
export function packageFixture(
  packages: readonly FixturePackage[],
  releaseVersion = '0.1.0',
): string {
  const root = mkdtempSync(join(tmpdir(), 'publish-fixture-'));
  const write = (path: string, content: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  write('.release-please-manifest.json', `${JSON.stringify({ '.': releaseVersion })}\n`);
  for (const entry of packages) {
    write(
      `packages/${entry.directory}/package.json`,
      `${JSON.stringify(entry.manifest, null, 2)}\n`,
    );
  }
  mkdirSync(join(root, 'packages'), { recursive: true });
  return root;
}
