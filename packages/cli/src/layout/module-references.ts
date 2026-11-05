import type { ModuleRoot } from './layout-workspace.ts';
import type { ParsedSource } from './parsed-source.ts';

function namedBy(source: ParsedSource): readonly string[] {
  const names: string[] = [];
  for (const value of source.values) {
    const call = value.call;
    if (call === undefined) continue;
    for (const arg of call.args) {
      if (call.callee === 'defineModuleBase' && arg.kind === 'object') {
        names.push(
          ...(arg.facts.names.get('requires') ?? []),
          ...(arg.facts.names.get('optional') ?? []),
        );
      }
      if (call.callee === 'defineContribution') {
        if (arg.kind === 'identifier') names.push(arg.name);
        if (arg.kind === 'object') names.push(...(arg.facts.names.get('when') ?? []));
      }
      if (call.callee === 'defineCondition' && arg.kind === 'list') names.push(...arg.names);
    }
  }
  return names.filter((name) => !name.includes('.'));
}

/** A module another module's base, contribution or condition names, with the import it comes from. */
export interface ModuleReference {
  readonly name: string;
  readonly specifier: string;
  /** The file that names it, relative to the workspace root. */
  readonly path: string;
}

/** The modules a module's base, contribution and condition files name in `requires`, `optional`, a target or a `when` list. */
export function moduleReferences(module: ModuleRoot): readonly ModuleReference[] {
  const found: ModuleReference[] = [];
  for (const source of module.sources.values()) {
    for (const name of namedBy(source)) {
      const specifier = source.imports.get(name);
      if (specifier !== undefined) found.push({ name, specifier, path: source.path });
    }
  }
  return found;
}
