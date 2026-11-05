import type { LayoutWorkspace } from '../layout/layout-workspace.ts';
import { missingNamedTypes } from '../layout/missing-named-types.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';

/** Named types on exported module bases, module values, apps (section 13.11) and entities (section 4.2). */
export function checkNamedTypes(workspace: LayoutWorkspace): readonly DoctorFinding[] {
  const found: DoctorFinding[] = [];
  for (const module of workspace.modules) {
    const sources = [module.sources.get('base.ts'), module.entry].filter(
      (source) => source !== undefined,
    );
    for (const source of sources) {
      for (const finding of missingNamedTypes(source)) {
        found.push(findingOf('named-types', 'error', finding.path, finding.message, finding.fix));
      }
    }
    for (const [file, source] of module.sources) {
      if (!file.startsWith('entities/')) continue;
      for (const value of source.values) {
        if (value.call?.callee === 'defineEntity' && value.annotation !== 'named') {
          found.push(
            findingOf(
              'named-types',
              'warning',
              source.path,
              `${value.name} has no named type`,
              `export an interface extending EntityType<typeof ${value.name}Def> and annotate ${value.name} with it`,
            ),
          );
        }
      }
    }
  }
  for (const app of workspace.apps) {
    const source = app.sources.get('app.ts');
    if (source === undefined) continue;
    for (const finding of missingNamedTypes(source)) {
      found.push(findingOf('named-types', 'error', finding.path, finding.message, finding.fix));
    }
  }
  return found;
}
