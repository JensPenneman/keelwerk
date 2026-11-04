import type { ApiSurface, FieldNode } from '@keelwerk/core';
import { describe, expect, it } from 'vitest';
import { createRemoteClient } from '../src/index.ts';
import { probeSurface } from './support/probe-surface.ts';

const base = { optional: false, access: 'read-write' } as const;
const optional = { optional: true, access: 'read-write' } as const;

function shape(fields: Record<string, FieldNode>, flags: typeof base | typeof optional = base) {
  return { ...flags, kind: 'shape', fields } satisfies FieldNode;
}

function surface(): ApiSurface {
  const template = probeSurface().actions[0];
  if (template === undefined) throw new Error('the probe surface has no action');
  const command = (ref: string, input: FieldNode) => ({
    ...template,
    ref,
    name: ref,
    kind: 'command' as const,
    execution: 'sync' as const,
    input,
    output: { ...base, kind: 'void' } satisfies FieldNode,
  });
  return {
    ...probeSurface(),
    actions: [
      command(
        'shop.update',
        shape({
          patch: shape({
            subtitle: { ...optional, kind: 'string' },
            tags: { ...optional, kind: 'set', item: { ...base, kind: 'string' } },
            stock: { ...optional, kind: 'integer', wide: true },
            seen: { ...optional, kind: 'instant' },
          }),
        }),
      ),
      command('shop.day', shape({ on: { ...base, kind: 'date' } })),
    ],
  };
}

function setup() {
  const bodies: unknown[] = [];
  const send: typeof fetch = (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  const client = createRemoteClient<never>({
    url: 'https://shop.example',
    apiVersion: '2026-11-01',
    fetch: send,
    surface: surface(),
  });
  return { bodies, client: client as unknown as UntypedClient };
}

interface UntypedClient {
  invoke(ref: string, input: unknown): Promise<unknown>;
  attempt(
    ref: string,
    input: unknown,
  ): Promise<{ readonly ok: boolean; readonly error?: { readonly code: string } }>;
}

describe('patch inputs', () => {
  it('sends null for a cleared optional member', async () => {
    const { bodies, client } = setup();
    await client.invoke('shop.update', { patch: { subtitle: null } });
    expect(bodies[0]).toMatchObject({ input: { patch: { subtitle: null } } });
  });

  it('sends set and counter operations, encoding their items', async () => {
    const { bodies, client } = setup();
    await client.invoke('shop.update', {
      patch: {
        tags: { add: ['x'], remove: new Set(['y']) },
        stock: { inc: 9007199254740993n },
        seen: Temporal.Instant.from('2030-01-01T00:00:00Z'),
      },
    });
    expect(bodies[0]).toMatchObject({
      input: {
        patch: {
          tags: { add: ['x'], remove: ['y'] },
          stock: { inc: '9007199254740993' },
          seen: '2030-01-01T00:00:00.000Z',
        },
      },
    });
  });

  it('turns any encoding error into core.validation', async () => {
    const { bodies, client } = setup();
    const result = await client.attempt('shop.day', {
      on: Temporal.PlainDate.from('+010000-01-01'),
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'core.validation' } });
    expect(bodies).toHaveLength(0);
  });
});
