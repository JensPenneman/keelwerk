import type { DoctorFinding } from './doctor-finding.ts';
import type { EnvironmentFacts } from './environment-facts.ts';
import { findingOf } from './finding-of.ts';
import { majorOf } from './major-of.ts';

/**
 * The environment (section 13.12, S-01): Node 26 or later, TypeScript 7 for builds and 6.0 where
 * the layout pass and attest run, the pnpm version the root pins and the Biome version the preset
 * expects. The packages declare no `engines` field in M1, so this check is where Node is enforced.
 */
export function checkEnvironment(facts: EnvironmentFacts): readonly DoctorFinding[] {
  const found: DoctorFinding[] = [];
  const check = 'environment';
  if (majorOf(facts.node) < 26) {
    found.push(
      findingOf(
        check,
        'error',
        'node',
        `Node ${facts.node} is older than the baseline, Node 26`,
        'install Node 26 or later (fnm install --lts)',
      ),
    );
  }
  if (facts.typescript === undefined) {
    found.push(
      findingOf(
        check,
        'error',
        'typescript',
        'TypeScript is not installed at the workspace root',
        'run pnpm install',
      ),
    );
  } else if (majorOf(facts.typescript) !== 7) {
    found.push(
      findingOf(
        check,
        'warning',
        'typescript',
        `builds use TypeScript ${facts.typescript}, the baseline is 7.0`,
        'pin typescript 7.0.x at the workspace root',
      ),
    );
  }
  if (facts.typescriptSix === undefined || !facts.typescriptSix.startsWith('6.0.')) {
    found.push(
      findingOf(
        check,
        'warning',
        'typescript-6',
        `the layout pass expects TypeScript 6.0, found ${facts.typescriptSix ?? 'none'}`,
        'depend on typescript-6 as npm:typescript@6.0.3',
      ),
    );
  }
  if (facts.pnpm === undefined) {
    found.push(
      findingOf(
        check,
        'error',
        'pnpm',
        'pnpm was not found on the path',
        'enable corepack or install pnpm',
      ),
    );
  } else if (facts.pnpmWanted !== undefined && facts.pnpm !== facts.pnpmWanted) {
    found.push(
      findingOf(
        check,
        'warning',
        'pnpm',
        `pnpm ${facts.pnpm} is installed, the workspace pins ${facts.pnpmWanted}`,
        `install pnpm ${facts.pnpmWanted}`,
      ),
    );
  }
  if (facts.biome === undefined) {
    found.push(
      findingOf(
        check,
        'error',
        'biome',
        'Biome is not installed at the workspace root',
        'run pnpm install',
      ),
    );
  } else if (facts.biomeWanted !== undefined && facts.biome !== facts.biomeWanted) {
    found.push(
      findingOf(
        check,
        'warning',
        'biome',
        `Biome ${facts.biome} is installed, the preset expects ${facts.biomeWanted}`,
        'run pnpm install',
      ),
    );
  }
  return found;
}
