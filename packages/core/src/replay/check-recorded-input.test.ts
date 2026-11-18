import { describe, expect, test } from 'vitest';
import { testFingerprintKey as key } from '../../test/fingerprint-kit.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import { commandDigests, type FingerprintSource } from '../write-path/command-digests.ts';
import { inputFingerprint } from '../write-path/input-fingerprint.ts';
import { checkRecordedInput } from './check-recorded-input.ts';

const action = {
  ref: 'probe.signUp',
  module: 'probe',
  input: shape({
    address: field.string().personal(),
    password: field.secret(),
    title: field.string(),
  }),
} as unknown as ActionEntry;
const input = { address: 'ada@example.org', password: 'hunter2', title: 'hello' };
const sourceOf = (given: object): FingerprintSource => ({
  registry: { entities: new Map() } as unknown as Registry,
  action,
  fingerprintKey: key,
  apiVersion: '2026-01-01',
  input: given,
});
const unit = {} as Unit;
const check = (given: object, recorded: string) =>
  checkRecordedInput(unit, sourceOf(given), [], recorded);
const refused = { kind: 'validation' };
const base = commandDigests(sourceOf(input)).decisionBase;
const notTheOne = 'The input is not the one the decision recorded.';

describe('checkRecordedInput', () => {
  test('a decision base passes with another secret or personal value', async () => {
    await expect(check(input, base)).resolves.toBeUndefined();
    await expect(check({ ...input, password: 'other' }, base)).resolves.toBeUndefined();
    await expect(check({ ...input, address: 'bea@example.org' }, base)).resolves.toBeUndefined();
  });

  test('a decision base is validation with another plain value, with the short message', async () => {
    const promise = check({ ...input, title: 'other' }, base);
    await expect(promise).rejects.toMatchObject(refused);
    await expect(promise).rejects.toThrowError(new RegExp(`^${notTheOne}$`));
  });

  test('a rekeyed text (kwd1.) of another value is validation too', async () => {
    await expect(check(input, `kwd1.${'a'.repeat(64)}`)).rejects.toMatchObject(refused);
  });

  test('a bare plain hex of 0.1.0 passes with the exact input and is validation with another password', async () => {
    const legacy = inputFingerprint('probe.signUp', '2026-01-01', input);
    await expect(check(input, legacy)).resolves.toBeUndefined();
    const promise = check({ ...input, password: 'other' }, legacy);
    await expect(promise).rejects.toMatchObject(refused);
    await expect(promise).rejects.toThrowError(/0\.1\.0 form covers every member/);
  });

  test('an untagged digest that is not the 0.1.0 form of the input gets the explained message', async () => {
    const promise = check(input, 'c'.repeat(64));
    await expect(promise).rejects.toMatchObject(refused);
    await expect(promise).rejects.toThrowError(
      /between 0\.1\.0 and 0\.2\.0 that keyed a personal member/,
    );
  });

  test('a receipt fingerprint (kwf1.), erased and any other text are refused', async () => {
    const receipt = commandDigests(sourceOf(input)).fingerprint;
    for (const recorded of [receipt, 'erased', '', 'kwx1.abc']) {
      await expect(check(input, recorded)).rejects.toMatchObject(refused);
    }
  });
});
