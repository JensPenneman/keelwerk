import { publishRepository } from './publish-repository.ts';

type Json = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every string target of an exports or bin value; the source condition is reported on its own. */
function targets(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, inner]) =>
    key === '@keelwerk/source' ? [] : targets(inner),
  );
}

function conditionNames(value: unknown): readonly string[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, inner]) => [
    ...(key.startsWith('.') ? [] : [key]),
    ...conditionNames(inner),
  ]);
}

function inFiles(target: string, files: ReadonlySet<string>): boolean {
  return files.has(target.replace(/^\.\//, ''));
}

/**
 * What is wrong with one packed tarball, empty when nothing: `manifest` is its package/package.json,
 * `files` its entries without the `package/` prefix. One string per problem, prefixed with the name.
 */
export function tarballProblems(
  manifest: unknown,
  files: readonly string[],
  expected: {
    readonly name: string;
    readonly version: string;
    /** The directory below packages/ that the repository member must name. */
    readonly directory?: string;
  },
): readonly string[] {
  const problems: string[] = [];
  const report = (text: string): number => problems.push(`${expected.name}: ${text}`);
  if (!isRecord(manifest)) {
    report('package.json is not an object');
    return problems;
  }
  if (manifest.name !== expected.name) report(`name is ${String(manifest.name)}`);
  if (manifest.version !== expected.version) {
    report(`version is ${String(manifest.version)}, expected ${expected.version}`);
  }
  const engines = manifest.engines;
  if (!isRecord(engines) || engines.node !== '>=26') report('engines.node is not >=26');
  if (typeof manifest.license !== 'string' || manifest.license.trim() === '') {
    report('license is missing');
  }
  const repository = manifest.repository;
  const url = `git+https://github.com/${publishRepository}.git`;
  if (!isRecord(repository) || repository.url !== url) {
    report(`repository.url is not ${url}`);
  } else if (
    expected.directory !== undefined &&
    repository.directory !== `packages/${expected.directory}`
  ) {
    report(`repository.directory is not packages/${expected.directory}`);
  }
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const specs = manifest[field];
    if (!isRecord(specs)) continue;
    for (const [dependency, spec] of Object.entries(specs)) {
      if (typeof spec === 'string' && spec.startsWith('workspace:')) {
        report(`${field} ${dependency} is still ${spec}`);
      }
    }
  }
  if (conditionNames(manifest.exports).includes('@keelwerk/source')) {
    report('exports still has the @keelwerk/source condition');
  }
  const present = new Set(files);
  const bin = typeof manifest.bin === 'string' ? { [expected.name]: manifest.bin } : manifest.bin;
  for (const [origin, value] of [
    ['exports', manifest.exports],
    ['bin', bin],
  ] as const) {
    for (const target of targets(value)) {
      if (!target.includes('*') && !inFiles(target, present)) {
        report(`${origin} target ${target} is not in the tarball`);
      }
    }
  }
  return problems;
}
