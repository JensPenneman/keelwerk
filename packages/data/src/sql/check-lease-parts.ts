import { errors } from '@keelwerk/core';

const kinds: readonly string[] = ['topic', 'subscriptions', 'connections', 'invocations'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const keyBytes = 2_000;
const holderBytes = 200;
const maxUnits = 2_147_483_647;
const maxTtl = 2_147_483_647;
const maxLimit = 1_000;
const encoder = new TextEncoder();

function checkText(name: string, text: string, most: number): void {
  if (!text.isWellFormed()) {
    throw errors.validation(`a lease ${name} is well-formed text, with no lone surrogate`);
  }
  const bytes = encoder.encode(text).length;
  if (bytes < 1 || bytes > most) {
    throw errors.validation(
      `a lease ${name} is 1 to ${most.toLocaleString('en-US')} bytes of UTF-8`,
    );
  }
  if (text.includes('\u0000')) throw errors.validation(`a lease ${name} holds no U+0000`);
}

/** What a lease call names; each member present is checked. */
export function checkLeaseParts(parts: {
  readonly kind?: string;
  readonly key?: string;
  readonly holder?: string;
  readonly scopeId?: string | null;
  readonly units?: number;
  readonly ttlMs?: number;
  readonly limit?: number;
}): void {
  if (parts.kind !== undefined && !kinds.includes(parts.kind)) {
    throw errors.validation(`a lease kind is one of ${kinds.join(', ')}`);
  }
  if (parts.key !== undefined) checkText('key', parts.key, keyBytes);
  if (parts.holder !== undefined) checkText('holder', parts.holder, holderBytes);
  if (parts.scopeId !== undefined && parts.scopeId !== null && !uuid.test(parts.scopeId)) {
    throw errors.validation('a lease scope id is null or a lower-case UUID');
  }
  if (
    parts.units !== undefined &&
    (!Number.isInteger(parts.units) || parts.units < 1 || parts.units > maxUnits)
  ) {
    throw errors.validation(
      `a lease holds a whole number of units from 1 to ${maxUnits.toLocaleString('en-US')}`,
    );
  }
  if (
    parts.ttlMs !== undefined &&
    (!Number.isInteger(parts.ttlMs) || parts.ttlMs < 1 || parts.ttlMs > maxTtl)
  ) {
    throw errors.validation(
      `a lease time-to-live is a whole number of milliseconds from 1 to ${maxTtl.toLocaleString('en-US')}`,
    );
  }
  if (
    parts.limit !== undefined &&
    (!Number.isInteger(parts.limit) || parts.limit < 1 || parts.limit > maxLimit)
  ) {
    throw errors.validation(
      `a lease limit is a whole number from 1 to ${maxLimit.toLocaleString('en-US')}`,
    );
  }
}
