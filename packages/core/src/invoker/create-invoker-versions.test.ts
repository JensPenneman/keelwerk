import type { Tracer } from '@opentelemetry/api';
import { describe, expect, test } from 'vitest';
import {
  actionOf,
  callOf,
  carrier,
  invokerOf,
  registryOf,
  withResolver,
} from '../../test/invoker/invoker-kit.ts';
import { defineApiVersions } from '../dsl/define-api-versions.ts';
import type { InvocationDecision } from './decision-hook.ts';

const place = actionOf('doc.place', { auth: 'public' });
const change = {
  id: 'doc.placeRename',
  module: 'doc',
  key: 'placeRename',
  since: '1.0.0',
  surface: [{ action: 'doc.place', renamedFrom: 'doc.put' }],
  input: {},
  output: {},
  errors: {},
  fixtures: [],
};
const registry = withResolver(
  registryOf([place], { versionChanges: new Map([[change.id, change]]) as never }),
);
const api = defineApiVersions({
  '2026-10-01': {},
  '2026-11-01': { changes: ['doc.placeRename'] },
});

describe('an action requested under its older reference', () => {
  test('the log, the span and the decision hook record the head reference', async () => {
    const bindings: Record<string, unknown>[] = [];
    const attributes: Record<string, unknown> = {};
    const log = {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      child: (own: Record<string, unknown>) => {
        bindings.push(own);
        return log;
      },
    };
    const span = {
      setStatus: () => span,
      setAttribute: (key: string, value: unknown) => {
        attributes[key] = value;
        return span;
      },
      setAttributes: (own: Record<string, unknown>) => {
        Object.assign(attributes, own);
        return span;
      },
      end: () => undefined,
    };
    const tracer = { startSpan: () => span } as unknown as Tracer;
    const decisions: InvocationDecision[] = [];
    const app = { registry, head: '2026-11-01', api };
    const invoker = invokerOf(registry, {
      apps: new Map([
        ['doc', app],
        ['core', app],
      ]),
      log,
      tracer,
      onDecision: (decision) => decisions.push(decision),
    });
    const older = { ...carrier, headers: { ...carrier.headers, 'keelwerk-version': '2026-10-01' } };
    await invoker.invoke(callOf('doc.put', { n: 1 }, { carrier: older }));
    expect(decisions.map((decision) => decision.action)).toEqual(['doc.place']);
    expect(bindings.at(-1)).toMatchObject({ action: 'doc.place' });
    expect(attributes).toMatchObject({
      'keelwerk.action': 'doc.place',
      'keelwerk.action.requested': 'doc.put',
    });
  });
});
