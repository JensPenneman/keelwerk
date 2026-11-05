import type { LayoutFinding } from './layout-finding.ts';
import type { ParsedSource } from './parsed-source.ts';

const DEFINERS: ReadonlySet<string> = new Set(['defineApp', 'defineModule', 'defineModuleBase']);

/**
 * The exported module bases, module values and apps of `source` that carry no named type
 * (sections 4.1 and 13.11): an inferred type, or a bare `typeof`, makes declaration emit copy
 * every dependency's structure into each dependant.
 */
export function missingNamedTypes(source: ParsedSource): readonly LayoutFinding[] {
  return source.values
    .filter((value) => value.call !== undefined && DEFINERS.has(value.call.callee))
    .filter((value) => value.annotation !== 'named')
    .map((value) => ({
      kind: 'packages' as const,
      path: source.path,
      message: `${value.name} is the value of ${value.call?.callee ?? 'a definition'} and has no named type`,
      fix: `export an interface for it (export interface ${value.name.charAt(0).toUpperCase()}${value.name.slice(1)} extends ModuleType<typeof ${value.name}Def> {}) and annotate ${value.name} with it`,
    }));
}
