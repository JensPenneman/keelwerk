import { describe, expect, test } from 'vitest';
import { checkSelection } from './check-selection.ts';
import { defaultSelectionLimits } from './default-selection-limits.ts';
import type { SelectionMeasure, SelectionPath } from './selection-measure.ts';

function leaf(field: string, ...entities: string[]): SelectionPath {
  return { entities, field };
}

function measure(overrides: Partial<SelectionMeasure> = {}): SelectionMeasure {
  return { paths: [], aliases: 0, operations: 1, tokens: 0, connectionPages: 0, ...overrides };
}

function refs(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `e${index}`);
}

function messageOf(selection: SelectionMeasure): string | undefined {
  return checkSelection(selection, defaultSelectionLimits)?.message;
}

describe('checkSelection', () => {
  test('defaultSelectionLimits are those of 16.6.6', () => {
    expect(defaultSelectionLimits).toEqual({
      noRepeatedEntity: true,
      depth: 12,
      aliases: 30,
      operations: 20,
      tokens: 5000,
      cost: 1000,
    });
    expect(Object.isFrozen(defaultSelectionLimits)).toBe(true);
  });

  test('passes the empty selection', () => {
    expect(checkSelection(measure(), defaultSelectionLimits)).toBeNull();
  });

  test('allows siblings of one entity type at one level', () => {
    const selection = measure({
      paths: [
        leaf('name', 'project', 'deployment', 'node'),
        leaf('name', 'project', 'preview', 'node'),
      ],
    });
    expect(checkSelection(selection, defaultSelectionLimits)).toBeNull();
  });

  test('refuses a path that repeats an entity type, naming the path', () => {
    const path = leaf('name', 'project', 'deployment', 'project');
    const error = checkSelection(measure({ paths: [path] }), defaultSelectionLimits);
    expect(error?.kind).toBe('validation');
    expect(error?.code).toBe('core.validation');
    expect(error?.message).toContain('noRepeatedEntity');
    expect(error?.message).toContain('project > deployment > project > name');
    expect(error?.issues?.[0]?.path).toEqual(['project', 'deployment', 'project', 'name']);
  });

  test('allows the repeat when noRepeatedEntity is false', () => {
    const selection = measure({ paths: [leaf('name', 'project', 'deployment', 'project')] });
    expect(
      checkSelection(selection, { ...defaultSelectionLimits, noRepeatedEntity: false }),
    ).toBeNull();
  });

  test('refuses a path deeper than the depth limit', () => {
    const refused = checkSelection(
      measure({ paths: [leaf('name', ...refs(13))] }),
      defaultSelectionLimits,
    );
    expect(refused?.message).toContain('depth limit is 12');
    expect(refused?.issues?.[0]?.path).toEqual([...refs(13), 'name']);
    expect(
      checkSelection(measure({ paths: [leaf('name', ...refs(12))] }), defaultSelectionLimits),
    ).toBeNull();
  });

  test('refuses more aliases than the limit', () => {
    const refused = checkSelection(measure({ aliases: 31 }), defaultSelectionLimits);
    expect(refused?.message).toBe('The selection has 31 aliases; the alias limit is 30.');
    expect(refused?.issues?.[0]?.path).toEqual([]);
    expect(checkSelection(measure({ aliases: 30 }), defaultSelectionLimits)).toBeNull();
  });

  test('refuses more operations than the limit', () => {
    expect(messageOf(measure({ operations: 21 }))).toBe(
      'The selection has 21 operations; the operation limit is 20.',
    );
    expect(messageOf(measure({ operations: 20 }))).toBeUndefined();
  });

  test('refuses more tokens than the limit', () => {
    expect(messageOf(measure({ tokens: 5001 }))).toBe(
      'The selection has 5001 tokens; the token limit is 5000.',
    );
    expect(messageOf(measure({ tokens: 5000 }))).toBeUndefined();
  });

  test('costs 1 per field and 10 per connection page', () => {
    const leaves = (count: number): SelectionPath[] =>
      Array.from({ length: count }, (_, index) => leaf(`f${index}`, 'project'));
    expect(messageOf(measure({ paths: leaves(991), connectionPages: 1 }))).toBe(
      'The selection costs 1001; the cost limit is 1000 (1 per field, 10 per connection page).',
    );
    expect(messageOf(measure({ paths: leaves(990), connectionPages: 1 }))).toBeUndefined();
  });

  test('checks the repeat first, then depth, aliases, operations, tokens and cost', () => {
    const everything = measure({
      paths: [
        ...Array.from({ length: 1000 }, (_, index) => leaf(`f${index}`, 'project')),
        leaf('name', ...refs(13)),
        leaf('name', 'project', 'deployment', 'project'),
      ],
      aliases: 31,
      operations: 21,
      tokens: 5001,
      connectionPages: 1,
    });
    expect(messageOf(everything)).toContain('noRepeatedEntity');
    const withoutRepeat = { ...everything, paths: everything.paths.slice(0, -1) };
    expect(messageOf(withoutRepeat)).toContain('depth limit');
    const withoutDeep = measure({ ...everything, paths: [...everything.paths.slice(0, -2)] });
    expect(messageOf(withoutDeep)).toContain('alias limit');
    expect(messageOf({ ...withoutDeep, aliases: 0 })).toContain('operation limit');
    expect(messageOf({ ...withoutDeep, aliases: 0, operations: 1 })).toContain('token limit');
    expect(messageOf({ ...withoutDeep, aliases: 0, operations: 1, tokens: 0 })).toContain(
      'cost limit',
    );
  });
});
