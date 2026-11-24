import type { ControlLease, ControlLeaseStore, NamespaceRef, Unit } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import type { ConformanceClock } from './conformance-clock.ts';
import type { ConformanceSubject } from './conformance-subject.ts';

const { deployment } = conformanceScopes;
const kinds: readonly ControlLease['kind'][] = [
  'topic',
  'subscriptions',
  'connections',
  'invocations',
];

const ttlMs = 10_000;

function leasesOf(unit: Unit): ControlLeaseStore {
  if (unit.leases === undefined) throw new Error('the deployment unit has no lease store');
  return unit.leases;
}

/** What the lease cases share: the control namespace of the subject, its clock and the calls on the lease store. */
export interface LeaseHarness {
  /** The time to live the cases hold their leases for. */
  readonly ttlMs: number;
  readonly clock: () => ConformanceClock;
  readonly run: <T>(fn: (leases: ControlLeaseStore) => Promise<T>) => Promise<T>;
  readonly read: <T>(fn: (leases: ControlLeaseStore) => Promise<T>) => Promise<T>;
  readonly hold: (
    kind: ControlLease['kind'],
    key: string,
    holder: string,
    units: number,
    scopeId?: string | null,
  ) => Promise<{ readonly total: number }>;
  readonly fresh: () => string;
  /** Provisions the control namespace and expires every lease an earlier case left. */
  readonly reset: () => Promise<void>;
}

/**
 * The lease store: `kw_leases` (S-120) lives in the control store's root only, so the cases run in
 * a namespace of that root, provisioned here beside the subject's own. The root outlives a reset
 * of the subject's schema, so each case first expires every lease an earlier case left.
 */
export function leaseHarness(subject: ConformanceSubject): LeaseHarness {
  const control = (): NamespaceRef => ({
    ...subject.namespace(),
    id: 'ns-conformance-leases',
    root: 'kw__control',
  });
  const clock = (): ConformanceClock => {
    if (subject.clock === undefined) throw new Error('the target has no movable clock');
    return subject.clock;
  };
  const run: LeaseHarness['run'] = (fn) =>
    subject.adapter().unit(control(), deployment, (unit) => fn(leasesOf(unit)));
  const read: LeaseHarness['read'] = (fn) =>
    subject.adapter().unit(control(), deployment, (unit) => fn(leasesOf(unit)), {
      readOnly: true,
    });
  return {
    ttlMs,
    clock,
    run,
    read,
    hold: (kind, key, holder, units, scopeId = null) =>
      run((leases) => leases.hold({ kind, scopeId, key, holder, units }, ttlMs)),
    fresh: () => `key-${crypto.randomUUID()}`,
    reset: async () => {
      await subject.adapter().schema.provision(control(), []);
      clock().advance(120_000);
      for (const kind of kinds) {
        for (;;) {
          const gone = await run((leases) => leases.expire(kind, 1_000));
          if (gone.length === 0) break;
        }
      }
    },
  };
}
