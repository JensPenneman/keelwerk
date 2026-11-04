import type { Dependency } from '../model/any-module.ts';

/** The name a dependency goes by in messages: a module id or a contract name. */
export function dependencyName(dependency: Dependency): string {
  return dependency.kind === 'module' ? dependency.id : dependency.contract;
}
