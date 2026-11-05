import type { MigrationFile } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { createMigrating } from './create-migrating.ts';
import { failureOf } from './failure-of.ts';
import { migratingSnapshot } from './migrating-snapshot.ts';
import { migrationColumn } from './migration-column.ts';

export function migrationCases(subject: ConformanceSubject): void {
  describe('migrations (14.6, 14.10 case 9)', () => {
    const schema = () => subject.adapter().schema;
    const tableOf = async () =>
      (await schema().introspect({ namespace: subject.namespace() })).tables.find(
        (t) => t.name === 'conf__migrating',
      );
    const columns = async () => (await tableOf())?.columns.map((c) => c.name) ?? [];

    test('provision is idempotent and introspect reads the tables back', async () => {
      const namespace = subject.namespace();
      await schema().provision(namespace, [migratingSnapshot]);
      await schema().provision(namespace, [migratingSnapshot]);
      const table = await tableOf();
      expect(table?.primaryKey).toEqual(['id']);
      expect(await columns()).toEqual(expect.arrayContaining(['id', 'label']));
    });

    test('a provisioned table is addressed by its entity: a later file alters it', async () => {
      const namespace = subject.namespace();
      await schema().provision(namespace, [
        {
          ...migratingSnapshot,
          entities: {
            'conf.migrating': {
              history: 'chain',
              mergeState: false,
              fields: {},
              renames: [],
              events: {},
              evolveHash: '',
            },
          },
        },
      ]);
      await schema().apply(namespace, {
        id: '0001-more',
        track: 'conf',
        steps: [
          {
            op: 'addColumn',
            entity: 'conf.migrating',
            field: 'extra',
            column: migrationColumn('extra'),
          },
        ],
      });
      expect(await columns()).toContain('extra');
    });

    test('apply runs a file and records it with its checksum; a repeat is a no-op; a changed file conflicts', async () => {
      const namespace = subject.namespace();
      await schema().apply(namespace, createMigrating);
      await schema().apply(namespace, createMigrating);
      const history = (await schema().history(namespace)).filter((h) => h.track === 'conf');
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ id: '0001-migrating', stepsApplied: 1 });
      expect(history[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
      const changed: MigrationFile = {
        ...createMigrating,
        steps: [
          ...createMigrating.steps,
          { op: 'rebuild', entity: 'conf.migrating', reason: 'changed' },
        ],
      };
      expect((await failureOf(schema().apply(namespace, changed))).kind).toBe('conflict');
    });

    test('render describes each step in order, without running it', () => {
      const statements = schema().render(subject.namespace(), createMigrating.steps);
      expect(statements.length).toBeGreaterThan(0);
      expect(statements.join('\n')).toContain('conf__migrating');
    });

    test('column steps change what introspect reads', async () => {
      const namespace = subject.namespace();
      await schema().apply(namespace, createMigrating);
      await schema().apply(namespace, {
        id: '0002-more',
        track: 'conf',
        steps: [
          {
            op: 'addColumn',
            entity: 'conf.migrating',
            field: 'extra',
            column: migrationColumn('extra'),
          },
        ],
      });
      expect(await columns()).toContain('extra');
      await schema().apply(namespace, {
        id: '0003-less',
        track: 'conf',
        steps: [{ op: 'dropColumn', entity: 'conf.migrating', field: 'extra' }],
      });
      expect(await columns()).not.toContain('extra');
    });

    test('a failing file leaves nothing when DDL is transactional, and a resumable record when it is not', async () => {
      const namespace = subject.namespace();
      await schema().apply(namespace, createMigrating);
      const broken: MigrationFile = {
        id: '0002-broken',
        track: 'conf',
        steps: [
          {
            op: 'addColumn',
            entity: 'conf.migrating',
            field: 'extra',
            column: migrationColumn('extra'),
          },
          {
            op: 'addColumn',
            entity: 'conf.migrating',
            field: 'label',
            column: migrationColumn('label'),
          },
        ],
      };
      expect((await failureOf(schema().apply(namespace, broken))).kind).toBe('conflict');
      if (subject.capabilities().transactions.transactionalDdl) {
        expect(await columns()).not.toContain('extra');
        expect((await schema().history(namespace)).map((h) => h.id)).not.toContain('0002-broken');
      }
    });

    test('lock serialises its callers', async () => {
      const order: string[] = [];
      const slow = schema().lock(subject.namespace(), async () => {
        order.push('a');
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push('b');
      });
      const fast = schema().lock(subject.namespace(), async () => {
        order.push('c');
      });
      await Promise.all([slow, fast]);
      expect(order).toEqual(['a', 'b', 'c']);
    });
  });
}
