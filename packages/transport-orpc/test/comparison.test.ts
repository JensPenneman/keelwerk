import { deriveSurface, toJsonSchema } from '@keelwerk/core';
import { emitOpenapi } from '@keelwerk/transport-rest';
import { describe, expect, test } from 'vitest';
import { orpcOpenapiDocument } from '../src/openapi/orpc-openapi-document.ts';
import { orpcFrameJsonSchema } from '../src/router/orpc-frame-json-schema.ts';
import { orpcPathOf } from '../src/router/orpc-path-of.ts';
import { compareOpenapi } from './support/compare-openapi.ts';
import { orpcConformanceApp, orpcConformanceVersions } from './support/orpc-conformance-app.ts';

const surface = deriveSurface(orpcConformanceApp as never, orpcConformanceVersions.head).surface;
const own: unknown = emitOpenapi(surface);
const orpc = await orpcOpenapiDocument(surface);
const comparison = compareOpenapi(surface, own, orpc);

describe('the two OpenAPI documents of the oRPC conformance app', () => {
  test('the measured comparison equals the committed comparison.json', async () => {
    await expect(`${JSON.stringify(comparison, null, 2)}\n`).toMatchFileSnapshot(
      './generated/orpc/orpc-conformance/comparison.json',
    );
  });

  test('the oRPC document is OpenAPI 3.1.1 with one operation per procedure', () => {
    expect(orpc.openapi).toBe('3.1.1');
    const operationIds = Object.values(JSON.parse(JSON.stringify(orpc.paths ?? {})) as object)
      .flatMap((item: object) => Object.values(item) as { operationId?: string }[])
      .map((operation) => operation.operationId)
      .sort();
    expect(operationIds).toEqual(
      surface.actions.map((action) => orpcPathOf(action).join('.')).sort(),
    );
    expect(comparison.orpc.operations).toBe(surface.actions.length);
    expect(comparison.actions).toBe(surface.actions.length);
  });

  test('the own document carries application/problem+json and the oRPC one does not', () => {
    expect(comparison.own.problemDetails.errorMediaTypes).toContain('application/problem+json');
    expect(comparison.orpc.problemDetails.errorMediaTypes).not.toContain(
      'application/problem+json',
    );
    expect(comparison.own.executionModes.receiptSchema).toBe(true);
    expect(comparison.own.executionModes.acceptedResponses).toBeGreaterThan(0);
    expect(comparison.orpc.executionModes.acceptedResponses).toBe(0);
    expect(comparison.orpc.executionModes.idempotencyKeyHeader).toBe(0);
  });

  test('a subscription documents its frames, not the bare event', () => {
    const action = surface.actions.find((candidate) => candidate.ref === 'loans.loanEvents');
    if (action === undefined) throw new Error('The surface has no loans.loanEvents.');
    const document = JSON.parse(JSON.stringify(orpc)) as {
      paths: Record<
        string,
        {
          post: {
            responses: Record<
              string,
              {
                content?: Record<
                  string,
                  { schema: { oneOf: { properties: { event: unknown; data?: unknown } }[] } }
                >;
              }
            >;
          };
        }
      >;
    };
    const stream = document.paths['/loans/loanEvents']?.post.responses['200']?.content?.[
      'text/event-stream'
    ]?.schema.oneOf.find(
      (branch) => JSON.stringify(branch.properties.event) === JSON.stringify({ const: 'message' }),
    );
    expect(stream?.properties.data).toEqual(
      orpcFrameJsonSchema(toJsonSchema(action.output, { direction: 'output' })),
    );
  });
});
