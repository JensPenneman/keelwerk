import { conformanceEntities, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { createMigrating } from './create-migrating.ts';
import { migratingSnapshot } from './migrating-snapshot.ts';
import { migrationColumn } from './migration-column.ts';
import { rowAt } from './row-at.ts';

const { kitchen } = conformanceEntities;
const { tenantA } = conformanceScopes;

export function toggleRebuildCases(subject: ConformanceSubject): void {
  describe('toggle then rebuild (14.6.5, 14.10 case 9)', () => {
    const extraColumn = migrationColumn('extra', { default: 'none' });
    const addExtra = {
      id: '0001-extras',
      track: 'conf[extras]',
      steps: [{ op: 'addColumn', entity: 'conf.migrating', field: 'extra', column: extraColumn }],
    } as const;
    const addMore = {
      id: '0002-extras-more',
      track: 'conf[extras]',
      steps: [
        {
          op: 'addColumn',
          entity: 'conf.migrating',
          field: 'more',
          column: migrationColumn('more', { default: 'none' }),
        },
      ],
    } as const;

    test('the columns of an inactive track stay through a rebuild; reactivation runs only the files missing from the history', async () => {
      const schema = subject.adapter().schema;
      const namespace = subject.namespace();
      const table = async () =>
        (await schema.introspect({ namespace })).tables.find((t) => t.name === 'conf__migrating');
      const columns = async () => (await table())?.columns.map((c) => c.name) ?? [];
      const extrasHistory = async () =>
        (await schema.history(namespace))
          .filter((h) => h.track === 'conf[extras]')
          .map((h) => h.id);
      await schema.apply(namespace, createMigrating);
      await schema.apply(namespace, addExtra);
      expect(await extrasHistory()).toEqual(['0001-extras']);
      // The track is now inactive: the planner provisions and rebuilds without it, and its files stay in the history.
      await schema.provision(namespace, [migratingSnapshot]);
      await schema.apply(namespace, {
        id: '0002-rebuild',
        track: 'conf',
        steps: [{ op: 'rebuild', entity: 'conf.migrating', reason: 'toggle' }],
      });
      expect(await columns()).toContain('extra');
      expect((await table())?.columns.find((c) => c.name === 'extra')?.default).toBe('none');
      // Reactivation: the file in the history is a no-op, the file missing from it runs.
      await schema.apply(namespace, addExtra);
      await schema.apply(namespace, addMore);
      expect(await extrasHistory()).toEqual(['0001-extras', '0002-extras-more']);
      expect(await columns()).toEqual(expect.arrayContaining(['id', 'label', 'extra', 'more']));
    });

    test('row values written while a track was active survive its inactivity and a rebuild', async () => {
      const schema = subject.adapter().schema;
      const namespace = subject.namespace();
      await schema.apply(namespace, createMigrating);
      await schema.apply(namespace, addExtra);
      await subject.run(tenantA, (unit) =>
        unit.rows.insert(kitchen, [rowAt(1, { name: 'base', notes: 'from the optional track' })]),
      );
      await schema.provision(namespace, [migratingSnapshot]);
      await schema.apply(namespace, {
        id: '0003-rebuild',
        track: 'conf',
        steps: [{ op: 'rebuild', entity: 'conf.kitchen', reason: 'toggle' }],
      });
      const row = await subject.read(tenantA, (unit) => unit.rows.findOne(kitchen, {}));
      expect(row).toMatchObject({ name: 'base', notes: 'from the optional track' });
    });
  });
}
