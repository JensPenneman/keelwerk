import type { Dependency } from '../model/any-module.ts';
import type { AppSelection } from './app-selection.ts';
import { isPresent } from './is-present.ts';

/** Whether every dependency of a list is present. */
export function allPresent(selection: AppSelection, dependencies: readonly Dependency[]): boolean {
  return dependencies.every((dependency) => isPresent(selection, dependency));
}
