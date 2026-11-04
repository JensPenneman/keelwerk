import type { Dependency } from '../model/any-module.ts';
import type { AppSelection } from './app-selection.ts';

/** Whether a module is selected, or an app-level contract is provided; deployment contracts are not the app's to judge. */
export function isPresent(selection: AppSelection, dependency: Dependency): boolean {
  if (dependency.kind === 'module') return selection.byId.has(dependency.id);
  return dependency.level === 'deployment' || selection.provided.has(dependency.contract);
}
