import { describe, expect, test } from 'vitest';
import { protectionFindings } from './support/marked-drivers.ts';
import { grid, type Site, sites } from './support/marked-grid.ts';
import { type Refusal, refusalOf } from './support/marked-outcomes.ts';
import { skeletonApp } from './support/marked-skeleton.ts';

/**
 * Every kind of mark (personal, secret, verifier, and a credential that is also personal) at every
 * position the field builders allow, at every site where a module declares a shape (14.7.4). The
 * registry either refuses a combination, with an error that names the member, or accepts it, and
 * then the kernel protects it: what it stored (every table and every index of the dump) holds no
 * clear text of it, every copy it shows hides it, and a personal value stops opening after the
 * erasure of its subject while another subject's value still opens. How many errors a declaration
 * earns, and which code at which position, core's own tests prove (`check-marked-members.test.ts`).
 */
const refusals = new Set([
  'personalNotSealed',
  'credentialNotSealed',
  'credentialInJson',
  'verifierOutsideEntity',
  'processEventCredential',
  'streamRecordCredential',
  'personalCommandOutput',
  'personalEffectOutput',
  'unsurfacedFields',
  'unsurfacedSchemas',
]);

const outcomes: readonly { combo: (typeof grid)[number]; refusal: Refusal | undefined }[] =
  grid.map((combo) => ({ combo, refusal: refusalOf(combo) }));
const acceptedAt = (site: Site) =>
  outcomes.filter((o) => o.combo.site === site && o.refusal === undefined).map((o) => o.combo);

/** The documented features: each must compose, so that a needless refusal fails. */
const mustAccept: readonly (readonly [Site, string])[] = [
  ['entity', 'personalTop'],
  ['entity', 'personalWholeList'],
  ['entity', 'personalWholeJson'],
  ['entity', 'personalUnique'],
  ['entity', 'personalLookupEvery'],
  ['entity', 'secretTop'],
  ['entity', 'verifierTop'],
  ['domainEvent', 'personalTop'],
  ['domainEvent', 'personalList'],
  ['domainEvent', 'personalSet'],
  ['domainEvent', 'personalWholeJson'],
  ['processEvent', 'personalTop'],
  ['processEvent', 'personalList'],
  ['processEvent', 'personalSet'],
  ['streamRecord', 'personalTop'],
  ['streamRecord', 'personalList'],
  ['streamRecord', 'personalSet'],
  ['commandInput', 'personalTop'],
  ['commandInput', 'personalList'],
  ['commandInput', 'secretTop'],
  ['commandInput', 'secretList'],
  ['commandOutput', 'secretTop'],
  ['commandOutput', 'secretList'],
  ['effectInput', 'personalTop'],
  ['effectInput', 'personalList'],
  ['effectInput', 'secretTop'],
  ['effectInput', 'secretList'],
  ['effectOutput', 'secretTop'],
  ['effectOutput', 'secretList'],
  ['configuration', 'secretTop'],
];

describe('every kind at every position at every site', () => {
  test('the skeleton of every site composes without a mark', () => {
    for (const site of sites) expect(() => skeletonApp(site, {})).not.toThrow();
  });

  test('the registry refuses a mark with an error that names the member, or accepts it', () => {
    expect(outcomes.length).toBe(504);
    expect(outcomes.filter((o) => o.refusal === undefined).length).toBe(130);
    for (const { combo, refusal } of outcomes) {
      if (refusal === undefined) continue;
      const label = `${combo.site} ${combo.name}: ${refusal.code} ${refusal.message}`;
      expect(refusals.has(refusal.code), label).toBe(true);
      // The surface's own error (older, about another cause) names the entity, not the member.
      if (!refusal.code.startsWith('unsurfaced'))
        expect(refusal.message, label).toContain(combo.name);
    }
  });

  test('a member marked personal as a whole takes no personal mark inside it, whichever subject that mark names', () => {
    const inner = outcomes.filter((o) => /^personalWhole(List|Json)Inner/.test(o.combo.name));
    expect(inner.length).toBe(sites.length * 4);
    for (const { combo, refusal } of inner) {
      expect(refusal, `${combo.site} ${combo.name}`).toBeDefined();
      // Where the whole member itself stands, the inner mark is the one refused, and the text says to drop it.
      if (
        [
          'entity',
          'domainEvent',
          'processEvent',
          'streamRecord',
          'commandInput',
          'effectInput',
        ].includes(combo.site)
      ) {
        expect(refusal?.code, `${combo.site} ${combo.name}`).toBe('personalNotSealed');
        expect(refusal?.message).toContain(`Drop the mark on '${combo.name}`);
      }
    }
  });

  test('the documented features compose', () => {
    const composes = new Set(
      outcomes.filter((o) => o.refusal === undefined).map((o) => `${o.combo.site} ${o.combo.name}`),
    );
    expect(mustAccept.filter(([site, name]) => !composes.has(`${site} ${name}`))).toEqual([]);
  });

  test('nothing marked composes in the extra input of a continuation', () => {
    expect(acceptedAt('outcomeInput')).toEqual([]);
  });

  test.each(sites.filter((site) => site !== 'outcomeInput'))(
    'what composes at %s is protected',
    { timeout: 300_000 },
    async (site) => {
      const accepted = acceptedAt(site);
      expect(accepted.length).toBeGreaterThan(0);
      expect(await protectionFindings(site, accepted)).toEqual([]);
    },
  );
});
