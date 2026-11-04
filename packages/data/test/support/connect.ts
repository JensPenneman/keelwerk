import type { Client } from 'pg';
import pg from 'pg';

export async function connect(url: string): Promise<Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}
