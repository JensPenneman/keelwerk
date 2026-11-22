import type { AdapterCapabilities, FallbackReporter, Registry, ScopeMark } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { absent } from '../src/doctor/absent.ts';
import { deploymentGroup } from '../src/doctor/check-deployment.ts';
import { healthCheck } from '../src/doctor/check-health.ts';
import { personalFieldsCheck } from '../src/doctor/check-personal-fields.ts';
import { deploymentCheckList } from '../src/doctor/deployment-check-list.ts';
import { deploymentChecks } from '../src/doctor/deployment-checks.ts';
import type { PersonalFieldFact } from '../src/doctor/deployment-facts.ts';
import { known } from '../src/doctor/known.ts';
import { runDeploymentChecks } from '../src/doctor/run-deployment-checks.ts';
import { unfedChecks } from '../src/doctor/unfed-checks.ts';
import { definitionOf } from './support/deployment-definition-of.ts';
import { input, judged, sink, unfedNotes } from './support/deployment-input-of.ts';
import { factsOf } from './support/facts-of.ts';

describe('the checks that read declarations and rows', () => {
  test('the personal-data pass warns about weak settings and its note names no index size', () => {
    const base: PersonalFieldFact = {
      field: 'a.b.ok',
      kind: 'string',
      queries: ['eq'],
      keys: 'subject',
      normalizer: 'email/1',
      prefixMin: 3,
      containsBits: 8,
      searchKeys: [],
    };
    const found = runDeploymentChecks(
      [personalFieldsCheck],
      factsOf({
        personalFields: known([
          { ...base, field: 'a.b.flag', kind: 'boolean' },
          {
            ...base,
            field: 'a.b.name',
            queries: ['prefix', 'contains', 'order'],
            prefixMin: 1,
            containsBits: 16,
            searchKeys: ['tenant'],
          },
          base,
        ]),
      }),
    );
    const notes = found.filter((finding) => finding.severity === 'note');
    expect(notes.map((finding) => finding.subject)).toEqual(['a.b.flag', 'a.b.name', 'a.b.ok']);
    expect(notes.at(2)?.message).toBe(
      'capabilities: eq; key scope: subject; normaliser: email/1; leaks: none',
    );
    expect(notes.at(1)?.message).toContain('leaks: prefix.min is 1');
    expect(notes.every((finding) => !finding.message.includes('index:'))).toBe(true);
    expect(
      found.filter((finding) => finding.severity === 'warning').map((finding) => finding.subject),
    ).toEqual(['a.b.flag', 'a.b.name', 'a.b.name', 'a.b.name', 'a.b.name']);
  });

  test('personal fields: a deployment with none gives no personal line; one field gives a line for each sampled check', async () => {
    const none = await deploymentChecks(input(definitionOf({ infrastructure: [sink()] })));
    expect(none.filter((finding) => finding.check === 'personal-fields')).toEqual([]);
    const field = {
      descriptor: {
        fields: {
          email: {
            kind: 'string',
            personal: {
              queries: ['eq'],
              keys: 'subject',
              normalize: { id: 'email', version: 1 },
              params: { prefix: { min: 3 }, contains: { bits: 8 } },
            },
          },
        },
        searchIndexes: [],
        indexes: [],
      },
    };
    const registry = {
      entities: new Map([['a.b', field]]),
      reactions: new Map(),
    } as unknown as Registry;
    const one = await deploymentChecks(
      input(definitionOf({ infrastructure: [sink()] }), { registries: [registry] }),
    );
    const lines = one.filter((finding) => finding.check === 'personal-fields');
    expect(judged(lines).filter((finding) => finding.severity === 'note')).toHaveLength(1);
    expect(unfedNotes(lines)).toHaveLength(5);
  });

  test('the distinct-values line is for an eq field of a kind with many values, and only then', () => {
    const fieldOf = (
      field: string,
      kind: string,
      queries: readonly string[],
    ): PersonalFieldFact => ({
      field,
      kind,
      queries,
      keys: 'tenant',
      normalizer: 'x/1',
      prefixMin: 1,
      containsBits: 16,
      searchKeys: ['tenant'],
    });
    const linesFor = (field: PersonalFieldFact) =>
      unfedNotes(runDeploymentChecks(unfedChecks, factsOf({ personalFields: known([field]) }))).map(
        (finding) => finding.subject,
      );
    const distinct = 'fewer than 1,000 distinct values';
    const others = linesFor(fieldOf('a.b.s', 'string', ['eq']));
    expect(others).toContain(distinct);
    expect(others.length).toBeGreaterThan(1);
    for (const field of [
      fieldOf('a.b.flag', 'boolean', ['eq']),
      fieldOf('a.b.state', 'enum', ['eq']),
      fieldOf('a.b.plain', 'string', ['order']),
    ]) {
      const lines = linesFor(field);
      expect(lines).not.toContain(distinct);
      expect(lines).toHaveLength(others.length - 1);
    }
  });

  test('the anchor checks read no sink: three notes that doctor does not check them, no call', async () => {
    const counter = { reads: 0 };
    const found = await deploymentChecks(
      input(definitionOf({ infrastructure: [sink(counter)], anchors: { every: 'PT15M' } })),
    );
    expect(counter.reads).toBe(0);
    const anchors = found.filter((finding) => finding.check === 'anchors');
    expect(anchors).toHaveLength(3);
    expect(unfedNotes(anchors)).toHaveLength(3);
  });

  test('a control store that does not answer is an error with the detail', () => {
    const found = runDeploymentChecks(
      deploymentGroup,
      factsOf({ controlReachable: known({ reachable: false, detail: 'connection refused' }) }),
    );
    expect(found.map((finding) => [finding.severity, finding.message])).toEqual([
      ['error', 'the control store is not reachable: connection refused'],
    ]);
  });

  test('health: not ready, presumed gone and no process at all', () => {
    const process = {
      id: 'p',
      name: 'web',
      roles: ['serve'],
      state: 'ready',
      heartbeatAgeMs: 1000,
    };
    const check = (processes: readonly (typeof process)[]) =>
      runDeploymentChecks([healthCheck], factsOf({ processes: known(processes) }));
    expect(check([process])).toEqual([]);
    expect(check([{ ...process, state: 'starting' }])[0]?.message).toBe(
      'process web is starting, not ready',
    );
    expect(check([{ ...process, heartbeatAgeMs: 45_000 }])[0]?.message).toContain('presumed gone');
    expect(check([{ ...process, state: 'stopped', heartbeatAgeMs: 45_000 }])).toEqual([]);
    expect(check([])[0]?.subject).toBe('processes');
  });

  test('nothing doctor prints names a work package, a milestone or a decision', async () => {
    const mark: ScopeMark = {
      scopeId: 's',
      namespaceId: 'ns',
      position: 1n,
      serials: {},
      epoch: 1,
      updatedAt: Temporal.Instant.from('2026-11-05T10:00:00Z'),
    };
    const field = {
      field: 'a.b.c',
      kind: 'boolean',
      queries: ['eq', 'order'],
      keys: 'tenant' as const,
      normalizer: 'x/1',
      prefixMin: 1,
      containsBits: 16,
      searchKeys: ['tenant' as const],
    };
    const everything = runDeploymentChecks(
      deploymentCheckList,
      factsOf({
        socket: known({ path: '/s', mode: 0o666 }),
        masterKey: known({ declared: false, present: false }),
        clusters: known({ control: 'x', placements: [{ name: 'main', cluster: 'x' }] }),
        ledgerSinks: known(0),
        controlReachable: known({ reachable: false, detail: 'down' }),
        hookFailures: known([{ hookId: 'h', tenantId: 't' }]),
        processes: known([
          { id: 'p', name: undefined, roles: [], state: 'starting', heartbeatAgeMs: 9e9 },
        ]),
        bumpedMarks: known([mark]),
        heldTenants: known(['t']),
        registries: known([
          { reactions: new Map([['r', { id: 'r', on: 'all' }]]) } as unknown as Registry,
        ]),
        personalFields: known([field]),
        sqlNeeds: known([{ app: 'a', module: 'm', dialect: 'postgres' }]),
        fallbackReporter: known({
          kind: 'fallbackReporter',
          provides: [],
          report: () => [{ capability: 'rowLevelSecurity', path: 'p', cost: 'c' }],
        } as FallbackReporter),
        placements: [
          {
            name: 'main',
            adapter: 'memory',
            apps: ['a'],
            capabilities: known({ sql: false } as unknown as AdapterCapabilities),
          },
          { name: 'other', adapter: 'memory', apps: [], capabilities: absent('closed', 'open it') },
        ],
      }),
    );
    const checks = new Set(everything.map((finding) => finding.check));
    expect([...checks].sort()).toEqual([
      'deployment',
      'epoch-bumps',
      'fallbacks',
      'health',
      'held-tenants',
      'observers',
      'personal-fields',
      'queues',
    ]);
    const unfedFound = await deploymentChecks(input(definitionOf({ infrastructure: [sink()] })));
    for (const finding of [...everything, ...unfedFound]) {
      expect(`${finding.message} ${finding.fix}`).not.toMatch(/\bWP-\d+|\bS-\d+|\bM\d\b/);
    }
  });
});
