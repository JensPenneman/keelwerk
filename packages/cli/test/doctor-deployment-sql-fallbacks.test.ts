import {
  type DeploymentDefinition,
  defineApp,
  defineModule,
  defineModuleBase,
  type FallbackReporter,
} from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { absent } from '../src/doctor/absent.ts';
import { fallbacksCheck } from '../src/doctor/check-fallbacks.ts';
import { deploymentChecks } from '../src/doctor/deployment-checks.ts';
import { known } from '../src/doctor/known.ts';
import { runDeploymentChecks } from '../src/doctor/run-deployment-checks.ts';
import { definitionOf } from './support/deployment-definition-of.ts';
import { input, noRows, sink } from './support/deployment-input-of.ts';
import { capabilitiesOf, factsOf } from './support/facts-of.ts';
import { placementsOf } from './support/placements-of.ts';

describe('the placement checks', () => {
  describe('raw-SQL needs, read from the modules of the apps', () => {
    const app = (id: string, data: object | undefined) => ({
      kind: 'app',
      id,
      modules: [{ base: { id: `module-${id}`, ...(data === undefined ? {} : { data }) } }],
    });
    const definition = definitionOf({
      apps: [
        app('A', { sql: 'postgres' }),
        app('B', { needs: [{ sql: 'postgres' }] }),
        app('C', undefined),
      ] as unknown as DeploymentDefinition['apps'],
      infrastructure: [noRows, sink()],
      placements: {
        m: { adapter: 'postgres', apps: ['A', 'B'] },
        n: { adapter: 'postgres', apps: ['C'] },
      },
    });
    const opened = {
      m: known(capabilitiesOf({ sql: false })),
      n: known(capabilitiesOf({ sql: false })),
    };
    const sqlLines = async (capabilities: Parameters<typeof placementsOf>[1]) =>
      (
        await deploymentChecks(
          input(definition, { placements: placementsOf(definition, capabilities) }),
        )
      )
        .filter(
          (finding) =>
            finding.message.includes('raw SQL') || finding.message.startsWith('raw-SQL needs'),
        )
        .map((finding) => [finding.severity, finding.subject, finding.message]);

    test('a placement that hosts the app of a module that needs a dialect it lacks is an error per module; one that does not host it is not judged', async () => {
      expect(await sqlLines(opened)).toEqual([
        [
          'error',
          'm',
          'module module-A needs raw SQL (postgres) and the postgres adapter of placement m offers none',
        ],
        [
          'error',
          'm',
          'module module-B needs raw SQL (postgres) and the postgres adapter of placement m offers none',
        ],
      ]);
    });

    test('a placement that hosts one app is judged for its modules only, not for those of an app it does not host', async () => {
      const partial = definitionOf({
        ...definition,
        placements: { p: { adapter: 'postgres', apps: ['A'] } },
      });
      const found = await deploymentChecks(
        input(partial, {
          placements: placementsOf(partial, { p: known(capabilitiesOf({ sql: false })) }),
        }),
      );
      expect(
        found
          .filter((finding) => finding.message.includes('raw SQL'))
          .map((finding) => finding.message),
      ).toEqual([
        'module module-A needs raw SQL (postgres) and the postgres adapter of placement p offers none',
      ]);
    });

    test('a placement that was not opened is not checked, but only where it hosts such an app', async () => {
      const unopened = {
        m: absent<never>('it is down', 'start it'),
        n: absent<never>('it is down', 'start it'),
      };
      expect(await sqlLines(unopened)).toEqual([['not-checked', 'm', 'raw-SQL needs: it is down']]);
    });

    test('a placement that offers the dialect is not an error', async () => {
      const offering = { ...opened, m: known(capabilitiesOf({ sql: { dialect: 'postgres' } })) };
      expect(await sqlLines(offering)).toEqual([]);
    });
  });

  describe('raw-SQL needs of an app composed by the framework', () => {
    const base = defineModuleBase({ id: 'reports', version: '1.0.0', data: { sql: 'postgres' } });
    const app = defineApp({ id: 'shop', modules: [defineModule(base, {})] });
    const closed = { main: known(capabilitiesOf({ sql: false })) };
    const message =
      'module reports needs raw SQL (postgres) and the postgres adapter of placement main offers none';

    test('a placement that names the app is judged for the module it declares', async () => {
      const named = definitionOf({
        apps: [app],
        infrastructure: [noRows, sink()],
        placements: { main: { adapter: 'postgres', apps: ['shop'] } },
      });
      const found = await deploymentChecks(
        input(named, { placements: placementsOf(named, closed) }),
      );
      expect(found.filter((finding) => finding.message.includes('raw SQL'))).toEqual([
        expect.objectContaining({ severity: 'error', subject: 'main', message }),
      ]);
    });

    test('a placement with no apps list hosts every app, so it is judged for the same module', async () => {
      const unnamed = definitionOf({
        apps: [app],
        infrastructure: [noRows, sink()],
        placements: { main: { adapter: 'postgres' } },
      });
      const found = await deploymentChecks(
        input(unnamed, { placements: placementsOf(unnamed, closed) }),
      );
      expect(found.filter((finding) => finding.message.includes('raw SQL'))).toEqual([
        expect.objectContaining({ severity: 'error', subject: 'main', message }),
      ]);
    });
  });

  describe('the fallbacks, per placement', () => {
    const reporter: FallbackReporter = {
      kind: 'fallbackReporter',
      provides: [],
      report: () => [
        { capability: 'rowLocks', path: 'a retry', cost: 'repeated units' },
        { capability: 'rowLevelSecurity', path: 'a filter', cost: 'a check per row' },
      ],
    };

    test('a placement that was not opened is not checked with the reason; an opened one lists its rows', async () => {
      const definition = definitionOf({ infrastructure: [reporter, sink()] });
      const found = await deploymentChecks(
        input(definition, {
          placements: placementsOf(definition, {
            control: known(capabilitiesOf({})),
            main: absent('its url reads an environment variable that is not set', 'set it'),
          }),
        }),
      );
      const fallbacks = found.filter((finding) => finding.check === 'fallbacks');
      expect(
        fallbacks.map((finding) => [finding.severity, finding.subject, finding.message]),
      ).toEqual([
        ['note', 'control', 'rowLocks is absent: the kernel runs a retry; cost: repeated units'],
        [
          'warning',
          'control',
          'rowLevelSecurity is absent: the kernel runs a filter; cost: a check per row',
        ],
        ['not-checked', 'main', 'fallbacks: its url reads an environment variable that is not set'],
      ]);
    });

    test('only the capabilities the apps lean on are listed', async () => {
      const found = runDeploymentChecks(
        [fallbacksCheck],
        factsOf({
          fallbackReporter: known(reporter),
          capabilitiesUsed: known(new Set(['rowLocks'])),
          placements: [
            { name: 'main', adapter: 'memory', apps: [], capabilities: known(capabilitiesOf({})) },
          ],
        }),
      );
      expect(found.map((finding) => finding.message)).toEqual([
        'rowLocks is absent: the kernel runs a retry; cost: repeated units',
      ]);
    });
  });
});
