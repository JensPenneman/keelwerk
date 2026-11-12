import { describe, expect, it, vi } from 'vitest';
import { createFakeInvoker } from './support/fake-invoker.ts';
import { fakeSession } from './support/fake-session.ts';
import { fakeAction, fakeSurface, stringNode } from './support/fake-surface.ts';
import { libraryActions } from './support/library-actions.ts';
import { postJson } from './support/post-json.ts';
import { useHosts } from './support/use-hosts.ts';

const { setup } = useHosts();

describe('the Sunset header names the first instant no longer served (18.5)', () => {
  it('a deprecated version: 00:00:00 GMT of the day after its sunset date', async () => {
    const invoker = createFakeInvoker({
      open: () => ({
        ok: true,
        value: fakeSession({ deprecation: { at: '2026-11-01', sunset: '2027-11-01' } }),
      }),
      actions: libraryActions,
    });
    const response = await setup({}, invoker).host.fetch(
      postJson('/_keelwerk/v1/invoke', { action: 'library.echo' }),
    );
    expect(response.headers.get('sunset')).toBe('Tue, 02 Nov 2027 00:00:00 GMT');
  });

  it('a deprecated action: the same rule', async () => {
    const surface = fakeSurface([
      fakeAction('library.old', {
        output: stringNode,
        deprecated: { reason: 'gone', at: '2026-11-01', sunset: '2027-11-30' },
      }),
    ]);
    const invoker = createFakeInvoker({
      actions: { ...libraryActions, 'library.old': () => ({ ok: true, value: 'old' }) },
    });
    const response = await setup({}, invoker, { surface: () => surface }).host.fetch(
      postJson('/_keelwerk/v1/invoke', { action: 'library.old' }),
    );
    expect(response.headers.get('sunset')).toBe('Wed, 01 Dec 2027 00:00:00 GMT');
  });

  it('a deprecated action with a time on its day: announced from that UTC day, not before', async () => {
    const surface = fakeSurface([
      fakeAction('library.old', {
        output: stringNode,
        deprecated: { reason: 'gone', at: '2026-11-01T15:30:00Z', sunset: '2027-11-30' },
      }),
    ]);
    const invoker = createFakeInvoker({
      actions: { ...libraryActions, 'library.old': () => ({ ok: true, value: 'old' }) },
    });
    const call = (now: string) =>
      setup({}, invoker, {
        surface: () => surface,
        clock: { now: () => Temporal.Instant.from(now) },
      }).host.fetch(postJson('/_keelwerk/v1/invoke', { action: 'library.old' }));
    const onTheDay = await call('2026-11-01T00:00:00Z');
    expect(onTheDay.headers.get('deprecation')).toBe('@1793547000');
    expect(onTheDay.headers.get('sunset')).toBe('Wed, 01 Dec 2027 00:00:00 GMT');
    const before = await call('2026-10-31T23:59:59Z');
    expect(before.headers.get('deprecation')).toBeNull();
    expect(before.headers.get('sunset')).toBeNull();
  });

  it('an action declared with an instant with an offset and one with a calendar date answer the same in every process time zone', async () => {
    const surface = fakeSurface([
      fakeAction('library.instant', {
        output: stringNode,
        deprecated: {
          reason: 'gone',
          at: '2026-11-01T17:30:00+02:00',
          sunset: '2027-11-30T23:30:00-05:00',
        },
      }),
      fakeAction('library.day', {
        output: stringNode,
        deprecated: { reason: 'gone', at: '2026-11-01', sunset: '2027-11-30' },
      }),
    ]);
    const invoker = createFakeInvoker({
      actions: {
        ...libraryActions,
        'library.instant': () => ({ ok: true, value: 'x' }),
        'library.day': () => ({ ok: true, value: 'x' }),
      },
    });
    const answers: Record<string, string[][]> = {};
    try {
      for (const zone of ['UTC', 'Pacific/Kiritimati', 'Asia/Kolkata', 'America/Los_Angeles']) {
        vi.stubEnv('TZ', zone);
        answers[zone] = [];
        for (const action of ['library.instant', 'library.day']) {
          const response = await setup({}, invoker, {
            surface: () => surface,
            clock: { now: () => Temporal.Instant.from('2026-12-01T00:00:00Z') },
          }).host.fetch(postJson('/_keelwerk/v1/invoke', { action }));
          answers[zone]?.push([
            response.headers.get('deprecation') ?? '',
            response.headers.get('sunset') ?? '',
          ]);
        }
      }
    } finally {
      vi.unstubAllEnvs();
    }
    const expected = [
      ['@1793547000', 'Thu, 02 Dec 2027 00:00:00 GMT'],
      ['@1793491200', 'Wed, 01 Dec 2027 00:00:00 GMT'],
    ];
    for (const [zone, answer] of Object.entries(answers)) {
      expect(answer, zone).toEqual(expected);
    }
  });
});
