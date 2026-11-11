import { describe, expect, test } from 'vitest';
import type { FlagTargetingRow } from '../control/control-flags.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { CommandRun } from '../invoker/command-runner.ts';
import type { Registry } from '../registry/registry.ts';
import type { Connected } from './connected.ts';
import type { ControlPath } from './control-path.ts';
import { createControlPath } from './create-control-path.ts';
import type { DeploymentDefinition } from './deployment-definition.ts';
import type { Migrated } from './migrate-phase.ts';
import { routeControlCommands } from './route-control-commands.ts';
import type { ServedApp } from './served-app.ts';

function run(ref: string, input: unknown): CommandRun {
  return { action: { ref }, input } as unknown as CommandRun;
}

function rig(refuse: boolean) {
  const checked: [string, number][] = [];
  const ran: string[] = [];
  const path = {
    checkFlagTargeting: async () => undefined,
    checkFlagRestore: async (id: string, ifVersion: number) => {
      checked.push([id, ifVersion]);
      if (refuse) throw new Error('the earlier rule set no longer fits the declaration');
    },
  } as unknown as ControlPath;
  const routed = routeControlCommands(async (given) => {
    ran.push(given.action.ref);
    return { output: {} };
  }, path);
  return { checked, ran, routed };
}

describe('routeControlCommands', () => {
  test('core.flag.restoreRules is checked against the declaration before it runs', async () => {
    const refusing = rig(true);
    await expect(
      refusing.routed(run('core.flag.restoreRules', { id: 'flg-1', ifVersion: 2, reason: 'undo' })),
    ).rejects.toThrow('no longer fits');
    expect(refusing.checked).toEqual([['flg-1', 2]]);
    expect(refusing.ran).toEqual([]);
    const passing = rig(false);
    await passing.routed(
      run('core.flag.restoreRules', { id: 'flg-1', ifVersion: 2, reason: 'undo' }),
    );
    expect(passing.ran).toEqual(['core.flag.restoreRules']);
  });
});

describe('routeControlCommands, the restore check and the write', () => {
  const registry = {
    modules: [
      { id: 'shop', flags: { limit: { kind: 'number', level: 'tenant', default: 1, max: 9 } } },
    ],
  } as unknown as Registry;
  const serving = (value: number) => ({ enabled: true, rules: [], fallthrough: { value } });

  /** One stored row; `afterRead` runs when the check has read it, as a set that commits before the write. */
  function over(afterRead: (row: { version: number }) => void) {
    const row: FlagTargetingRow & { version: number } = {
      id: 'flg-1',
      key: 'shop.limit',
      backendId: null,
      version: 2,
      targeting: serving(3),
      previous: serving(4),
    };
    const flags = {
      row: async () => {
        const read = { ...row };
        afterRead(row);
        return read;
      },
    };
    const path = createControlPath({
      deployment: {} as unknown as DeploymentDefinition,
      served: [{ id: 'main', registry } as unknown as ServedApp],
      connected: { control: { flags } } as unknown as Connected,
      migrated: { directory: { lookup: {} } } as unknown as Migrated,
    });
    const wrote: unknown[] = [];
    // The write side: the command's unit expects the version the request named, as loadTarget does.
    const routed = routeControlCommands(async (given) => {
      const { ifVersion } = given.input as { ifVersion: number };
      if (row.version !== ifVersion) {
        throw new KeelwerkError({
          kind: 'conflict',
          code: 'core.version_mismatch',
          message: 'The row is not at the version the request named.',
          details: { ifVersion: true },
        });
      }
      wrote.push(given.input);
      return { output: {} };
    }, path);
    return { routed, wrote };
  }

  test('a set between the check and the write makes the restore conflict', async () => {
    const { routed, wrote } = over((row) => {
      row.version = 3;
    });
    await expect(
      routed(run('core.flag.restoreRules', { id: 'flg-1', ifVersion: 2, reason: 'undo' })),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'core.version_mismatch' });
    expect(wrote).toEqual([]);
  });

  test('with no set in between the write carries the version the check read', async () => {
    const { routed, wrote } = over(() => undefined);
    await routed(run('core.flag.restoreRules', { id: 'flg-1', ifVersion: 2, reason: 'undo' }));
    expect(wrote).toEqual([{ id: 'flg-1', ifVersion: 2, reason: 'undo' }]);
  });
});
