import { createHmac } from 'node:crypto';
import type { ExtensionFillEntry, KeyService, Registry } from '@keelwerk/core';
import type { ada } from './invoker-kit.ts';
import type { tenant } from './run-read-kit.ts';
import { bootVault } from './vault-kit.ts';

export const hmacSha256 = (key: string | Uint8Array, data: string | Uint8Array): string =>
  createHmac('sha256', key).update(data).digest('hex');

/** The key service of a booted vault: the real HKDF derivation from the scope's key (the runtime stops after each test). */
export const bootKeys = async (): Promise<KeyService> => (await bootVault('memory')).keyService();

/** The stored name of a bucket in a scope, derived the way S-36 states it. */
export const storedName = async (
  keys: KeyService,
  scope: typeof tenant,
  name: string,
  module = 'library',
): Promise<string> =>
  hmacSha256(await keys.derive(scope, 'keelwerk/bucket/1', 32), `${module}\u0000${name}`);

export const remote = (address: string) => ({
  address,
  port: 1,
});
export const withAddress = (carrier: typeof ada, address: string) => ({
  ...carrier,
  connection: { id: 'c', listener: 'http', remote: remote(address), local: remote('10.0.0.1') },
});

export const fill = (value: unknown, module = 'library'): ExtensionFillEntry => ({
  point: 'core.invocationMiddleware',
  module,
  bound: false,
  fill: value,
});
export const withRules = (registry: Registry, rules: readonly unknown[]): Registry => ({
  ...registry,
  fills: new Map([
    ...registry.fills,
    ['core.invocationMiddleware', rules.map((rule) => fill(rule))],
  ]),
});
