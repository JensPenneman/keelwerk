import type { GeneratedOptions } from '../dsl/define-entity.ts';
import type { GeneratorTemplate } from '../model/generator-template.ts';
import type { GeneratedActionKind } from './generated-action-kind.ts';

/** The generated actions in the order the registry lists them. */
const order: readonly GeneratedActionKind[] = [
  'get',
  'query',
  'changes',
  'queryChanges',
  'create',
  'update',
  'archive',
  'restore',
  'set',
  'watch',
  'history',
];

const setOperations: ReadonlySet<GeneratedActionKind> = new Set([
  'set',
  'create',
  'update',
  'archive',
  'restore',
]);

function baseKinds(history: GeneratedSource['history']): ReadonlySet<GeneratedActionKind> {
  if (history === 'external') return new Set(['get', 'query']);
  if (history === 'projection') return new Set(['get', 'query', 'changes', 'queryChanges']);
  return new Set(['get', 'query', 'changes', 'queryChanges', ...setOperations]);
}

/** The parts of an entity definition that decide which actions the core generates. */
export interface GeneratedSource {
  readonly history: 'chain' | 'state' | 'projection' | 'external';
  readonly generated: GeneratedOptions;
}

/**
 * The generated actions of an entity (section 6.7): by history mode, minus what `generated`
 * switches off (`set: false` removes the set operations together), plus `history` when opted in
 * and the templates the selected modules fill; `external` entities have only `get` and `query`.
 */
export function generatedActionsOf(
  entity: GeneratedSource,
  generators: readonly GeneratorTemplate[],
): readonly GeneratedActionKind[] {
  const kinds = new Set(baseKinds(entity.history));
  if (entity.generated.history === true) kinds.add('history');
  if (entity.history !== 'external') {
    for (const generator of generators) kinds.add(generator);
  }
  for (const [name, value] of Object.entries(entity.generated)) {
    if (value !== false) continue;
    if (name === 'set') {
      for (const operation of setOperations) kinds.delete(operation);
    } else {
      kinds.delete(name as GeneratedActionKind);
    }
  }
  return order.filter((kind) => kinds.has(kind));
}
