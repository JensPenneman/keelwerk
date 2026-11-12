import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { checkDeclarationSizes } from './check-declaration-sizes.ts';
import { checkEmitErrors } from './check-emit-errors.ts';
import type { SyntheticMeasurement } from './evaluate-budgets.ts';
import { generateSyntheticApps } from './generate-synthetic-apps.ts';
import { parseExtendedDiagnostics } from './parse-extended-diagnostics.ts';
import { portabilityCodes } from './portability-codes.ts';
import { runTsc } from './run-tsc.ts';
import type { SyntheticOptions } from './synthetic-options.ts';
import { throwOnCompileErrors } from './throw-on-compile-errors.ts';

interface Raw {
  readonly fold: number;
  readonly wholeProgram: number;
  readonly sizes: SyntheticMeasurement['sizes'];
  readonly portability: readonly string[];
}

function measureRaw(
  root: string,
  modules: number,
  repo: string,
  options: SyntheticOptions = {},
): Raw {
  generateSyntheticApps(root, modules, repo, options);
  const label = `synthetic workspace of ${modules} modules${options.live === true ? ' with live' : ''}`;
  const wholeOutput = runTsc(repo, ['-p', 'tsconfig.mono.json', '--extendedDiagnostics'], root);
  throwOnCompileErrors(`${label}, whole program`, wholeOutput, []);
  const whole = parseExtendedDiagnostics(wholeOutput);
  const build = runTsc(repo, ['-b', 'tsconfig.json'], root);
  throwOnCompileErrors(`${label}, tsc -b`, build, portabilityCodes);
  // The app's own build info would let the second run skip the check.
  rmSync(join(root, 'app', 'tsconfig.tsbuildinfo'), { force: true });
  const foldOutput = runTsc(
    repo,
    ['-p', join('app', 'tsconfig.json'), '--extendedDiagnostics'],
    root,
  );
  throwOnCompileErrors(`${label}, fold`, foldOutput, []);
  const fold = parseExtendedDiagnostics(foldOutput);
  const sizes = Array.from({ length: modules }, (_, index) => {
    const name = `m${String(index + 1).padStart(2, '0')}`;
    return checkDeclarationSizes(name, join(root, 'packages', name, 'dist'));
  });
  return {
    fold: fold.instantiations,
    wholeProgram: whole.instantiations,
    sizes,
    portability: checkEmitErrors(build),
  };
}

/**
 * Measures the synthetic workspaces at each module count, with the empty workspace's counts
 * (the core alone) subtracted, as the spike did, so the figures compare with its budgets. With
 * `options.live` the app composes the real live module, and the empty workspace it is compared
 * with is still the core alone, so the figures include the live module's own types and the
 * generated `watch` of every entity (13.11).
 */
export function measureInstantiations(
  counts: readonly number[],
  repo: string,
  scratch: string,
  options: SyntheticOptions = {},
): readonly SyntheticMeasurement[] {
  const suffix = options.live === true ? '-live' : '';
  // The empty workspace is the core alone in both cases: a live row's figure includes the live module's own types.
  const base = measureRaw(join(scratch, 'synthetic-0'), 0, repo);
  return counts.map((modules) => {
    const raw = measureRaw(join(scratch, `synthetic-${modules}${suffix}`), modules, repo, options);
    return {
      modules,
      ...(options.live === true ? { live: true as const } : {}),
      fold: raw.fold - base.fold,
      wholeProgram: raw.wholeProgram - base.wholeProgram,
      sizes: raw.sizes,
      portability: raw.portability,
    };
  });
}
