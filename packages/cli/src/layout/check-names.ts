import { camelFromKebab, kebab } from '@keelwerk/core';
import { declaredDirectory } from './declared-directory.ts';
import { locateFile } from './file-location.ts';
import type { LayoutFinding } from './layout-finding.ts';
import type { LayoutWorkspace, ModuleRoot } from './layout-workspace.ts';
import { mainNameProblem } from './main-name-problem.ts';
import { moduleDirectories } from './module-directories.ts';
import { scopedDirectories } from './scoped-directories.ts';

const SCOPE_FILES = { contributions: 'contribution', conditional: 'condition' } as const;

function names(path: string, message: string, fix: string): LayoutFinding {
  return { kind: 'names', path, message, fix };
}

function fileFindings(module: ModuleRoot): readonly LayoutFinding[] {
  const findings: LayoutFinding[] = [];
  const id = module.id;
  for (const [file, source] of module.sources) {
    const path = `${module.sourceDir}/${file}`;
    const location = locateFile(file);
    const { scope, directory } = location;
    const exported = source.values.map((value) => value.name);
    if (location.folders.length === 0 && scope === undefined) {
      if (
        file === 'base.ts' &&
        id !== undefined &&
        !exported.includes(`${camelFromKebab(id)}Base`)
      ) {
        findings.push(
          names(
            path,
            `base.ts of ${id} must export ${camelFromKebab(id)}Base`,
            `rename the export to ${camelFromKebab(id)}Base`,
          ),
        );
      }
      if (file === 'config.ts' && !exported.includes('config')) {
        findings.push(names(path, 'config.ts must export config', 'rename the export to config'));
      }
      continue;
    }
    if (scope !== undefined && directory === undefined) {
      const wanted = camelFromKebab(scope.dir);
      if (location.name === SCOPE_FILES[scope.section] && !exported.includes(wanted)) {
        findings.push(
          names(
            path,
            `${scope.dir}/${location.name}.ts must export ${wanted}`,
            `rename the export to ${wanted}`,
          ),
        );
      }
      const call =
        source.values.find((value) => value.name === wanted)?.call ?? source.values[0]?.call;
      const declared = call === undefined ? undefined : declaredDirectory(call);
      if (declared !== undefined && declared !== scope.dir) {
        findings.push(
          names(
            path,
            `the declaration names ${declared}, but the directory is ${scope.dir}`,
            `rename the directory to ${declared} (and its migration track), or change the declaration`,
          ),
        );
      }
      continue;
    }
    const known = scope === undefined ? moduleDirectories : scopedDirectories;
    if (directory === undefined || !known.has(directory)) continue;
    const problem = mainNameProblem(source, location.name, directory);
    if (problem !== undefined) {
      findings.push(
        names(
          path,
          problem,
          'rename the file after its export (kebab-case), or the export after the file',
        ),
      );
    }
    if (directory === 'errors' && id !== undefined) {
      for (const value of source.values) {
        const code = value.call?.callee === 'defineError' ? value.call.args[0] : undefined;
        const wanted = `${id}.${kebab(value.name).replaceAll('-', '_')}`;
        if (code?.kind === 'string' && code.value !== wanted) {
          findings.push(
            names(
              path,
              `the error code is ${code.value}, the name gives ${wanted}`,
              `use the code '${wanted}'`,
            ),
          );
        }
      }
    }
  }
  return findings;
}

/** Fixture modules (S-13) carry migrations only where a test runs them, so a missing `migrations/` there is not drift. */
const FIXTURE_MODULE = /(^|\/)fixtures\/modules\//;

function trackFindings(module: ModuleRoot): readonly LayoutFinding[] {
  if (!module.hasMigrations && FIXTURE_MODULE.test(module.dir)) return [];
  const findings: LayoutFinding[] = [];
  const declared = new Set<string>();
  const adds = new Map<string, string>();
  for (const file of module.files) {
    const { scope, directory } = locateFile(file);
    if (scope === undefined || directory !== undefined) continue;
    declared.add(scope.dir);
    const text = module.sources.get(file)?.referenced;
    if (text?.has('fields') === true || text?.has('relations') === true) {
      adds.set(scope.dir, scope.section);
    }
  }
  for (const track of module.tracks) {
    if (track !== 'own' && !declared.has(track)) {
      findings.push(
        names(
          `${module.dir}/migrations/${track}`,
          `the migration track ${track} has no directory under src/contributions/ or src/conditional/`,
          `create src/contributions/${track}/ or src/conditional/${track}/ with its declaration, or remove the track`,
        ),
      );
    }
  }
  for (const [dir, section] of adds) {
    if (!module.tracks.includes(dir)) {
      findings.push(
        names(
          `${module.sourceDir}/${section}/${dir}`,
          `${dir} adds data but migrations/${dir}/ does not exist`,
          `run keelwerk db generate to create the track ${dir}`,
        ),
      );
    }
  }
  return findings;
}

/** Names (section 23.13): files named after their exports, assembly and role files named after their directory, error codes, declarations against directories, migration tracks and package names. */
export function checkNames(workspace: LayoutWorkspace): readonly LayoutFinding[] {
  const findings: LayoutFinding[] = [];
  for (const module of workspace.modules) {
    findings.push(...fileFindings(module), ...trackFindings(module));
    const owner = workspace.packages.find((candidate) => candidate.dir === module.dir);
    const name = owner?.manifest.name;
    if (
      module.id !== undefined &&
      typeof name === 'string' &&
      !new RegExp(`^(@[^/]+/)?module-${module.id}$`).test(name)
    ) {
      findings.push(
        names(
          `${module.dir}/package.json`,
          `the package is named ${name}, the module id is ${module.id}`,
          `name the package <scope>/module-${module.id}`,
        ),
      );
    }
  }
  return findings;
}
