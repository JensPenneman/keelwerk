import type { SecretProvider } from '@keelwerk/core';

const reference = 'KEELWERK_ACCOUNTS_TEST_MASTER_KEY';
const masterKey = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');

/** The reference the test deployment names as its master key. */
export const masterKeyName: string = reference;

/** A secret provider that holds one fixed master key for the tests and nothing else. */
export const testSecrets: SecretProvider = {
  id: 'accounts.test-secrets',
  resolve: async (ref) => (ref.ref === reference ? masterKey : undefined),
};
