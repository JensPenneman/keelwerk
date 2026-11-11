import { describe, expect, test } from 'vitest';
import type { InvokeEffect } from '../protocol/invoke-effect.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import { checkInvokeErrors } from './check-invoke-errors.ts';

const invoked = { ref: 'relay.accept', errors: ['relay.rejected'] } as unknown as ActionEntry;
const caller = {
  ref: 'relay.forward',
  errors: ['relay.forward_refused', 'relay.detailed'],
  errorSpecs: {
    'relay.forward_refused': { kind: 'validation', message: 'x' },
    'relay.detailed': { kind: 'validation', message: 'x', data: {} },
  },
} as unknown as ActionEntry;
const effect = (errors?: Record<string, string>): InvokeEffect =>
  ({ kind: 'invoke', type: 'invoke', action: 'relay.accept', input: {}, errors }) as InvokeEffect;

const refusal = { kind: 'internal', code: 'core.request_not_allowed' };

describe('the checks of the error map of an invoke', () => {
  test('no map, or a map the caller and the command both declare, passes', () => {
    expect(() => checkInvokeErrors(effect(), invoked, caller, false)).not.toThrow();
    expect(() => checkInvokeErrors(effect(), invoked, caller, true)).not.toThrow();
    expect(() =>
      checkInvokeErrors(
        effect({ 'relay.rejected': 'relay.forward_refused' }),
        invoked,
        caller,
        false,
      ),
    ).not.toThrow();
  });

  test('a map on a deferred invoke is refused', () => {
    expect(() =>
      checkInvokeErrors(
        effect({ 'relay.rejected': 'relay.forward_refused' }),
        invoked,
        caller,
        true,
      ),
    ).toThrow(expect.objectContaining(refusal));
  });

  test('a key the invoked command does not declare is refused', () => {
    expect(() =>
      checkInvokeErrors(effect({ 'relay.other': 'relay.forward_refused' }), invoked, caller, false),
    ).toThrow(expect.objectContaining(refusal));
  });

  test('a value the caller does not declare is refused', () => {
    expect(() =>
      checkInvokeErrors(effect({ 'relay.rejected': 'relay.unknown' }), invoked, caller, false),
    ).toThrow(expect.objectContaining(refusal));
  });

  test('a value whose declaration carries details is refused', () => {
    expect(() =>
      checkInvokeErrors(effect({ 'relay.rejected': 'relay.detailed' }), invoked, caller, false),
    ).toThrow(expect.objectContaining(refusal));
  });

  test('an error both declare passes when it is named as itself, even with details; named as another it is still refused', () => {
    const both = { ref: 'relay.accept', errors: ['relay.detailed'] } as unknown as ActionEntry;
    expect(() =>
      checkInvokeErrors(effect({ 'relay.detailed': 'relay.detailed' }), both, caller, false),
    ).not.toThrow();
    // The caller must declare it, so its surface lists it.
    expect(() =>
      checkInvokeErrors(
        effect({ 'relay.detailed': 'relay.detailed' }),
        both,
        { ref: 'relay.forward', errors: [], errorSpecs: {} } as unknown as ActionEntry,
        false,
      ),
    ).toThrow(expect.objectContaining(refusal));
  });

  test('a reaction declares no errors, so it can map nothing', () => {
    const reaction = { ref: 'logs.plain', errors: [] } as unknown as ActionEntry;
    expect(() =>
      checkInvokeErrors(
        effect({ 'relay.rejected': 'relay.forward_refused' }),
        invoked,
        reaction,
        false,
      ),
    ).toThrow(expect.objectContaining(refusal));
  });
});
