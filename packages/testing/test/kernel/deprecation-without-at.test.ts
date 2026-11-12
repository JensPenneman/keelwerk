import {
  defineApp,
  defineModule,
  defineModuleBase,
  defineQuery,
  defineRule,
  field,
  type ModuleBaseType,
  type ModuleType,
  shape,
} from '@keelwerk/core';
import { httpHost } from '@keelwerk/transport-http';
import { rest } from '@keelwerk/transport-rest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testPrincipalHeader } from '../../src/harness/test-principal-header.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';

interface PingsBase extends ModuleBaseType<typeof pingsBaseDef> {}
const pingsBaseDef = defineModuleBase({ id: 'pings', version: '1.0.0' });
const pingsBase: PingsBase = pingsBaseDef;

const output = shape({ pong: field.boolean() });
/** Deprecated with a reason only: in force from its declaration, no date. */
const undated = defineQuery(pingsBase, {
  principal: 'user',
  output,
  deprecated: { reason: 'Use ping.' },
  read: () => ({ pong: true }),
});
/** The same with a declared sunset. */
const withSunset = defineQuery(pingsBase, {
  principal: 'user',
  output,
  deprecated: { reason: 'Use ping.', sunset: '2026-12-31' },
  read: () => ({ pong: true }),
});

const pingsDef = defineModule(pingsBase, {
  actions: { undated, withSunset },
  policies: {
    undated: { users: defineRule(pingsBase, undated, { effect: 'allow', principal: 'user' }) },
    withSunset: {
      users: defineRule(pingsBase, withSunset, { effect: 'allow', principal: 'user' }),
    },
  },
});
interface Pings extends ModuleType<typeof pingsDef> {}
const pings: Pings = pingsDef;

const app = defineApp({ id: 'undated-deprecation', modules: [rest, pings] });
const url = 'https://undated.example.test';

let runtime: TestRuntime<typeof app>;
beforeAll(async () => {
  runtime = await startTestRuntime(app, {
    host: httpHost(),
    config: { rest: { docs: false, cors: [] } },
  });
});
afterAll(() => runtime.stop());

function send(path: string, body?: unknown): Promise<Response> {
  return runtime.fetch(
    new Request(`${url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant': runtime.tenants.acme?.id ?? '',
        [testPrincipalHeader]: JSON.stringify({ subject: 'ada', roles: [], claims: {} }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

const linkOf = (response: Response): string => response.headers.get('link') ?? '';

describe('an action deprecated without at is in force from its declaration (section 18.5)', () => {
  test('REST and POST /invoke answer the same: the Link, Sunset when declared, never a Deprecation header', async () => {
    for (const [name, route, sunset] of [
      ['undated', 'undated', null],
      ['withSunset', 'with-sunset', 'Fri, 01 Jan 2027 00:00:00 GMT'],
    ] as const) {
      const viaRest = await send(`/api/pings/${route}`);
      const viaInvoke = await send('/_keelwerk/v1/invoke', { action: `pings.${name}`, input: {} });
      expect(viaRest.status, `REST ${name}`).toBe(200);
      expect(viaInvoke.status, `invoke ${name}`).toBe(200);
      for (const response of [viaRest, viaInvoke]) {
        expect(response.headers.has('deprecation')).toBe(false);
        expect(response.headers.get('sunset')).toBe(sunset);
        expect(linkOf(response)).toContain('rel="deprecation"');
        expect(linkOf(response)).not.toContain('/_keelwerk/v1/capabilities');
      }
    }
  });
});
