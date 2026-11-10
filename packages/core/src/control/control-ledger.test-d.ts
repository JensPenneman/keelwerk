import { expectTypeOf, test } from 'vitest';
import type { LedgerRecord } from '../kernel/ledger-record.ts';
import type { ScopeEpoch } from '../storage/scope-epoch.ts';
import type { ControlLease } from './control-lease.ts';
import type { ControlLeaseStore } from './control-lease-store.ts';
import type { ControlLedger } from './control-ledger.ts';
import type { EpochBump } from './epoch-bump.ts';
import type { NamespaceIdentity } from './namespace-identity.ts';
import type { ScopeMark } from './scope-mark.ts';

test('ScopeMark extends ScopeEpoch', () => {
  expectTypeOf<ScopeMark>().toExtend<ScopeEpoch>();
});

test('ControlLeaseStore.hold takes a lease without its expiry', () => {
  expectTypeOf<Parameters<ControlLeaseStore['hold']>[0]>().toEqualTypeOf<
    Omit<ControlLease, 'expiresAt'>
  >();
});

test('ControlLedger.since answers sequenced ledger records', () => {
  expectTypeOf<Awaited<ReturnType<ControlLedger['since']>>>().toEqualTypeOf<
    readonly { readonly seq: bigint; readonly record: LedgerRecord }[]
  >();
});

test('EpochBump.reason is closed', () => {
  expectTypeOf<EpochBump['reason']>().toEqualTypeOf<
    'identity' | 'timeline' | 'counter' | 'anchor'
  >();
});

test('NamespaceIdentity records its time as an instant', () => {
  expectTypeOf<NamespaceIdentity['recordedAt']>().toEqualTypeOf<Temporal.Instant>();
});
