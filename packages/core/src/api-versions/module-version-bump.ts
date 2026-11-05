import type { SurfaceChange } from './surface-change.ts';

const rank: Readonly<Record<RequiredBump, number>> = { none: 0, patch: 1, minor: 2, major: 3 };

function partsOf(version: string): readonly [number, number, number] {
  const [major = 0, minor = 0, patch = 0] =
    version.split(/[-+]/, 1)[0]?.split('.').map(Number) ?? [];
  return [major, minor, patch];
}

function bumpBetween(before: string, after: string): RequiredBump {
  const [bm, bn, bp] = partsOf(before);
  const [am, an, ap] = partsOf(after);
  if (am !== bm) return am > bm ? 'major' : 'none';
  if (an !== bn) return an > bn ? 'minor' : 'none';
  return ap > bp ? 'patch' : 'none';
}

function wentDown(before: string, after: string): boolean {
  const was = partsOf(before);
  const now = partsOf(after);
  for (const [index, part] of was.entries()) {
    const next = now[index] ?? 0;
    if (next !== part) return next < part;
  }
  return false;
}

/** The least a semantic version must rise for a set of changes (section 18.6). */
export type RequiredBump = 'none' | 'patch' | 'minor' | 'major';

/** The verdict on one module package's version. */
export interface ModuleVersionVerdict {
  readonly required: RequiredBump;
  readonly actual: RequiredBump;
  readonly ok: boolean;
}

/**
 * Whether a module package's new version fits the changes of its own surface (section 18.6):
 * breaking needs a major, dangerous or additive a minor, neutral a patch. The composed-alone
 * surfaces of the two versions supply `changes` through `diffSurfaces`. A higher bump than required
 * is fine; a version that went down never is.
 */
export function moduleVersionBump(
  before: string,
  after: string,
  changes: readonly SurfaceChange[],
): ModuleVersionVerdict {
  let required: RequiredBump = 'none';
  for (const change of changes) {
    const needed: RequiredBump =
      change.class === 'breaking' ? 'major' : change.class === 'neutral' ? 'patch' : 'minor';
    if (rank[needed] > rank[required]) required = needed;
  }
  const actual = bumpBetween(before, after);
  return { required, actual, ok: !wentDown(before, after) && rank[actual] >= rank[required] };
}
