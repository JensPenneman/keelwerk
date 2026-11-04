import { errors } from '@keelwerk/core';
import type pg from 'pg';

/** The oldest server major the adapter runs on: only 18 is verified (14.3.7). */
const minimumMajor = 18;

/** Refuses a server older than the adapter supports; returns the major version. */
export async function checkServerVersion(client: pg.ClientBase): Promise<number> {
  const result = await client.query<{ readonly version: string }>(
    `select current_setting('server_version_num') as version`,
  );
  const major = Math.floor(Number(result.rows[0]?.version) / 10_000);
  if (!Number.isInteger(major) || major < minimumMajor) {
    throw errors.unsupported(
      `PostgreSQL ${minimumMajor} or newer is required, found major ${major}`,
    );
  }
  return major;
}
