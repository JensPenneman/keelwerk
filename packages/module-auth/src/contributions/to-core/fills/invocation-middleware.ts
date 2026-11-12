import {
  type AdmissionInput,
  type AdmissionVerdict,
  type BucketCharge,
  defineFill,
  type NormalizerRegistry,
  normalizerRegistry,
  parseToken,
  unknownClientAddress,
  within,
} from '@keelwerk/core';
import { authBase } from '../../../base.ts';
import { addressBucket } from '../../../lib/address-bucket.ts';
import { toCore } from '../contribution.ts';

const limited = [
  'auth.signUp',
  'auth.login',
  'auth.reauthenticate',
  'accounts.profile.changePassword',
  'auth.requestPasswordReset',
  'auth.resetPassword',
] as const;
const secondsPerMinute = 60;

/** The identifier as the credential lookup sees it: the `email` normaliser, so every spelling of one identifier shares one bucket. */
function identifierOf(input: unknown, registry: NormalizerRegistry): string | undefined {
  if (typeof input !== 'object' || input === null || !('identifier' in input)) return undefined;
  if (typeof input.identifier !== 'string') return undefined;
  const email = registry.resolve({ id: 'email', version: 1 });
  return email === undefined ? input.identifier : email.normalize(input.identifier);
}

function tokenOf(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null || !('token' in input)) return undefined;
  return typeof input.token === 'string' ? input.token : undefined;
}

function currentPasswordGiven(input: unknown): boolean {
  return (
    typeof input === 'object' &&
    input !== null &&
    'currentPassword' in input &&
    input.currentPassword !== undefined
  );
}

/** The key the failures of one attempt are counted under, per action (17.2.6). Changing the password shares the bucket of `reauthenticate`, so the two cannot be guessed at in turn. */
function failureKey(input: AdmissionInput, registry: NormalizerRegistry): string | undefined {
  if (input.action === 'auth.reauthenticate') {
    return input.principal.kind === 'user' ? `subject:${input.principal.subject}` : undefined;
  }
  if (input.action === 'accounts.profile.changePassword') {
    // Only a given current password can fail with `auth.invalid_credentials`; without one the
    // attempt answers `auth.reauthentication_required`, which is no guess and must not lock the subject.
    return input.principal.kind === 'user' && currentPasswordGiven(input.input)
      ? `subject:${input.principal.subject}`
      : undefined;
  }
  if (input.action === 'auth.resetPassword') {
    const token = tokenOf(input.input);
    const parsed = token === undefined ? undefined : parseToken(token);
    return parsed === undefined ? undefined : `reset-token:${parsed.publicId}`;
  }
  if (input.action === 'auth.requestPasswordReset') return undefined;
  const identifier = identifierOf(input.input, registry);
  return identifier === undefined ? undefined : `identifier:${identifier}`;
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
      // A carrier without a connection shares one bucket, so an in-process call or a transport that builds its own carrier cannot go past the address limit.
      const address = input.request.connection?.remote.address ?? unknownClientAddress;
      const failure = failureKey(input, registry);
      // A reset request is charged per identifier whatever its outcome, since it never fails (the answer is the same).
      const requested =
        input.action === 'auth.requestPasswordReset'
          ? identifierOf(input.input, registry)
          : undefined;
      const admit: BucketCharge[] = [
        {
          bucket: `address:${addressBucket(address)}`,
          capacity: limits.addressAttemptsPerMinute,
          refillPerSecond: limits.addressAttemptsPerMinute / secondsPerMinute,
        },
      ];
      if (requested !== undefined) {
        admit.push({
          bucket: `reset-request:${requested}`,
          capacity: limits.identifierFailedAttempts,
          refillPerSecond:
            limits.identifierFailedAttempts /
            (limits.identifierFailureWindowMinutes * secondsPerMinute),
        });
      }
      const onDeclaredError: BucketCharge[] =
        failure === undefined
          ? []
          : [
              {
                bucket: failure,
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
