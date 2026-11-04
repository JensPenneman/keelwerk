import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseExtendedDiagnostics } from './parse-extended-diagnostics.ts';
import { runTsc } from './run-tsc.ts';

/**
 * Instantiations of a program made of `include` (paths relative to the repository), no emit. The
 * workspace packages resolve to their declarations, as in a package build, so the count follows
 * the app and its modules and not the growth of the core's own sources; build them first.
 */
export function measureProgram(repo: string, include: readonly string[], scratch: string): number {
  const directory = join(scratch, 'program');
  mkdirSync(directory, { recursive: true });
  const config = join(directory, 'tsconfig.json');
  writeFileSync(
    config,
    JSON.stringify({
      extends: join(repo, 'tsconfig.base.json'),
      compilerOptions: {
        composite: false,
        declaration: false,
        declarationMap: false,
        sourceMap: false,
        customConditions: [],
        noEmit: true,
        rootDir: repo,
        typeRoots: [join(repo, 'node_modules', '@types')],
      },
      files: include.map((path) => join(repo, path)),
    }),
  );
  const output = runTsc(repo, ['-p', config, '--extendedDiagnostics'], repo);
  const parsed = parseExtendedDiagnostics(output);
  if (parsed.errors.length > 0) {
    throw new Error(
      `${include.map((path) => relative(repo, join(repo, path))).join(', ')} does not compile:\n${parsed.errors.join('\n')}`,
    );
  }
  return parsed.instantiations;
}
