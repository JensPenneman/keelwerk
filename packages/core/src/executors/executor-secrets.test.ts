import { describe, expect, test } from 'vitest';
import { type LoggedLine, recordingLogger } from '../../test/executor-kit.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { KeyService } from '../kernel/key-service.ts';
import { secretRefOwner } from '../keys/secret-ref-owner.ts';
import type { Scope } from '../storage/scope.ts';
import type { Unit } from '../storage/unit.ts';
import { executorSecrets } from './executor-secrets.ts';

const backendId = '0198a1e0-0000-7000-8000-0000000000b1';
const scope: Scope = { level: 'backend', backendId };
const valueText = 'kwv1.key1.bm9uY2U.Y2lwaGVy';
const configText = `kwc1.${backendId}.hooks.signingKey.1.bm9uY2U.Y2lwaGVy`;
const schema = shape({
  url: field.string(),
  signingKey: field.secret(),
  more: field.list(field.secret()),
});

function stamped(text: string, module: string): { readonly ref: string } {
  const ref = { ref: text };
  Object.defineProperty(ref, secretRefOwner, { value: module });
  return ref;
}

const configShape = shape({ signingKey: field.secret(), region: field.string() });

function secrets(
  input: Record<string, unknown>,
  options: {
    backend?: string;
    module?: string;
    config?: Record<string, unknown>;
    signal?: AbortSignal;
  } = {},
) {
  const lines: LoggedLine[] = [];
  const revealed: { ref: string; reason: string }[] = [];
  const bindings: unknown[] = [];
  const keys = {
    reveal: (_unit: Unit, ref: { ref: string }, reason: string, expected?: unknown) => {
      revealed.push({ ref: ref.ref, reason });
      bindings.push(expected);
      return Promise.resolve('plain-key');
    },
  } as unknown as KeyService;
  return {
    lines,
    revealed,
    bindings,
    secrets: executorSecrets({
      keys,
      open: (fn) => fn({} as Unit),
      module: options.module ?? 'hooks',
      scope:
        options.backend === undefined ? scope : { level: 'backend', backendId: options.backend },
      schema,
      input,
      ...(options.config === undefined
        ? {}
        : { config: { value: options.config, shape: configShape } }),
      effectId: 'eff-1',
      log: recordingLogger(lines),
      signal: options.signal ?? new AbortController().signal,
    }),
  };
}

const refused = { kind: 'internal', code: 'core.request_not_allowed' };

describe('executorSecrets.reveal', () => {
  test('a stamped member of the input opens and logs the reason with the effect', async () => {
    const member = stamped(valueText, 'hooks');
    const { secrets: ctx, revealed, lines } = secrets({ url: 'u', signingKey: member });
    expect(await ctx.reveal(member as never, 'sign an outbound webhook')).toBe('plain-key');
    expect(revealed).toEqual([{ ref: valueText, reason: 'sign an outbound webhook' }]);
    expect(lines).toContainEqual({
      level: 'info',
      message: 'executor reveal',
      fields: { effect: 'eff-1', reason: 'sign an outbound webhook' },
    });
  });

  test('an element of a list of secrets opens too', async () => {
    const member = stamped(valueText, 'hooks');
    const { secrets: ctx } = secrets({ more: [member] });
    expect(await ctx.reveal(member as never, 'sign')).toBe('plain-key');
  });

  test('a reference that is unstamped, plain, or stamped for another module is refused', async () => {
    const { secrets: ctx, revealed } = secrets({ signingKey: stamped(valueText, 'hooks') });
    await expect(ctx.reveal({ ref: valueText } as never, 'sign')).rejects.toMatchObject(refused);
    await expect(ctx.reveal(valueText as never, 'sign')).rejects.toMatchObject(refused);
    await expect(ctx.reveal(stamped(valueText, 'courier') as never, 'sign')).rejects.toMatchObject(
      refused,
    );
    expect(revealed).toEqual([]);
  });

  test('a text that is not in the input is refused, though stamped for the module', async () => {
    const { secrets: ctx, revealed } = secrets({ signingKey: stamped(valueText, 'hooks') });
    const other = stamped('kwv1.key2.bm9uY2U.Y2lwaGVy', 'hooks');
    await expect(ctx.reveal(other as never, 'sign')).rejects.toMatchObject(refused);
    expect(revealed).toEqual([]);
  });

  test('a configuration secret opens for its module and backend only', async () => {
    const own = stamped(configText, 'hooks');
    const { secrets: ctx } = secrets({ signingKey: own });
    expect(await ctx.reveal(own as never, 'sign')).toBe('plain-key');

    const foreignModule = stamped(configText.replace('.hooks.', '.courier.'), 'hooks');
    await expect(
      secrets({ signingKey: foreignModule }).secrets.reveal(foreignModule as never, 'sign'),
    ).rejects.toMatchObject(refused);

    await expect(
      secrets(
        { signingKey: own },
        { backend: '0198a1e0-0000-7000-8000-0000000000b2' },
      ).secrets.reveal(own as never, 'sign'),
    ).rejects.toMatchObject(refused);
  });

  test("the module's own configuration secret, handed over as ctx.config, opens without being an input member", async () => {
    const own = stamped(configText, 'hooks');
    const { secrets: ctx, revealed } = secrets(
      { url: 'u' },
      { config: { signingKey: own, region: 'eu' } },
    );
    expect(await ctx.reveal(own as never, 'sign')).toBe('plain-key');
    expect(revealed).toEqual([{ ref: configText, reason: 'sign' }]);
  });

  test('a configuration secret of another backend is refused even when it sits in the configuration', async () => {
    const foreign = stamped(
      configText.replace(backendId, '0198a1e0-0000-7000-8000-0000000000b2'),
      'hooks',
    );
    const { secrets: ctx, revealed } = secrets(
      { url: 'u' },
      { config: { signingKey: foreign, region: 'eu' } },
    );
    await expect(ctx.reveal(foreign as never, 'sign')).rejects.toMatchObject(refused);
    expect(revealed).toEqual([]);
  });

  test('an empty reason is refused', async () => {
    const member = stamped(valueText, 'hooks');
    const { secrets: ctx, revealed } = secrets({ signingKey: member });
    await expect(ctx.reveal(member as never, '')).rejects.toMatchObject(refused);
    await expect(ctx.reveal(member as never, '  ')).rejects.toMatchObject(refused);
    expect(revealed).toEqual([]);
  });

  test('the context offers neither issue nor verify', () => {
    const { secrets: ctx } = secrets({});
    expect(Object.keys(ctx)).toEqual(['reveal']);
  });

  test('a sealed value is opened for the binding it was sealed for: the effect, its id and the member', async () => {
    const member = stamped(valueText, 'hooks');
    const listed = stamped('kwv1.key3.bm9uY2U.Y2lwaGVy', 'hooks');
    const { secrets: ctx, bindings } = secrets({ signingKey: member, more: [listed] });
    await ctx.reveal(member as never, 'sign');
    await ctx.reveal(listed as never, 'sign');
    expect(bindings).toEqual([
      { entity: 'core.effect', id: 'eff-1', field: 'signingKey' },
      { entity: 'core.effect', id: 'eff-1', field: 'more' },
    ]);
  });

  test('a configuration secret carries no effect binding', async () => {
    const own = stamped(configText, 'hooks');
    const { secrets: ctx, bindings } = secrets({ signingKey: own });
    await ctx.reveal(own as never, 'sign');
    expect(bindings).toEqual([undefined]);
  });

  test('a refusal names the input and the configuration of the module', async () => {
    const { secrets: ctx } = secrets({});
    await expect(ctx.reveal(stamped(valueText, 'hooks') as never, 'sign')).rejects.toMatchObject({
      message: expect.stringContaining("module's configuration"),
    });
  });

  test('nothing is revealed once the attempt has ended', async () => {
    const attempt = new AbortController();
    const member = stamped(valueText, 'hooks');
    const { secrets: ctx, revealed } = secrets({ signingKey: member }, { signal: attempt.signal });
    attempt.abort(new Error('the attempt ended'));
    await expect(ctx.reveal(member as never, 'sign')).rejects.toThrow('the attempt ended');
    expect(revealed).toEqual([]);
  });
});
