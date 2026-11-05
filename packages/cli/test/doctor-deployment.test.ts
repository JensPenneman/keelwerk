import type { AdapterCapabilities, DeploymentDefinition, LedgerRecord, Unit } from '@keelwerk/core';
import { env, secret } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { checkAnchors } from '../src/doctor/check-anchors.ts';
import { checkDeployment } from '../src/doctor/check-deployment.ts';
import { checkHealth } from '../src/doctor/check-health.ts';
import { checkPersonalFields } from '../src/doctor/check-personal-fields.ts';
import { checkQueuesWithoutWorkers } from '../src/doctor/check-queues-without-workers.ts';
import { hookEventTypes } from '../src/doctor/hook-event-types.ts';
import { hookFailuresOf } from '../src/doctor/hook-failures-of.ts';
import { readDeploymentFacts } from '../src/doctor/read-deployment-facts.ts';

const keyEnvironment: Record<string, string | undefined> = Object.fromEntries([['KW_KEY', 'x']]);

function definitionOf(over: Partial<DeploymentDefinition> = {}): DeploymentDefinition {
  return {
    apps: [],
    infrastructure: [],
    control: { adapter: 'postgres', url: 'postgres://db1:5432/control' },
    placements: { main: { adapter: 'postgres', url: 'postgres://db1:5432/app' } },
    operator: { socket: '/run/keelwerk.sock' },
    keys: { masterKey: secret('KW_KEY') },
    ...over,
  };
}

const anchor = (scopeId: string, position: string, recordedAt: string): LedgerRecord => ({
  type: 'anchor',
  scopeId,
  position,
  hash: 'h',
  stream: { type: 'core.tenant', id: scopeId },
  recordedAt,
  writer: { process: 'p', build: 'b' },
});

describe('the deployment', () => {
  const input = (definition: DeploymentDefinition, mode: number | undefined = 0o600) => ({
    definition,
    env: keyEnvironment,
    modeOf: async () => mode,
    registries: [],
    capabilities: new Map<string, AdapterCapabilities>(),
    reader: undefined,
  });

  test('a sound deployment has no error', async () => {
    const facts = await readDeploymentFacts(
      input(
        definitionOf({
          infrastructure: [{ id: 's', append: async () => undefined, read: async function* () {} }],
        }),
      ),
    );
    expect(checkDeployment(facts)).toEqual([]);
  });

  test('an open socket, a missing master key and a control store sharing the placements cluster', async () => {
    const facts = await readDeploymentFacts({
      ...input(definitionOf(), 0o666),
      env: {},
    });
    expect(checkDeployment(facts).map((finding) => [finding.severity, finding.message])).toEqual([
      ['error', 'the operator socket has mode 666, so other users can reach it'],
      ['error', 'the master key secret is not available to this process'],
      [
        'warning',
        'the control store shares a cluster with main and no ledger sink is configured, so a restored backup cannot be detected',
      ],
    ]);
    const { keys: _keys, ...keyless } = definitionOf();
    const none = await readDeploymentFacts(input(keyless));
    expect(checkDeployment(none).map((finding) => finding.subject)).toContain('keys.masterKey');
  });

  test('urls read through env() resolve against the environment before the clusters compare', async () => {
    const urls = (control: string, main: string) =>
      readDeploymentFacts({
        ...input(
          definitionOf({
            control: { adapter: 'postgres', url: env('CONTROL_URL') },
            placements: { main: { adapter: 'postgres', url: env('MAIN_URL') } },
          }),
        ),
        env: Object.fromEntries([
          ['KW_KEY', 'x'],
          ['CONTROL_URL', control],
          ['MAIN_URL', main],
        ]),
      });
    const apart = await urls('postgres://db1:5432/c', 'postgres://db2:5432/a');
    expect(apart.control.cluster).toBe('postgres://db1:5432');
    expect(apart.placements[0]?.cluster).toBe('postgres://db2:5432');
    expect(checkDeployment(apart).map((finding) => finding.severity)).toEqual([]);
    const together = await urls('postgres://db1:5432/c', 'postgres://db1:5432/a');
    expect(checkDeployment(together).map((finding) => finding.severity)).toEqual(['warning']);
    const unset = await readDeploymentFacts({
      ...input(definitionOf({ control: { adapter: 'postgres', url: env('NOT_SET') } })),
    });
    expect(unset.control.cluster).toBeUndefined();
    expect(checkDeployment(unset)).toEqual([]);
  });

  test('queues that hold work and have no worker (S-24), and queued caps past 80 percent', async () => {
    const definition = definitionOf({
      queues: { mail: { queued: 10 }, reports: {} },
      processes: { web: { roles: ['serve'] }, jobs: { roles: ['work'], slots: { reports: 2 } } },
    });
    const facts = await readDeploymentFacts({
      ...input(definition),
      reader: {
        reachable: async () => ({ reachable: true, detail: '' }),
        processes: async () => [],
        hookFailures: async () => [],
        queueDepths: async () =>
          new Map([
            ['mail', { queued: 9, running: 0 }],
            ['reports', { queued: 3, running: 1 }],
          ]),
      },
    });
    expect(checkQueuesWithoutWorkers(facts.queues).map((finding) => finding.subject)).toEqual([
      'mail',
    ]);
    expect(checkDeployment(facts).map((finding) => finding.message)).toContain(
      'queue mail holds 9 of 10 queued jobs (over 80 percent)',
    );
  });

  test('anchors: stale, rewound and refused (S-35)', async () => {
    const sink = {
      id: 'ledger',
      append: async () => undefined,
      read: async function* () {
        yield anchor('t1', '10', '2026-11-05T09:00:00Z');
        yield anchor('t1', '12', '2026-11-05T09:30:00Z');
        yield anchor('t2', '5', '2026-11-05T09:59:00Z');
      },
    };
    const facts = await readDeploymentFacts({
      ...input(definitionOf({ infrastructure: [sink], anchors: { every: 'PT15M' } })),
      reader: {
        reachable: async () => ({ reachable: true, detail: '' }),
        processes: async () => [],
        hookFailures: async () => [],
        heads: async () =>
          new Map([
            ['t1', '9'],
            ['t2', '5'],
          ]),
      },
    });
    expect(
      facts.anchors.scopes.map((scope) => [scope.scopeId, scope.anchored, scope.head]),
    ).toEqual([
      ['t1', '12', '9'],
      ['t2', '5', '5'],
    ]);
    const found = checkAnchors(
      { ...facts.anchors, refusedAppends: 1 },
      Temporal.Instant.from('2026-11-05T10:00:00Z'),
    );
    expect(found.map((finding) => [finding.severity, finding.subject])).toEqual([
      ['error', 't1'],
      ['warning', 't1'],
      ['error', 'ledger sink'],
    ]);
  });

  test('the personal-data pass warns about weak settings', () => {
    const base = {
      kind: 'string',
      queries: ['eq'],
      keys: 'subject' as const,
      normalizer: 'email/1',
      prefixMin: 3,
      containsBits: 8,
      searchKeys: [],
      distinctValues: undefined,
      indexRows: undefined,
      indexBytes: undefined,
      failedReindexJobs: 0,
      plaintextBackups: false,
      otherUnicodeVersion: false,
    };
    const found = checkPersonalFields([
      { ...base, field: 'a.b.flag', kind: 'boolean' },
      { ...base, field: 'a.b.few', distinctValues: 12 },
      {
        ...base,
        field: 'a.b.name',
        queries: ['prefix', 'contains', 'order'],
        prefixMin: 1,
        containsBits: 16,
        searchKeys: ['tenant' as const],
        failedReindexJobs: 2,
        plaintextBackups: true,
        otherUnicodeVersion: true,
      },
      { ...base, field: 'a.b.ok' },
    ]);
    const notes = found.filter((finding) => finding.severity === 'note');
    expect(notes.map((finding) => finding.subject)).toEqual([
      'a.b.flag',
      'a.b.few',
      'a.b.name',
      'a.b.ok',
    ]);
    expect(notes.at(3)?.message).toContain('key scope:');
    expect(notes.at(3)?.message).toContain('normaliser:');
    expect(notes.at(3)?.message).toContain('leaks: none');
    expect(notes.at(2)?.message).toContain('leaks: prefix.min is 1');
    expect(
      found.filter((finding) => finding.severity === 'warning').map((finding) => finding.subject),
    ).toEqual([
      'a.b.flag',
      'a.b.few',
      'a.b.name',
      'a.b.name',
      'a.b.name',
      'a.b.name',
      'a.b.name',
      'a.b.name',
      'a.b.name',
    ]);
  });

  test('health: not ready and presumed gone', () => {
    const process = {
      id: 'p',
      name: 'web',
      roles: ['serve'],
      state: 'ready',
      heartbeatAgeMs: 1000,
    };
    expect(checkHealth([process]).map((finding) => finding.severity)).toEqual(['note']);
    expect(checkHealth([process], false).map((finding) => finding.message)).toEqual([
      expect.stringContaining('doctor has no connection to a running deployment'),
    ]);
    expect(checkHealth([{ ...process, state: 'starting' }])[0]?.message).toBe(
      'process web is starting, not ready',
    );
    expect(checkHealth([{ ...process, heartbeatAgeMs: 45_000 }])[0]?.message).toContain(
      'presumed gone',
    );
    expect(checkHealth([])[0]?.subject).toBe('processes');
  });

  test('raw-SQL needs: a module that needs a dialect its placement lacks', async () => {
    const capabilities = new Map<string, AdapterCapabilities>([
      ['main', { sql: false } as AdapterCapabilities],
    ]);
    const facts = await readDeploymentFacts({
      ...input(definitionOf()),
      capabilities,
      sqlNeeds: [{ module: 'mail-store', dialect: 'postgres' }],
    });
    expect(checkDeployment(facts).map((finding) => finding.message)).toContain(
      'module mail-store needs raw SQL (postgres) and the postgres adapter of placement main offers none',
    );
  });
});

describe('failed tenant hooks (S-27)', () => {
  function unitOf(events: readonly { type: string; id: string; hook: unknown }[]): Unit {
    return {
      events: {
        readAll: async () => ({
          events: events.map((event) => ({
            type: event.type,
            stream: { type: 'core.tenant', id: event.id },
            data: { hook: event.hook },
          })),
          next: null,
        }),
      },
    } as unknown as Unit;
  }

  test('doctor reads core.tenant.hookFailed events that no hookCompleted followed', async () => {
    const unit = unitOf([
      { type: hookEventTypes.failed, id: 'tnt_1', hook: 'billing.onTenantCreated' },
      { type: hookEventTypes.failed, id: 'tnt_2', hook: 'billing.onTenantCreated' },
      { type: hookEventTypes.completed, id: 'tnt_1', hook: 'billing.onTenantCreated' },
      { type: hookEventTypes.failed, id: 'tnt_3', hook: 7 },
    ]);
    const failures = await hookFailuresOf(unit);
    expect(failures).toEqual([{ hookId: 'billing.onTenantCreated', tenantId: 'tnt_2' }]);
    const facts = await readDeploymentFacts({
      definition: definitionOf(),
      env: keyEnvironment,
      modeOf: async () => 0o600,
      registries: [],
      capabilities: new Map(),
      reader: {
        reachable: async () => ({ reachable: true, detail: '' }),
        processes: async () => [],
        hookFailures: async () => failures,
      },
    });
    expect(checkDeployment(facts).map((finding) => finding.message)).toContain(
      'the lifecycle hook billing.onTenantCreated failed for tenant tnt_2',
    );
  });
});
