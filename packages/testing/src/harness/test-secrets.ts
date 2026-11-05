import type { SecretProvider } from '@keelwerk/core';
import { testMasterKeyBytes } from './test-master-key-bytes.ts';
import { testMasterKeyName } from './test-master-key-name.ts';

const testMasterKey = Buffer.from(testMasterKeyBytes).toString('base64');

/** A secret provider that holds one fixed master key for tests and nothing else. */
export const testSecrets: SecretProvider = {
  id: 'test.secrets',
  resolve: async (ref) => (ref.ref === testMasterKeyName ? testMasterKey : undefined),
};
