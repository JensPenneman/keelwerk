import { publishRepository } from './publish-repository.ts';

const minimumNpm = [11, 15, 0] as const;

function numbers(version: string): readonly number[] {
  return version.split('.').map((part) => Number.parseInt(part, 10));
}

function npmTooOld(version: string): boolean {
  const found = numbers(version);
  for (const [at, wanted] of minimumNpm.entries()) {
    const have = found[at] ?? 0;
    if (have !== wanted) return have < wanted;
  }
  return false;
}

/**
 * Why a real (not dry) run must not stage, or undefined when it may. Checked in this order: the
 * repository, the ref, the tag at the commit, the version (a 0.x release, beta policy), the npm version.
 */
export function publishRefusal(input: {
  readonly repository: string | undefined;
  readonly ref: string | undefined;
  readonly version: string;
  readonly tagAtCommit: boolean;
  readonly npmVersion: string;
}): string | undefined {
  if (input.repository !== publishRepository) {
    return `refused: stages only in ${publishRepository}, not in ${input.repository ?? 'an unknown repository'}`;
  }
  if (input.ref !== 'refs/heads/main') {
    return `refused: stages only from refs/heads/main, not from ${input.ref ?? 'an unknown ref'}`;
  }
  if (!input.tagAtCommit) return `refused: v${input.version} does not point at this commit`;
  if (!/^0\.\d+\.\d+$/.test(input.version) || input.version === '0.0.0') {
    return `refused: ${input.version} is not a 0.x release (beta policy)`;
  }
  if (!/^\d+\.\d+\.\d+$/.test(input.npmVersion.trim())) {
    return `refused: cannot read the npm version: ${input.npmVersion.trim() || 'no output'}`;
  }
  if (npmTooOld(input.npmVersion)) {
    return `refused: npm ${input.npmVersion} has no stage commands (11.15.0 or later)`;
  }
  return undefined;
}
