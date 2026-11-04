import type { AppSelection } from './app-selection.ts';
import { isPresent } from './is-present.ts';
import type { RuntimeModule } from './runtime-module.ts';

/** The modules one module must come after: its present `requires` and `optional`, and providers of its contracts. */
function predecessors(selection: AppSelection, module: RuntimeModule): ReadonlySet<RuntimeModule> {
  const result = new Set<RuntimeModule>();
  for (const dependency of [...module.requires, ...module.optional]) {
    if (!isPresent(selection, dependency)) continue;
    if (dependency.kind === 'module') {
      const found = selection.byId.get(dependency.id);
      if (found !== undefined) result.add(found);
    } else {
      for (const other of selection.modules) {
        if (other.provides.some((contract) => contract.contract === dependency.contract)) {
          result.add(other);
        }
      }
    }
  }
  result.delete(module);
  return result;
}

/** The modules in topological order and the ids that could not be placed. */
export interface ModuleOrder {
  readonly ordered: readonly RuntimeModule[];
  /** Modules on a dependency cycle, in tuple order; they are appended last. */
  readonly cyclic: readonly string[];
}

/**
 * Orders the modules by `requires` (and present `optional`) with tuple order as the tie-break
 * (section 3.3): the first module in tuple order whose predecessors are all placed goes next.
 */
export function orderModules(selection: AppSelection): ModuleOrder {
  const waiting = [...selection.modules];
  const before = new Map(waiting.map((module) => [module, predecessors(selection, module)]));
  const placed = new Set<RuntimeModule>();
  const ordered: RuntimeModule[] = [];
  while (waiting.length > 0) {
    const index = waiting.findIndex((module) =>
      [...(before.get(module) ?? [])].every((other) => placed.has(other)),
    );
    if (index < 0) {
      break;
    }
    const [next] = waiting.splice(index, 1);
    if (next !== undefined) {
      placed.add(next);
      ordered.push(next);
    }
  }
  return { ordered: [...ordered, ...waiting], cyclic: waiting.map((module) => module.id) };
}
