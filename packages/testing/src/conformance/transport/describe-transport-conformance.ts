import { describe } from 'vitest';
import { browserCases } from './browser-cases.ts';
import { concurrencyCases } from './concurrency-cases.ts';
import { errorCases } from './error-cases.ts';
import { idempotencyCases } from './idempotency-cases.ts';
import { instanceCases } from './instance-cases.ts';
import { m2Cases } from './m2-cases.ts';
import { maskCases } from './mask-cases.ts';
import { paginationCases } from './pagination-cases.ts';
import { preconditionCases } from './precondition-cases.ts';
import { receiptCases } from './receipt-cases.ts';
import type { TransportTarget } from './transport-target.ts';
import { valueCases } from './value-cases.ts';

/**
 * The transport conformance suite (16.8.5, S-52): the full fixture app through one transport. The
 * caller boots the deployment (`startTransportRuntime`) and passes the host's `fetch` and the
 * transport's codec; every scenario asserts the decoded outcome that the other transport must
 * produce too, so running the suite once per codec proves the transports agree.
 */
export function describeTransportConformance(target: TransportTarget): void {
  describe(`transport conformance: ${target.name}`, () => {
    describe('values', () => valueCases(target));
    describe('errors', () => errorCases(target));
    describe('pagination', () => paginationCases(target));
    describe('instance commands', () => instanceCases(target));
    describe('masks', () => maskCases(target));
    describe('receipts', () => receiptCases(target));
    describe('idempotency', () => idempotencyCases(target));
    describe('concurrency', () => concurrencyCases(target));
    describe('preconditions', () => preconditionCases(target));
    describe('browser', () => browserCases(target));
    m2Cases(target);
  });
}
