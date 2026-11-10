import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReleasePackage } from './release-package.ts';

interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly private?: boolean;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
}

interface Entry {
  readonly manifest: Manifest;
  readonly directory: string;
}

function runtimeDependencies(manifest: Manifest): readonly string[] {
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ];
}

/**
 * Every non-private package under `root`/packages in dependency order (a package after everything in
 * its `dependsOn`), ties by name. devDependencies are ignored. Throws `Error('dependency cycle: a -> b -> a')`,
 * and an error naming the package when a published package needs a private workspace package.
 */
export function publishOrder(root: string): readonly ReleasePackage[] {
  const entries: Entry[] = [];
  const privateNames = new Set<string>();
  for (const directory of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const manifest = JSON.parse(
      readFileSync(join(root, 'packages', directory.name, 'package.json'), 'utf8'),
    ) as Manifest;
    if (manifest.private === true) privateNames.add(manifest.name);
    else entries.push({ manifest, directory: directory.name });
  }
  entries.sort((a, b) => (a.manifest.name < b.manifest.name ? -1 : 1));
  const byName = new Map(entries.map((entry) => [entry.manifest.name, entry]));
  const packages = new Map<string, ReleasePackage>();
  const stack: string[] = [];

  const visit = (entry: Entry): void => {
    const { name, version } = entry.manifest;
    if (packages.has(name)) return;
    const at = stack.indexOf(name);
    if (at !== -1) throw new Error(`dependency cycle: ${[...stack.slice(at), name].join(' -> ')}`);
    stack.push(name);
    const dependsOn: string[] = [];
    for (const dependency of runtimeDependencies(entry.manifest)) {
      if (privateNames.has(dependency)) {
        throw new Error(
          `${name} is published but depends on the private workspace package ${dependency}: make that package public or remove the dependency`,
        );
      }
      const target = byName.get(dependency);
      if (target === undefined) continue;
      dependsOn.push(dependency);
      visit(target);
    }
    stack.pop();
    packages.set(name, {
      name,
      directory: entry.directory,
      version,
      dependsOn: dependsOn.sort(),
      tarball: `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`,
    });
  };

  for (const entry of entries) visit(entry);
  return [...packages.values()];
}
