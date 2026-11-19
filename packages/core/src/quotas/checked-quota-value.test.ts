import { describe, expect, test } from 'vitest';
import { notesQuota, registryOf } from '../../test/quota-cache-kit.ts';
import type { Registry } from '../registry/registry.ts';
import { checkedQuotaValue } from './checked-quota-value.ts';

const registry = {
  ...registryOf(notesQuota, {
    ref: 'core.requestRate',
    module: 'core',
    name: 'requestRate',
    kind: 'rate',
    default: '6000/1m',
    level: 'tenant',
  }),
  executors: new Map([['jobs.ping', { queue: 'pings' }]]),
} as unknown as Pick<Registry, 'quotas' | 'executors'>;

function check(dimension: string, limit: string) {
  return checkedQuotaValue({
    dimension,
    limit,
    appId: 'shop',
    registry,
    queues: { bulk: { running: 2 } },
  });
}

function refusal(dimension: string, limit: string): unknown {
  try {
    check(dimension, limit);
  } catch (error) {
    return error;
  }
  throw new Error(`${dimension} ${limit} was accepted`);
}

const malformed = (message: string | RegExp) =>
  expect.objectContaining({
    kind: 'validation',
    code: 'core.malformed_request',
    message: expect.stringMatching(message),
  });

describe('checkedQuotaValue', () => {
  test('a declared dimension answers its entry and the parsed, canonical limit', () => {
    expect(check('notes.rows', '40')).toMatchObject({
      entry: { ref: 'notes.rows' },
      limit: { kind: 'count', value: 40 },
      canonical: '40',
    });
  });

  test('default is no limit', () => {
    expect(check('notes.rows', 'default')).toMatchObject({ limit: null, canonical: 'default' });
  });

  test('an unknown dimension is refused', () => {
    expect(refusal('notes.nope', '1')).toEqual(malformed('not a quota dimension of app "shop"'));
  });

  test('an unknown queue is refused; a configured, a kernel and an executor queue are accepted', () => {
    expect(refusal('queue:ghosts.running', '1')).toEqual(malformed('not a queue'));
    expect(check('queue:bulk.running', '3').limit).toEqual({ kind: 'count', value: 3 });
    expect(check('queue:commands.queued', '3').limit).toEqual({ kind: 'count', value: 3 });
    expect(check('queue:pings.weight', '3').limit).toEqual({ kind: 'count', value: 3 });
  });

  test('a limit that does not parse is refused', () => {
    expect(refusal('notes.rows', 'lots')).toEqual(malformed('not a count quota'));
  });

  test('a queue running or weight above 2147483647 and a weight of 0 are refused', () => {
    expect(refusal('queue:bulk.running', '2147483648')).toEqual(malformed('is above 2147483647'));
    expect(refusal('queue:bulk.weight', '2147483648')).toEqual(malformed('is above 2147483647'));
    expect(refusal('queue:bulk.weight', '0')).toEqual(malformed('is below 1'));
    expect(check('queue:bulk.running', '2147483647').limit).toEqual({
      kind: 'count',
      value: 2_147_483_647,
    });
    expect(check('queue:bulk.running', '0').limit).toEqual({ kind: 'count', value: 0 });
  });

  test('a rate period that is not a whole number of at least one millisecond is refused', () => {
    for (const limit of [
      '1/999999999999999999d',
      '1/9999999999999999999999ms',
      '1/PT0.0004S',
      '3/PT0.0014S',
    ]) {
      expect(refusal('core.requestRate', limit)).toEqual(malformed('not a rate quota'));
    }
  });

  test('a rate whose canonical text would not read back to the same limit is refused', () => {
    expect(refusal('core.requestRate', '759828/4430549794330293ms')).toEqual(
      malformed('cannot be stored as a rate quota'),
    );
    expect(check('core.requestRate', '1/9007199254740991ms').canonical).toBe(
      '1/9007199254740991ms',
    );
  });
});
