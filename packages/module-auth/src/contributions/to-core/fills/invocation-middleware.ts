import {
  type AdmissionInput,
  type AdmissionVerdict,
  type BucketCharge,
  defineFill,
  type NormalizerRegistry,
  normalizerRegistry,
  within,
} from '@keelwerk/core';
import { authBase } from '../../../base.ts';
import { addressBucket } from '../../../lib/address-bucket.ts';
import { toCore } from '../contribution.ts';

const limited = ['auth.signUp', 'auth.login'] as const;
const secondsPerMinute = 60;

/** The identifier as the credential lookup sees it: the `email` normaliser, so every spelling of one identifier shares one bucket. */
function identifierOf(input: unknown, registry: NormalizerRegistry): string | undefined {
  if (typeof input !== 'object' || input === null || !('identifier' in input)) return undefined;
  if (typeof input.identifier !== 'string') return undefined;
  const email = registry.resolve({ id: 'email', version: 1 });
  return email === undefined ? input.identifier : email.normalize(input.identifier);
}

/**
 * The rate-limit rule of 17.2.6 (S-36): per remote address a bucket charged at `admit`, per
 * identifier a bucket charged only when the attempt fails with a declared error. The kernel keys
 * both by an HMAC, so no plain address or identifier is stored.
 */
export const invocationMiddlewareFill = defineFill(
  within(authBase, toCore),
  'invocationMiddleware',
  (own) => {
    const registry = normalizerRegistry();
    return (input: AdmissionInput): AdmissionVerdict => {
      if (!(limited as readonly string[]).includes(input.action))
        return { kind: 'charge', demand: { admit: [], onDeclaredError: [] } };
      const limits = own.config;
      const address = input.request.connection?.remote.address;
      const identifier = identifierOf(input.input, registry);
      const admit: BucketCharge[] =
        address === undefined
          ? []
          : [
              {
                bucket: `address:${addressBucket(address)}`,
                capacity: limits.addressAttemptsPerMinute,
                refillPerSecond: limits.addressAttemptsPerMinute / secondsPerMinute,
              },
            ];
      const onDeclaredError: BucketCharge[] =
        identifier === undefined
          ? []
          : [
              {
                bucket: `identifier:${identifier}`,
                capacity: limits.identifierFailedAttempts,
                refillPerSecond:
                  limits.identifierFailedAttempts /
                  (limits.identifierFailureWindowMinutes * secondsPerMinute),
              },
            ];
      return { kind: 'charge', demand: { admit, onDeclaredError } };
    };
  },
);
