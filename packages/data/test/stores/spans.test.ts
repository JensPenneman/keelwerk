import type { Span, Tracer } from '@keelwerk/core';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  type PgliteAdapter,
  pgliteAdapter,
  provisionApplicationRole,
} from '../../src/pglite/index.ts';
import { frameworkTablesDdl } from '../../src/sql/postgres/framework-tables.ts';
import { deployment } from '../support/deployment.ts';
import { namespaceRef } from '../support/namespace-ref.ts';
import { tenantScope } from '../support/tenant-scope.ts';

interface Recorded {
  readonly name: string;
  readonly attributes: unknown;
  ended: boolean;
  failed: boolean;
}

function recordingTracer(spans: Recorded[]): Tracer {
  const startActiveSpan = (
    name: string,
    options: { attributes?: unknown },
    run: (span: Span) => unknown,
  ) => {
    const recorded: Recorded = {
      name,
      attributes: options.attributes,
      ended: false,
      failed: false,
    };
    spans.push(recorded);
    const span = {
      recordException: () => {
        recorded.failed = true;
      },
      setStatus: () => undefined,
      end: () => {
        recorded.ended = true;
      },
    } as unknown as Span;
    return run(span);
  };
  return { startActiveSpan } as unknown as Tracer;
}

const spans: Recorded[] = [];
let adapter: PgliteAdapter;

beforeAll(async () => {
  adapter = pgliteAdapter({ deploymentId: deployment, tracer: recordingTracer(spans) });
  await adapter.connect();
  await adapter.asOwner(async (database) => {
    for (const statement of frameworkTablesDdl('app')) await database.query(statement);
    await provisionApplicationRole(database, { root: 'app', role: 'kw_app' });
  });
}, 60_000);

afterAll(async () => {
  await adapter?.close(1000);
});

test('every unit runs in a span that ends, and a failing unit marks it', async () => {
  await adapter.unit(namespaceRef, tenantScope, async () => undefined, { readOnly: true });
  await adapter
    .unit(namespaceRef, tenantScope, async () => {
      throw new Error('boom');
    })
    .catch(() => undefined);
  expect(spans.map((span) => [span.name, span.ended, span.failed])).toEqual([
    ['keelwerk.unit', true, false],
    ['keelwerk.unit', true, true],
  ]);
  expect(spans[0]?.attributes).toEqual({
    'keelwerk.scope.level': 'tenant',
    'keelwerk.unit.read_only': true,
  });
});
