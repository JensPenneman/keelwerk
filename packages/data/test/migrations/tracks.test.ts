import { describe, expect, test } from 'vitest';
import {
  isTrackActive,
  orderTracks,
  parseTrackId,
  trackDirectoryName,
  trackId,
  trackOfDirectory,
} from '../../src/index.ts';
import { conformanceModules } from './support/conformance-modules.ts';
import { conformanceSnapshots } from './support/conformance-snapshots.ts';

describe('track ids and directories', () => {
  test('ids follow section 14.6.1', () => {
    expect(trackId('auth')).toBe('auth');
    expect(trackId('auth', 'accounts')).toBe('auth->accounts');
    expect(trackId('auth', null, ['accounts'])).toBe('auth[accounts]');
    expect(trackId('auth', 'projects', ['teams', 'billing'])).toBe('auth->projects[billing,teams]');
    expect(trackId('auth', 'auth')).toBe('auth');
  });

  test('an id parses back into its parts', () => {
    expect(parseTrackId('auth->projects[billing,teams]')).toEqual({
      module: 'auth',
      target: 'projects',
      when: ['billing', 'teams'],
    });
    expect(() => parseTrackId('Auth')).toThrow(TypeError);
  });

  test.each([
    ['auth', ['auth'], true],
    ['auth', ['accounts'], false],
    ['auth->accounts', ['auth'], false],
    ['auth->accounts', ['accounts', 'auth'], true],
    ['auth->accounts', ['accounts'], false],
    ['auth[accounts]', ['auth'], false],
    ['auth[accounts]', ['auth', 'accounts'], true],
    ['auth->projects[billing,teams]', ['auth', 'projects', 'billing'], false],
    ['auth->projects[billing,teams]', ['auth', 'projects', 'billing', 'teams'], true],
  ])('%s is active for %j: %s', (track, selected, active) => {
    expect(isTrackActive(track, selected)).toBe(active);
  });

  test.each([
    ['auth', 'own'],
    ['auth->accounts', 'to-accounts'],
    ['auth[accounts]', 'when-accounts'],
    ['auth->projects[billing,teams]', 'to-projects.when-billing+teams'],
  ])('%s lives in %s and is found again', (track, directory) => {
    expect(trackDirectoryName(track)).toBe(directory);
    expect(trackOfDirectory('auth', directory)).toBe(track);
  });

  test('a directory that is no track is none', () => {
    expect(trackOfDirectory('auth', 'scratch')).toBeNull();
    expect(trackOfDirectory('auth', 'to-a.b.c')).toBeNull();
  });
});

describe('orderTracks', () => {
  test('own tracks follow requires and optional, contributions and conditional parts come after theirs', () => {
    const tracks = [...conformanceSnapshots.keys()];
    expect(tracks.sort()).toEqual(['core', 'library', 'loans', 'loans->library', 'loans[library]']);
    expect(orderTracks(conformanceModules, tracks)).toEqual([
      'core',
      'library',
      'loans',
      'loans->library',
      'loans[library]',
    ]);
  });

  test('a dependency listed later still comes first, ties break by tuple order', () => {
    const modules = [
      { id: 'b', requires: ['a'], optional: [] },
      { id: 'c', requires: [], optional: [] },
      { id: 'a', requires: [], optional: [] },
    ];
    expect(orderTracks(modules, ['b', 'a', 'c'])).toEqual(['c', 'a', 'b']);
  });

  test('an optional module that is not selected adds no edge, a cycle throws', () => {
    expect(orderTracks([{ id: 'x', requires: [], optional: ['ghost'] }], ['x'])).toEqual(['x']);
    const loop = [
      { id: 'p', requires: ['q'], optional: [] },
      { id: 'q', requires: ['p'], optional: [] },
    ];
    expect(() => orderTracks(loop, ['p', 'q'])).toThrow(/wait for each other/);
  });

  test('a conditional part waits for its when modules', () => {
    const modules = [
      { id: 'auth', requires: [], optional: [] },
      { id: 'accounts', requires: [], optional: [] },
    ];
    expect(orderTracks(modules, ['auth[accounts]', 'accounts', 'auth'])).toEqual([
      'auth',
      'accounts',
      'auth[accounts]',
    ]);
  });
});
