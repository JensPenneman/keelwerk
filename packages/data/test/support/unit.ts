import type { Client } from 'pg';
import type { Settings } from './settings.ts';

/** One unit: the settings are transaction-local, as the adapter sets them. */
export async function unit<T>(
  client: Client,
  settings: Settings,
  work: () => Promise<T>,
): Promise<T> {
  await client.query('begin');
  try {
    for (const [key, value] of Object.entries(settings)) {
      await client.query('select set_config($1, $2, true)', [key, value]);
    }
    const result = await work();
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}
