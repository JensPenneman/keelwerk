import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import type { ActionEntry } from './action-entry.ts';
import { checkPersonalInputOutsideTenant } from './check-personal-input-outside-tenant.ts';
import type { EntityEntry } from './entity-entry.ts';
import type { StreamEntry } from './stream-entry.ts';

const personalInput = shape({
  userId: field.subject(),
  address: field.string().personal({ subject: 'userId' }),
});
const plainInput = shape({ userId: field.subject(), address: field.string() });

function action(
  ref: string,
  scope: ActionEntry['scope'],
  execution: ActionEntry['execution'],
  input: StandardSchemaV1 = personalInput,
  kind: ActionEntry['kind'] = 'command',
): readonly [string, ActionEntry] {
  return [ref, { ref, module: 'm', kind, scope, execution, input } as unknown as ActionEntry];
}

function stream(
  ref: string,
  readAs: string,
  record: StandardSchemaV1 = personalInput,
): readonly [string, StreamEntry] {
  return [ref, { ref, module: 'm', readAs, record } as unknown as StreamEntry];
}

const entities = (tenancy: string): ReadonlyMap<string, EntityEntry> =>
  new Map([['m.row', { ref: 'm.row', descriptor: { tenancy } } as unknown as EntityEntry]]);

describe('checkPersonalInputOutsideTenant (14.7.5, D9)', () => {
  test('a tenant command may take a personal member, async or not', () => {
    const actions = new Map([action('m.a', 'tenant', 'async'), action('m.b', 'tenant', 'either')]);
    expect(checkPersonalInputOutsideTenant(actions, new Map(), entities('tenant'))).toEqual([]);
  });

  test('a backend, deployment or invocation command that runs asynchronously is refused', () => {
    for (const scope of ['backend', 'deployment', 'invocation'] as const) {
      for (const execution of ['async', 'either'] as const) {
        const [problem, ...more] = checkPersonalInputOutsideTenant(
          new Map([action('m.a', scope, execution)]),
          new Map(),
          entities('tenant'),
        );
        expect(more).toEqual([]);
        expect(problem).toMatchObject({
          code: 'personalOutsideTenant',
          severity: 'error',
          module: 'm',
          ref: 'm.a',
        });
      }
    }
  });

  test('the input of a synchronous command is not stored and is not refused, nor is a plain one', () => {
    const actions = new Map([
      action('m.sync', 'backend', 'sync'),
      action('m.plain', 'backend', 'async', plainInput),
      action('m.query', 'backend', 'async', personalInput, 'query'),
    ]);
    expect(checkPersonalInputOutsideTenant(actions, new Map(), entities('tenant'))).toEqual([]);
  });

  test('a stream of a row that is not a tenant row may not hold a personal record member', () => {
    const streams = new Map([stream('m.log', 'm.row')]);
    expect(checkPersonalInputOutsideTenant(new Map(), streams, entities('tenant'))).toEqual([]);
    for (const tenancy of ['backend', 'deployment', 'invocation']) {
      expect(checkPersonalInputOutsideTenant(new Map(), streams, entities(tenancy))).toEqual([
        expect.objectContaining({ code: 'personalOutsideTenant', module: 'm', ref: 'm.log' }),
      ]);
    }
    const plain = new Map([stream('m.log', 'm.row', plainInput)]);
    expect(checkPersonalInputOutsideTenant(new Map(), plain, entities('backend'))).toEqual([]);
  });
});
