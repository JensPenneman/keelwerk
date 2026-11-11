import type { ActionEntry } from '../registry/action-entry.ts';

const none: readonly (readonly string[])[] = [];
const root: readonly (readonly string[])[] = [[]];

function generatedPositions(action: ActionEntry): Omit<EntityPositions, 'entity'> | undefined {
  const empty = { inputRows: none, outputRows: none, selections: none, sorts: none, filters: none };
  switch (action.generated) {
    case 'create':
      return { ...empty, inputRows: root, outputRows: root };
    case 'update':
      return { ...empty, inputRows: [['patch']], outputRows: root };
    case 'archive':
    case 'restore':
      return { ...empty, outputRows: root };
    case 'set':
      return {
        ...empty,
        inputRows: [
          ['create', '*'],
          ['update', '*', 'patch'],
        ],
      };
    case 'get':
      return { ...empty, outputRows: [['list', '*']], selections: [['properties']] };
    case 'query':
      return {
        ...empty,
        outputRows: [['items', '*']],
        selections: [['properties']],
        sorts: [['sort']],
        filters: [['filter']],
      };
    case 'queryChanges':
      return { ...empty, sorts: [['sort']], filters: [['filter']] };
    case 'history':
      return { ...empty, outputRows: [['entries', '*', 'changes']] };
    case 'watch':
      // The hub puts the row under `event.row`, and the subscriber's `fields` select its members.
      return { ...empty, outputRows: [['row']], selections: [['fields']], filters: [['filter']] };
    case 'changes':
    case undefined:
      return undefined;
  }
}

/** Where one entity's field names appear in an action (section 18.2); `'*'` steps into every array item. */
export interface EntityPositions {
  readonly entity: string;
  /** Paths to objects whose member names are the entity's fields. */
  readonly inputRows: readonly (readonly string[])[];
  readonly outputRows: readonly (readonly string[])[];
  /** Paths to arrays of field names (selections). */
  readonly selections: readonly (readonly string[])[];
  /** Paths to arrays of `{ field, direction? }`. */
  readonly sorts: readonly (readonly string[])[];
  /** Paths to conditions in object form (section 16.4.4). */
  readonly filters: readonly (readonly string[])[];
}

/**
 * Where the field names of one entity appear in an action, or undefined when none does. A generated
 * action follows the table of its kind; a declared action takes its input as one row of the entity
 * it is mounted on and its output rows from `entityOutput` (a row at the root, a page under
 * `items`). A declared action mounted on one entity whose output carries the rows of another has
 * the output's entity only: plain action shapes change through custom transforms.
 */
export function entityPositions(action: ActionEntry): EntityPositions | undefined {
  if (action.generated !== undefined) {
    if (action.entity === undefined) return undefined;
    const found = generatedPositions(action);
    return found === undefined ? undefined : { entity: action.entity, ...found };
  }
  const output = action.entityOutput;
  const entity = output?.entity ?? action.entity;
  if (entity === undefined) return undefined;
  return {
    entity,
    inputRows: action.entity === entity ? root : none,
    outputRows: output === undefined ? none : output.shape === 'row' ? root : [['items', '*']],
    selections: none,
    sorts: none,
    filters: none,
  };
}
