import type { SecretProvider } from '@keelwerk/core';

const masterKey = Buffer.from(new Uint8Array(32).fill(11)).toString('base64');

/** The reference the test deployment names as its master key. */
export const masterKeyName = 'PORTAL_TEST_MASTER_KEY';

/** A secret provider that holds one fixed master key and nothing else. */
export const portalSecrets: SecretProvider = {
  id: 'portal.test.secrets',
  resolve: async (ref) => (ref.ref === masterKeyName ? masterKey : undefined),
};
