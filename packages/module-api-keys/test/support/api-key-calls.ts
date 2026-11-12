import type { Id } from '@keelwerk/core';
import type { TestPrincipal } from '@keelwerk/testing';
import { testPrincipal } from '@keelwerk/testing';
import type { BootedApiKeys } from './boot-api-keys.ts';

const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';

function randomText(length: number): string {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(length)),
    (byte) => alphabet[byte % alphabet.length],
  ).join('');
}

/** The person who owns the keys of most tests. */
export const keyOwnerSubject = '0192f3a0-0000-7000-8000-00000000ada1';
export const keyOwner: TestPrincipal = testPrincipal(keyOwnerSubject);
export const otherPerson: TestPrincipal = testPrincipal('0192f3a0-0000-7000-8000-00000000ace2');

/** What `api-keys.create` answers. */
export interface CreatedKey {
  readonly id: Id<'api-keys.key'>;
  readonly key: string;
  readonly publicId: string;
  readonly expiresAt?: Temporal.Instant;
}

/** What the tests ask of `api-keys.create`; the optional members are left out when absent. */
export interface NewKey {
  readonly label?: string;
  readonly scopes: readonly string[];
  readonly expiresAt?: Temporal.Instant;
  readonly apiVersion?: string;
}

/** Creates a key for a person (keyOwner unless named) and answers what is shown once. */
export async function createKey(
  app: BootedApiKeys,
  request: NewKey,
  owner: TestPrincipal = keyOwner,
): Promise<CreatedKey> {
  const answer = await app.as(owner).attempt('api-keys.create', {
    label: request.label ?? 'laptop',
    scopes: request.scopes,
    ...(request.expiresAt === undefined ? {} : { expiresAt: request.expiresAt }),
    ...(request.apiVersion === undefined ? {} : { apiVersion: request.apiVersion }),
  });
  if (!answer.ok) throw answer.error;
  return answer.value as CreatedKey;
}

/** A well-formed key that was never issued. */
export function unknownKey(): string {
  return `kwk_${randomText(26)}_${randomText(52)}`;
}

/** The refusal of an outcome as the tests compare it, or undefined when it succeeded. */
export function refusalOf(outcome: {
  readonly ok: boolean;
  readonly error?: { readonly kind: string; readonly code: string; readonly message: string };
}): { readonly kind: string; readonly code: string; readonly message: string } | undefined {
  if (outcome.ok || outcome.error === undefined) return undefined;
  const { kind, code, message } = outcome.error;
  return { kind, code, message };
}
