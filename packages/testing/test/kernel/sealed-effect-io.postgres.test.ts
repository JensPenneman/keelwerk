import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { describe, test } from 'vitest';
import { createTestDatabase } from '../support/create-test-database.ts';
import { bootCourier, dottedSubjectCase, personalInputCase } from './support/sealed-effect-kit.ts';

/** A runtime over a database of its own on the shared cluster. */
async function bootOn(name: string) {
  const urls = await createTestDatabase(name);
  return bootCourier('memory', {
    factory: postgresAdapter({ ownerUrl: urls.adminUrl }),
    url: urls.appUrl,
  });
}

describe('sealed effect input on PostgreSQL (S-127)', () => {
  test('a dotted dataSubject through rows the same decision creates seals the effect input and its record events', {
    timeout: 120_000,
  }, async () => {
    const booted = await bootOn('sealed_effect_dotted');
    await dottedSubjectCase(booted);
    await booted.runtime.stop();
  });

  test('personal effect input opens only through the subject key', {
    timeout: 120_000,
  }, async () => {
    const booted = await bootOn('sealed_effect_personal');
    await personalInputCase(booted);
    await booted.runtime.stop();
  });
});
