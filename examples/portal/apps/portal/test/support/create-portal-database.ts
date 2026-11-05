import pg from 'pg';
import { inject } from 'vitest';

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/** The two connection urls of a database: the owner's and the application role's. */
export interface PortalDatabase {
  readonly adminUrl: string;
  readonly appUrl: string;
}

/** Creates an empty database on the shared cluster, so each suite owns its tables and rows. */
export async function createPortalDatabase(name: string): Promise<PortalDatabase> {
  const cluster = inject('portalCluster');
  const admin = new pg.Client({ connectionString: cluster.adminUrl });
  await admin.connect();
  try {
    await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }
  return {
    adminUrl: withDatabase(cluster.adminUrl, name),
    appUrl: withDatabase(cluster.appUrl, name),
  };
}
