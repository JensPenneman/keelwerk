import { camelFromKebab, kebab } from '@keelwerk/core';
import { coreModuleDirectory } from './core-module-directory.ts';
import { defineDirectories } from './define-directories.ts';
import { locateFile } from './file-location.ts';
import type { LayoutFinding } from './layout-finding.ts';
import type { ModuleRoot } from './layout-workspace.ts';
import { moduleDirectories } from './module-directories.ts';
import { moduleRootFiles } from './module-root-files.ts';
import type { CallFacts } from './parsed-source.ts';
import { partCallees } from './part-callees.ts';
import { scopedDirectories } from './scoped-directories.ts';

const SCOPE_FILES = { contributions: 'contribution.ts', conditional: 'condition.ts' } as const;

function placed(
  module: ModuleRoot,
  path: string,
  location: ReturnType<typeof locateFile>,
): string | undefined {
  const { scope, directory } = location;
  const where = `${module.sourceDir}/${path}`;
  if (scope !== undefined) {
    if (directory === undefined) {
      return `${location.name}.ts` === SCOPE_FILES[scope.section]
        ? undefined
        : `${where} sits directly in ${scope.section}/${scope.dir}/, which holds only ${SCOPE_FILES[scope.section]}`;
    }
    return scopedDirectories.has(directory)
      ? undefined
      : `${where} is in ${directory}/ inside ${scope.section}/${scope.dir}/, which holds only actions, fills, policies and reactions`;
  }
  if (directory === undefined) {
    return module.sourceDir === coreModuleDirectory || moduleRootFiles.has(`${location.name}.ts`)
      ? undefined
      : `${where} is a file no convention places directly in src/`;
  }
  return moduleDirectories.has(directory)
    ? undefined
    : `${where} is in src/${directory}/, which is not a directory of the module layout`;
}

function targetOf(call: CallFacts): string | undefined {
  const second = call.args[1];
  if (second?.kind === 'identifier') return second.name;
  return second?.kind === 'string' ? second.value : undefined;
}

function partProblems(
  call: CallFacts,
  location: ReturnType<typeof locateFile>,
): readonly { message: string; fix: string }[] {
  const problems: { message: string; fix: string }[] = [];
  const { scope, owner, directory } = location;
  const first = call.args[0];
  if (scope !== undefined) {
    const declaration = camelFromKebab(scope.dir);
    if (first?.kind !== 'within') {
      problems.push({
        message: `${call.callee} in ${scope.section}/${scope.dir}/ is built against the base alone`,
        fix: `write within(<base>, ${declaration}) as its first argument`,
      });
    } else if (first.declaration !== declaration) {
      problems.push({
        message: `${call.callee} is built for ${first.declaration} but sits in ${scope.section}/${scope.dir}/`,
        fix: `move it to the directory of ${first.declaration}, or build it with within(<base>, ${declaration})`,
      });
    }
  } else if (first?.kind === 'within') {
    problems.push({
      message: `${call.callee} is built for ${first.declaration} but sits outside every contribution and condition`,
      fix: `move it to the contributions/ or conditional/ directory of ${first.declaration}`,
    });
  }
  const target = targetOf(call);
  const entityPart = directory === 'actions' || directory === 'policies';
  if (entityPart && owner !== undefined && target !== camelFromKebab(owner)) {
    problems.push({
      message: `${call.callee} in ${directory}/${owner}/ is built for ${target ?? 'no target'}`,
      fix:
        target === undefined
          ? `move it up to ${directory}/`
          : `move it to ${directory}/${kebab(target)}/`,
    });
  } else if (
    entityPart &&
    owner === undefined &&
    target !== undefined &&
    call.callee !== 'defineRule'
  ) {
    problems.push({
      message: `${call.callee} is built for ${target} but sits directly in ${directory}/`,
      fix: `move it into ${directory}/${kebab(target)}/`,
    });
  }
  return problems;
}

/** Placement (section 23.13): a file outside its kind's directory, an unknown directory, a part built for another contribution, condition or target than its directory. */
export function checkPlacement(modules: readonly ModuleRoot[]): readonly LayoutFinding[] {
  const findings: LayoutFinding[] = [];
  for (const module of modules) {
    for (const file of module.files) {
      if (!file.endsWith('.ts') || /\.(test|test-d|d)\.ts$/.test(file)) continue;
      const location = locateFile(file);
      const path = `${module.sourceDir}/${file}`;
      const problem = placed(module, file, location);
      if (problem !== undefined) {
        findings.push({
          kind: 'placement',
          path,
          message: problem,
          fix: 'move the file into a directory of the module layout (section 23.2)',
        });
        continue;
      }
      const source = module.sources.get(file);
      for (const value of source?.values ?? []) {
        const call = value.call;
        const expected = call === undefined ? undefined : defineDirectories.get(call.callee);
        if (call === undefined || expected === undefined) continue;
        const actual = location.directory ?? `${location.name}.ts`;
        if (actual !== expected) {
          const target = expected.endsWith('.ts')
            ? `the ${expected} of its directory`
            : `src/${expected}/${location.name}.ts`;
          findings.push({
            kind: 'placement',
            path,
            message: `${call.callee} belongs in ${expected.endsWith('.ts') ? expected : `${expected}/`}, not in ${location.directory === undefined ? actual : `${actual}/`}`,
            fix: `move ${value.name} to ${target}`,
          });
          continue;
        }
        if (partCallees.has(call.callee)) {
          for (const issue of partProblems(call, location)) {
            findings.push({ kind: 'placement', path, ...issue });
          }
        }
      }
    }
  }
  return findings;
}
