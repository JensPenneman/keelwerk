import type { AppSelection } from './app-selection.ts';
import type { ComposableApp } from './composable-app.ts';
import { runtimeModule } from './runtime-module.ts';

/** Indexes the modules of an app by id and collects the contracts they provide. */
export function selectModules(app: ComposableApp): AppSelection {
  const modules = app.modules.map(runtimeModule);
  const byId = new Map<string, (typeof modules)[number]>();
  const provided = new Set<string>();
  for (const module of modules) {
    if (!byId.has(module.id)) byId.set(module.id, module);
    for (const contract of module.provides) provided.add(contract.contract);
  }
  return { modules, byId, provided };
}
