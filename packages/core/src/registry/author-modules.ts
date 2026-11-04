import type { AppSelection } from './app-selection.ts';
import type { RuntimeModule } from './runtime-module.ts';

/** The modules the author listed: the selection without the implicit core, which `defineApp` puts first. */
export function authorModules(selection: AppSelection): readonly RuntimeModule[] {
  const [first, ...rest] = selection.modules;
  return first?.id === 'core' ? rest : selection.modules;
}
