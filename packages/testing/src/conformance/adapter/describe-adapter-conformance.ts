import type {
  AdapterCapabilities,
  DataAdapter,
  StorageScope,
  Unit,
  UnitOptions,
} from '@keelwerk/core';
import { conformanceEntities } from '@keelwerk/data/conformance';
import { afterAll, beforeAll, beforeEach, describe } from 'vitest';
import type { AdapterConformanceOptions } from './adapter-conformance-options.ts';
import { capabilityHonestyCases } from './capability-honesty-cases.ts';
import { codecCases } from './codec-cases.ts';
import { conditionCases } from './condition-cases.ts';
import type { ConformanceSubject } from './conformance-subject.ts';
import type { ConformanceTarget } from './conformance-target.ts';
import { consumerCases } from './consumer-cases.ts';
import { encryptedQueryCases } from './encrypted-query-cases.ts';
import { eventStoreCases } from './event-store-cases.ts';
import { jobStoreCases } from './job-store-cases.ts';
import { migrationCases } from './migration-cases.ts';
import { paginationCases } from './pagination-cases.ts';
import { rowCases } from './row-cases.ts';
import { rowIsolationCases } from './row-isolation-cases.ts';
import { serialCases } from './serial-cases.ts';
import { storeCases } from './store-cases.ts';
import { storeIsolationCases } from './store-isolation-cases.ts';
import { streamRecordCases } from './stream-record-cases.ts';
import { timeoutCases } from './timeout-cases.ts';
import { toggleRebuildCases } from './toggle-rebuild-cases.ts';
import { unitCases } from './unit-cases.ts';

/**
 * Registers the adapter conformance suites (14.10) for one adapter: opens it once through the
 * factory, empties it before each case, and runs every scenario against it. The scenarios that
 * need real connections run only when `networked` is set.
 */
export function describeAdapterConformance(options: AdapterConformanceOptions): void {
  describe(`adapter conformance: ${options.name}`, () => {
    let target: ConformanceTarget | undefined;
    let capabilities: AdapterCapabilities | undefined;
    let connected: DataAdapter | undefined;
    const current = (): ConformanceTarget => {
      if (target === undefined) throw new Error('the conformance target is used outside a case');
      return target;
    };
    beforeAll(async () => {
      target = await options.factory(Object.values(conformanceEntities));
      capabilities = await target.adapter.connect();
      connected = target.adapter;
    }, 180_000);
    beforeEach(async () => {
      await current().reset();
      const { adapter } = current();
      if (adapter !== connected) {
        capabilities = await adapter.connect();
        connected = adapter;
      }
    }, 60_000);
    afterAll(async () => {
      await target?.close();
    }, 60_000);

    const unit = (scope: StorageScope, readOnly: boolean) =>
      async function open<T>(
        fn: (unit: Unit) => Promise<T>,
        unitOptions: UnitOptions = {},
      ): Promise<T> {
        const { adapter, namespace } = current();
        return adapter.unit(namespace, scope, fn, {
          ...unitOptions,
          ...(readOnly ? { readOnly } : {}),
        });
      };
    const subject: ConformanceSubject = {
      name: options.name,
      placement: options.placement,
      networked: options.networked,
      deploymentId: options.deploymentId,
      get clock() {
        return current().clock;
      },
      adapter: () => current().adapter,
      namespace: () => current().namespace,
      capabilities: () => {
        if (capabilities === undefined) throw new Error('the adapter is not connected');
        return capabilities;
      },
      run: (scope, fn, unitOptions) => unit(scope, false)(fn, unitOptions),
      read: (scope, fn) => unit(scope, true)(fn),
    };

    describe('codecs', () => codecCases(subject));
    describe('conditions', () => conditionCases(subject));
    describe('pagination', () => paginationCases(subject));
    describe('units', () => unitCases(subject));
    describe('timeouts', () => timeoutCases(subject));
    describe('rows', () => rowCases(subject));
    describe('stores', () => storeCases(subject));
    describe('row isolation', () => rowIsolationCases(subject));
    describe('store isolation', () => storeIsolationCases(subject));
    describe('event store', () => eventStoreCases(subject));
    describe('job store', () => jobStoreCases(subject));
    describe('consumers', () => consumerCases(subject));
    describe('serials', () => serialCases(subject));
    describe('stream records', () => streamRecordCases(subject));
    describe('migrations', () => migrationCases(subject));
    describe('toggle then rebuild', () => toggleRebuildCases(subject));
    describe('capability honesty', () => capabilityHonestyCases(subject));
    describe('encrypted queries', () => encryptedQueryCases(subject));
  });
}
