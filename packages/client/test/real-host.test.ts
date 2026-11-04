import type { Invoker, Logger, Outcome, Telemetry } from '@keelwerk/core';
import { KeelwerkError } from '@keelwerk/core';
import { httpHost } from '@keelwerk/transport-http';
import { describe, expect, it } from 'vitest';
import { createRemoteClient } from '../src/index.ts';
import type { ProbeApp } from './support/probe-app.ts';
import { probeSurface } from './support/probe-surface.ts';

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent };

describe('the client over the real http host', () => {
  it('reads the surface, invokes with the echoed command id and gets an error envelope', async () => {
    const commandIds: (string | undefined)[] = [];
    const session = {
      scope: { level: 'tenant', backendId: 'b1', tenantId: 't1' },
      app: 'shop',
      principal: {
        kind: 'anonymous',
        scope: { backend: null, tenant: null },
        claims: {},
        roles: [],
        memberships: [],
        via: 'none',
        ref: null,
      },
      apiVersion: '2026-11-01',
      deprecation: null,
      resolvedBy: 'hostname',
      revalidate: async () => ({ ok: true, value: session }),
    } as const;
    const invoker = {
      open: async () => ({ ok: true, value: session }),
      invoke: async (invocation: {
        action: string;
        commandId?: string;
      }): Promise<Outcome<unknown>> => {
        commandIds.push(invocation.commandId);
        if (invocation.action === 'shop.cancelAll') {
          return {
            ok: false,
            error: new KeelwerkError({ kind: 'conflict', code: 'core.conflict', message: 'busy' }),
          };
        }
        return { ok: true, value: undefined };
      },
      subscribe() {
        throw new Error('no live');
      },
    } as unknown as Invoker;
    const instrument = () => ({ add() {}, record() {} });
    const telemetry = {
      tracer: {
        startSpan: () => ({
          updateName() {},
          setAttributes() {},
          setStatus() {},
          end() {},
        }),
      },
      meter: {
        createHistogram: instrument,
        createUpDownCounter: instrument,
        createCounter: instrument,
      },
    } as unknown as Telemetry;
    const host = httpHost({}).create({
      surface: () => probeSurface(),
      log: silent,
      invoker,
      telemetry,
    });
    const client = createRemoteClient<ProbeApp>({
      url: 'https://shop.example',
      apiVersion: '2026-11-01',
      fetch: (input, init) => host.fetch(new Request(input, init)),
    });
    expect((await client.surface()).app).toBe(probeSurface().app);
    await expect(client.invoke('shop.ping', undefined)).resolves.toBeUndefined();
    expect(commandIds[0]).toMatch(/^[0-9a-f-]{36}$/);
    const failed = await client.attempt('shop.cancelAll', {});
    expect(failed).toMatchObject({ ok: false, error: { kind: 'conflict', code: 'core.conflict' } });
  });
});
