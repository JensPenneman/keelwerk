import { describe, expect, test } from 'vitest';
import { envFlagProvider } from './env-flag-provider.ts';
import type { FlagContext } from './flag-context.ts';
import type { FlagSpec } from './flag-spec.ts';

const context: FlagContext = {
  scope: { level: 'deployment' },
  principal: { kind: 'anonymous', id: null, roles: [] },
  attributes: {},
  targetingKey: null,
};
/** An environment of the given variables; the names are not camel case, so they go in as data. */
function variables(...pairs: readonly (readonly [string, string])[]): Record<string, string> {
  return Object.fromEntries(pairs);
}
const newFlow: FlagSpec<boolean> = {
  key: 'library.newFlow',
  kind: 'boolean',
  level: 'tenant',
  default: false,
};

describe('envFlagProvider', () => {
  test('KEELWERK_FLAG_LIBRARY_NEW_FLOW=true answers true with STATIC', () => {
    const provider = envFlagProvider(variables(['KEELWERK_FLAG_LIBRARY_NEW_FLOW', 'true']));
    expect(provider.resolve(newFlow, context)).toEqual({
      value: true,
      variant: 'true',
      reason: 'STATIC',
      provider: 'env',
    });
  });

  test('kebab module ids and camel flag names map to upper snake case', () => {
    const provider = envFlagProvider(variables(['KEELWERK_FLAG_MAIL_STORE_SEND_LATER', 'false']));
    const sendLater: FlagSpec<boolean> = { ...newFlow, key: 'mail-store.sendLater', default: true };
    expect(provider.resolve(sendLater, context)).toMatchObject({ value: false });
  });

  test('an unset variable passes the flag on', () => {
    expect(envFlagProvider({}).resolve(newFlow, context)).toBeUndefined();
    expect(
      envFlagProvider(variables(['KEELWERK_FLAG_LIBRARY_NEW_FLOW', ''])).resolve(newFlow, context),
    ).toBeUndefined();
  });

  test('an unparsable value answers PARSE_ERROR', () => {
    const provider = envFlagProvider(variables(['KEELWERK_FLAG_LIBRARY_NEW_FLOW', 'yes']));
    expect(provider.resolve(newFlow, context)).toMatchObject({
      value: false,
      reason: 'ERROR',
      errorCode: 'PARSE_ERROR',
      provider: 'env',
    });
  });

  test('numbers, strings, variants and json parse by the kind of the flag', () => {
    const provider = envFlagProvider(
      variables(
        ['KEELWERK_FLAG_SHOP_LIMIT', '25'],
        ['KEELWERK_FLAG_SHOP_BANNER', 'hello'],
        ['KEELWERK_FLAG_SHOP_THEME', 'dark'],
        ['KEELWERK_FLAG_SHOP_OTHER_THEME', 'blue'],
        ['KEELWERK_FLAG_SHOP_LAYOUT', '{"columns":3}'],
      ),
    );
    const of = (name: string, rest: object): FlagSpec =>
      ({ key: `shop.${name}`, level: 'tenant', ...rest }) as FlagSpec;
    expect(provider.resolve(of('limit', { kind: 'number', default: 1 }), context)).toMatchObject({
      value: 25,
      variant: '25',
    });
    expect(provider.resolve(of('banner', { kind: 'string', default: '' }), context)).toMatchObject({
      value: 'hello',
    });
    const variants = ['light', 'dark'];
    expect(
      provider.resolve(of('theme', { kind: 'variant', variants, default: 'light' }), context),
    ).toMatchObject({ value: 'dark', variant: 'dark' });
    expect(
      provider.resolve(of('otherTheme', { kind: 'variant', variants, default: 'light' }), context),
    ).toMatchObject({ value: 'light', errorCode: 'TYPE_MISMATCH' });
    expect(
      provider.resolve(of('layout', { kind: 'json', default: { columns: 2 } }), context),
    ).toMatchObject({ value: { columns: 3 }, variant: 'env' });
  });

  test('reads the environment when the flag is resolved', () => {
    const variable = 'KEELWERK_FLAG_LIBRARY_NEW_FLOW';
    const env: Record<string, string | undefined> = {};
    const provider = envFlagProvider(env);
    expect(provider.resolve(newFlow, context)).toBeUndefined();
    env[variable] = 'true';
    expect(provider.resolve(newFlow, context)).toMatchObject({ value: true });
  });
});
