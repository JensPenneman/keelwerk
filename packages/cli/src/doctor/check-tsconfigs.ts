import { join } from 'node:path';
import type { LayoutWorkspace } from '../layout/layout-workspace.ts';
import { baseOptions } from './base-options.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { effectiveOptions } from './effective-options.ts';
import { extendsBase } from './extends-base.ts';
import { findingOf } from './finding-of.ts';
import { inProjectScope } from './project-package-scope.ts';

const SOURCE = '@keelwerk/source';
/** The base options a test configuration turns off on purpose (it emits nothing). */
const TEST_OVERRIDES: ReadonlySet<string> = new Set([
  'composite',
  'rewriteRelativeImportExtensions',
]);

function lists(value: unknown, wanted: string): boolean {
  return Array.isArray(value) && value.includes(wanted);
}

/**
 * Every `tsconfig.json` of the project (section 13.3): the base options, an explicit `rootDir`,
 * `customConditions` with the source condition, and `isolatedDeclarations` only in a package that
 * exports no DSL values (a module or an app).
 */
export async function checkTsconfigs(
  workspace: LayoutWorkspace,
): Promise<readonly DoctorFinding[]> {
  const found: DoctorFinding[] = [];
  const check = 'tsconfig';
  const base = await effectiveOptions(join(workspace.root, 'tsconfig.base.json'));
  if (base === undefined) {
    found.push(
      findingOf(
        check,
        'error',
        'tsconfig.base.json',
        'the workspace has no tsconfig.base.json',
        'add the shared options of section 13.3',
      ),
    );
  } else {
    for (const [option, wanted] of Object.entries(baseOptions)) {
      if (base[option] !== wanted) {
        found.push(
          findingOf(
            check,
            'error',
            'tsconfig.base.json',
            `${option} is ${JSON.stringify(base[option])}, section 13.3 sets ${JSON.stringify(wanted)}`,
            `set ${option} to ${JSON.stringify(wanted)}`,
          ),
        );
      }
    }
    if (!lists(base.customConditions, SOURCE)) {
      found.push(
        findingOf(
          check,
          'error',
          'tsconfig.base.json',
          `customConditions lacks ${SOURCE}`,
          `add ${SOURCE} to customConditions`,
        ),
      );
    }
  }
  const dsl = new Set([...workspace.modules, ...workspace.apps].map((root) => root.dir));
  for (const file of workspace.files.filter((candidate) =>
    /(^|\/)tsconfig(\.test)?\.json$/.test(candidate),
  )) {
    const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
    if (!inProjectScope(dir)) continue;
    const options = await effectiveOptions(join(workspace.root, file));
    if (options === undefined) continue;
    if (!(await extendsBase(join(workspace.root, file)))) {
      found.push(
        findingOf(
          check,
          'error',
          file,
          'the configuration does not extend tsconfig.base.json',
          'extend the workspace tsconfig.base.json (section 13.3)',
        ),
      );
    }
    const test = file.endsWith('tsconfig.test.json');
    for (const [option, wanted] of Object.entries(baseOptions)) {
      if (test && TEST_OVERRIDES.has(option)) continue;
      if (options[option] !== wanted) {
        found.push(
          findingOf(
            check,
            'error',
            file,
            `${option} is ${JSON.stringify(options[option])}, section 13.3 sets ${JSON.stringify(wanted)}`,
            `remove the override, or set ${option} to ${JSON.stringify(wanted)}`,
          ),
        );
      }
    }
    if (options.rootDir === undefined) {
      found.push(
        findingOf(
          check,
          'error',
          file,
          'rootDir is not set (TypeScript 6 and 7 report TS5011 when the common source directory differs)',
          'set rootDir explicitly ("src" for a library, "." for a module package)',
        ),
      );
    }
    if (!lists(options.customConditions, SOURCE)) {
      found.push(
        findingOf(
          check,
          'error',
          file,
          `customConditions lacks ${SOURCE}`,
          'extend tsconfig.base.json',
        ),
      );
    }
    if (options.isolatedDeclarations === true && dsl.has(dir)) {
      found.push(
        findingOf(
          check,
          'error',
          file,
          'isolatedDeclarations is on in a package that exports DSL values (TS9010 and TS9013)',
          'remove isolatedDeclarations here; it only works where exports are explicitly typed',
        ),
      );
    }
  }
  return found;
}
