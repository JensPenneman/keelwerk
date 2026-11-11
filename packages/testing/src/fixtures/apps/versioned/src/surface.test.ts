import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  checkLedger,
  defineApiVersions,
  defineApp,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  deriveSurface,
  diffSurfaces,
  field,
  parseApiVersionLedger,
  renderApiVersionLedger,
  renderSurfaceArtefact,
} from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { versioned } from './app.ts';
import { apiVersion } from './keelwerk.generated.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const dates = ['2026-11-04', '2026-11-11'] as const;

async function committed(name: string): Promise<string> {
  return readFile(`${root}generated/api-surface/versioned/${name}`, 'utf8');
}

/** The roster module as it was before the change: the field was called `name`. */
function rosterBefore() {
  const contact = defineEntity({
    prefix: 'ctc',
    fields: { name: field.string({ maxLength: 100 }) },
    generated: { watch: false },
  });
  const base = defineModuleBase({ id: 'roster', version: '1.0.0', entities: { contact } });
  const editors = defineRule(base, contact, {
    effect: 'allow',
    actions: ['read', 'write'],
    principal: 'user',
    reason: 'A signed-in user reads and edits contacts.',
  });
  return defineModule(base, { policies: { contact: { editors } } });
}

describe('the versioned fixture app: one surface per API version (section 18.2)', () => {
  test.each(dates)('%s is the committed artefact, byte for byte', async (date) => {
    expect(renderSurfaceArtefact(deriveSurface(versioned, date).surface)).toBe(
      await committed(`${date}.json`),
    );
  });

  test('the generated file names the head version', () => {
    expect(apiVersion).toBe('2026-11-11');
    expect(versioned.api?.head).toBe(apiVersion);
  });

  test('the older version names the older field, the head the newer one', () => {
    const fieldsAt = (date: string) =>
      Object.keys(
        deriveSurface(versioned, date).surface.entities.find(
          (entity) => entity.ref === 'roster.contact',
        )?.fields ?? {},
      );
    expect(fieldsAt('2026-11-04')).toContain('name');
    expect(fieldsAt('2026-11-04')).not.toContain('displayName');
    expect(fieldsAt('2026-11-11')).toContain('displayName');
    expect(fieldsAt('2026-11-11')).not.toContain('name');
  });

  test('the ledger renders as committed and checkLedger finds nothing with the registered ids', async () => {
    const text = await committed('ledger.json');
    const ledger = parseApiVersionLedger(text);
    expect(renderApiVersionLedger(ledger)).toBe(text);
    const implied = dates.map((date) => {
      const { surface } = deriveSurface(versioned, date);
      return {
        version: date,
        surfaceHash: surface.hash,
        modules: Object.fromEntries(surface.modules.map((item) => [item.id, item.version])),
        changes: date === '2026-11-04' ? [] : ['roster.contactDisplayName'],
      };
    });
    expect(
      checkLedger(ledger, 'versioned', implied, new Set(versioned.registry.versionChanges.keys())),
    ).toEqual([]);
  });

  test('the 2026-11-04 surface equals the surface of the module before the change', () => {
    const before = defineApp({
      id: 'versioned',
      modules: [rosterBefore()],
      api: defineApiVersions({ '2026-11-04': {}, '2026-11-11': {} }),
    });
    const translated = deriveSurface(versioned, '2026-11-04').surface;
    expect(diffSurfaces(deriveSurface(before, '2026-11-04').surface, translated)).toEqual([]);
  });

  test('no generated file of the app names a producer version', async () => {
    const files = [
      ...(await readdir(`${root}generated/api-surface/versioned`)).map(
        (name) => `${root}generated/api-surface/versioned/${name}`,
      ),
      ...(await readdir(`${root}generated/cli/versioned`)).map(
        (name) => `${root}generated/cli/versioned/${name}`,
      ),
      `${root}src/keelwerk.generated.ts`,
    ];
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      expect(text, file).not.toContain('producerVersion');
      expect(text, file).not.toMatch(/keelwerk \d/);
    }
  });
});
