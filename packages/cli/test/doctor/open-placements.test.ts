import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataAdapterFactory, DeploymentDefinition } from '@keelwerk/core';
import { env } from '@keelwerk/core';
import { memoryAdapter } from '@keelwerk/data';
import { pgliteAdapterFactory } from '@keelwerk/data/pglite';
import { describe, expect, test } from 'vitest';
import { openPlacements } from '../../src/doctor/open-placements.ts';
import { definitionOf } from '../support/deployment-definition-of.ts';

type Opened = Awaited<ReturnType<typeof openPlacements>>;

const capabilitiesOf = (opened: Opened, name: string) =>
  opened.find((placement) => placement.name === name)?.capabilities;

const fixOf = (opened: Opened, name: string) => {
  const fact = capabilitiesOf(opened, name);
  return fact === undefined || fact.known ? undefined : fact.fix;
};

const reasonOf = (opened: Opened, name: string): string | undefined => {
  const fact = capabilitiesOf(opened, name);
  return fact === undefined || fact.known ? undefined : fact.reason;
};

const pgliteReason = expect.stringContaining('the pglite adapter is not opened');

describe('opening the placements to read their capabilities', () => {
  test('a placement whose adapter is pglite is never created', async () => {
    let created = 0;
    const factory: DataAdapterFactory = {
      ...memoryAdapter(),
      id: 'pglite',
      create: (...args) => {
        created += 1;
        return memoryAdapter().create(...args);
      },
    };
    const definition: DeploymentDefinition = definitionOf({
      infrastructure: [factory],
      control: { adapter: 'pglite', url: '/nowhere/control' },
      placements: { main: { adapter: 'pglite', url: '/nowhere/main' } },
    });
    const opened = await openPlacements(definition, {});
    expect(created).toBe(0);
    expect(reasonOf(opened, 'control')).toEqual(pgliteReason);
    expect(reasonOf(opened, 'main')).toEqual(pgliteReason);
    expect(fixOf(opened, 'main')).toBe('nothing to do: doctor never opens an embedded database');
  });

  test('the pglite factory is not asked to create the directory its url names', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'kw-doctor-pglite-'));
    try {
      const directory = join(scratch, 'never-created');
      const opened = await openPlacements(
        definitionOf({
          infrastructure: [pgliteAdapterFactory()],
          control: { adapter: 'pglite', url: directory },
          placements: {},
        }),
        {},
      );
      expect(reasonOf(opened, 'control')).toEqual(pgliteReason);
      expect(existsSync(directory)).toBe(false);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  test('each way a placement cannot be opened gives its own reason, and no other adapter is skipped', async () => {
    const failing: DataAdapterFactory = {
      ...memoryAdapter(),
      id: 'broken',
      create: (placement, environment) => {
        const adapter = memoryAdapter().create(placement, environment);
        return {
          ...adapter,
          connect: async () => {
            throw new Error('the server refused the connection');
          },
        };
      },
    };
    const opened = await openPlacements(
      definitionOf({
        infrastructure: [memoryAdapter(), failing],
        control: { adapter: 'memory' },
        placements: {
          nowhere: { adapter: 'absent-adapter' },
          unset: { adapter: 'memory', url: env('NOT_SET') },
          broken: { adapter: 'broken' },
          fine: { adapter: 'memory' },
        },
      }),
      {},
    );
    expect(reasonOf(opened, 'nowhere')).toBe(
      'no infrastructure entry provides the absent-adapter adapter',
    );
    expect(reasonOf(opened, 'unset')).toBe('its url reads an environment variable that is not set');
    expect(reasonOf(opened, 'broken')).toBe(
      'the placement could not be opened: the server refused the connection',
    );
    expect(fixOf(opened, 'nowhere')).toBe(
      'add the absent-adapter adapter to `infrastructure` in the deployment file',
    );
    expect(fixOf(opened, 'unset')).toBe(
      'set the environment variable the url reads, then run doctor again',
    );
    expect(fixOf(opened, 'broken')).toBe(
      'check that the database answers at the url of the deployment file, then run doctor again',
    );
    expect(capabilitiesOf(opened, 'fine')?.known).toBe(true);
    expect(capabilitiesOf(opened, 'control')?.known).toBe(true);
  });

  test('a create, a connect and a close that fail each give their own reason, and the connect failure is not hidden by a close failure', async () => {
    const fail = (message: string) => async (): Promise<never> => {
      throw new Error(message);
    };
    const base = memoryAdapter();
    const closeFails: DataAdapterFactory = {
      ...base,
      id: 'close-fails',
      create: (placement, environment) => ({
        ...base.create(placement, environment),
        close: fail('the socket would not close'),
      }),
    };
    const createFails: DataAdapterFactory = {
      ...base,
      id: 'create-fails',
      create: () => {
        throw new Error('the driver is not installed');
      },
    };
    const bothFail: DataAdapterFactory = {
      ...base,
      id: 'both-fail',
      create: (placement, environment) => ({
        ...base.create(placement, environment),
        connect: fail('the server refused the connection'),
        close: fail('already gone'),
      }),
    };
    const opened = await openPlacements(
      definitionOf({
        infrastructure: [memoryAdapter(), closeFails, createFails, bothFail],
        control: { adapter: 'memory' },
        placements: {
          closing: { adapter: 'close-fails' },
          creating: { adapter: 'create-fails' },
          both: { adapter: 'both-fail' },
        },
      }),
      {},
    );
    expect(reasonOf(opened, 'closing')).toBe(
      'the placement was opened, but closing it failed: the socket would not close',
    );
    expect(fixOf(opened, 'closing')).toBe(
      'run doctor again; if it fails the same way, check why the adapter cannot close its connection',
    );
    expect(reasonOf(opened, 'creating')).toBe(
      'the placement could not be opened: the driver is not installed',
    );
    expect(reasonOf(opened, 'both')).toBe(
      'the placement could not be opened: the server refused the connection; closing it failed too: already gone',
    );
    expect(capabilitiesOf(opened, 'control')?.known).toBe(true);
  });

  test('one walk gives each placement with its adapter and the apps it hosts, the control store first', async () => {
    const opened = await openPlacements(
      definitionOf({
        apps: [{ id: 'A' }, { id: 'B' }],
        infrastructure: [memoryAdapter()],
        control: { adapter: 'memory' },
        placements: {
          listed: { adapter: 'memory', apps: ['A'] },
          unlisted: { adapter: 'memory' },
        },
      }),
      {},
    );
    expect(opened.map((placement) => [placement.name, placement.adapter, placement.apps])).toEqual([
      ['control', 'memory', []],
      ['listed', 'memory', ['A']],
      ['unlisted', 'memory', ['A', 'B']],
    ]);
  });
});
