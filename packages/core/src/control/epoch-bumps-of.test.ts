import { describe, expect, test } from 'vitest';
import type { ScopeCounters } from '../storage/scope-counters.ts';
import { epochBumpsOf } from './epoch-bumps-of.ts';
import type { NamespaceIdentity } from './namespace-identity.ts';
import type { ScopeMark } from './scope-mark.ts';

const now = Temporal.Instant.from('2026-11-17T10:00:00Z');
const namespaceId = 'ns-1';
const a = '0192f3a0-0000-7000-8000-00000000000a';
const b = '0192f3a0-0000-7000-8000-00000000000b';
const current = { systemId: 'system-1', timeline: '1' };
const recorded: NamespaceIdentity = { namespaceId, ...current, recordedAt: now };

const mark = (scopeId: string, over: Partial<ScopeMark> = {}): ScopeMark => ({
  scopeId,
  namespaceId,
  position: 10n,
  serials: {},
  epoch: 0,
  updatedAt: now,
  ...over,
});
const counters = (scopeId: string, over: Partial<ScopeCounters> = {}): ScopeCounters => ({
  scopeId,
  position: 10n,
  epoch: 1,
  serials: {},
  ...over,
});
const decide = (
  over: {
    recorded?: NamespaceIdentity | undefined;
    current?: { systemId: string; timeline: string };
    marks?: ScopeMark[];
    counters?: ScopeCounters[];
    anchors?: [string, bigint][];
    epochs?: [string, number][];
  } = {},
) =>
  epochBumpsOf({
    recorded: 'recorded' in over ? over.recorded : recorded,
    current: over.current ?? current,
    namespaceId,
    now,
    marks: new Map((over.marks ?? []).map((m) => [m.scopeId, m])),
    counters: new Map((over.counters ?? []).map((c) => [c.scopeId, c])),
    anchors: new Map(over.anchors ?? []),
    epochs: new Map(over.epochs ?? []),
  });

describe('the decision to bump an epoch (14.7.6)', () => {
  test('an unchanged namespace bumps nothing', () => {
    expect(decide({ marks: [mark(a)], counters: [counters(a)] })).toEqual([]);
    expect(decide({ marks: [mark(a)], counters: [counters(a, { position: 12n })] })).toEqual([]);
  });

  test('no recorded identity and no anchor records without bumping', () => {
    expect(
      decide({
        recorded: undefined,
        current: { systemId: 'other', timeline: '9' },
        marks: [mark(a)],
        counters: [counters(a)],
      }),
    ).toEqual([]);
    // A scope with counters and no mark: the counters are not compared.
    expect(decide({ counters: [counters(a, { position: 1n })] })).toEqual([]);
  });

  test('a changed system id bumps every scope that has a mark or a counter row', () => {
    const bumps = decide({
      current: { systemId: 'restored', timeline: '1' },
      marks: [mark(a)],
      counters: [counters(a), counters(b, { position: 3n })],
    });
    expect(bumps.map((entry) => [entry.bump.scopeId, entry.bump.reason])).toEqual([
      [a, 'identity'],
      [b, 'identity'],
    ]);
  });

  test('a new timeline bumps every scope', () => {
    const [only] = decide({
      current: { systemId: 'system-1', timeline: '2' },
      marks: [mark(a)],
      counters: [counters(a)],
    });
    expect(only?.bump).toEqual({ scopeId: a, from: 0, to: 2, reason: 'timeline' });
  });

  test('a counter below its mark bumps', () => {
    const [only] = decide({ marks: [mark(a)], counters: [counters(a, { position: 4n })] });
    expect(only?.bump).toEqual({ scopeId: a, from: 0, to: 2, reason: 'counter' });
    // A mark with no counter row at all is below it too.
    expect(decide({ marks: [mark(a)] })[0]?.bump.reason).toBe('counter');
    expect(decide({ marks: [mark(a, { position: 0n })] })).toEqual([]);
  });

  test('a counter epoch below the mark epoch bumps: a backup from before an earlier bump', () => {
    const [only] = decide({
      marks: [mark(a, { epoch: 3 })],
      counters: [counters(a, { epoch: 2 })],
    });
    expect(only?.bump).toEqual({ scopeId: a, from: 3, to: 4, reason: 'counter' });
  });

  test('a counter epoch above the mark epoch bumps, with a restored mark or none', () => {
    // The control store was restored from before an earlier bump: the mark reads 0, the counter 2.
    const [restored] = decide({
      marks: [mark(a, { epoch: 0 })],
      counters: [counters(a, { epoch: 2 })],
    });
    expect(restored?.bump).toEqual({ scopeId: a, from: 0, to: 3, reason: 'counter' });
    // A fresh control store over a durable placement: no mark at all.
    const [fresh] = decide({ counters: [counters(a, { epoch: 2 })] });
    expect(fresh?.bump).toEqual({ scopeId: a, from: 0, to: 3, reason: 'counter' });
    expect(fresh?.raise.epoch).toBe(3);
    // The counter at the mark's epoch, or a first counter row at 1 under mark 0, is no signal.
    expect(
      decide({ marks: [mark(a, { epoch: 2 })], counters: [counters(a, { epoch: 2 })] }),
    ).toEqual([]);
    expect(decide({ marks: [mark(a)], counters: [counters(a, { epoch: 1 })] })).toEqual([]);
  });

  test('the target epoch is above the epoch another namespace holds for the scope', () => {
    // A scope that moved from another namespace at epoch 7 bumps to 8 here, not to 2.
    const [only] = decide({
      marks: [mark(a)],
      counters: [counters(a, { position: 4n })],
      epochs: [[a, 7]],
    });
    expect(only?.bump).toEqual({ scopeId: a, from: 0, to: 8, reason: 'counter' });
    expect(only?.mark.epoch).toBe(8);
  });

  test('a head below its anchor bumps without any mark', () => {
    const [only] = decide({ counters: [counters(a, { position: 5n })], anchors: [[a, 8n]] });
    expect(only?.bump).toEqual({ scopeId: a, from: 0, to: 2, reason: 'anchor' });
    expect(only?.raise.position).toBe(8n);
    expect(decide({ counters: [counters(a, { position: 8n })], anchors: [[a, 8n]] })).toEqual([]);
    // A scope with no counter row has head 0.
    expect(decide({ anchors: [[b, 3n]] })[0]?.bump.scopeId).toBe(b);
  });

  test('the target epoch is above the mark epoch and the counter epoch', () => {
    const bump = (m: number, c: number) =>
      decide({
        current: { systemId: 'x', timeline: '1' },
        marks: [mark(a, { epoch: m })],
        counters: [counters(a, { epoch: c })],
      })[0]?.bump.to;
    expect(bump(0, 1)).toBe(2);
    expect(bump(5, 1)).toBe(6);
    expect(bump(0, 7)).toBe(8);
  });

  test('counters rise to the highest of mark, anchor and counter, serial by serial', () => {
    const [only] = decide({
      marks: [mark(a, { position: 10n, serials: { s1: 5n, s2: 9n } })],
      counters: [counters(a, { position: 4n, serials: { s1: 7n, s3: 2n } })],
      anchors: [[a, 12n]],
    });
    expect(only?.raise).toEqual({
      scopeId: a,
      position: 12n,
      epoch: 2,
      serials: { s1: 7n, s2: 9n, s3: 2n },
    });
    expect(only?.mark).toMatchObject({
      scopeId: a,
      namespaceId,
      epoch: 2,
      position: 12n,
      serials: { s1: 7n, s2: 9n, s3: 2n },
      updatedAt: now,
    });
  });
});
