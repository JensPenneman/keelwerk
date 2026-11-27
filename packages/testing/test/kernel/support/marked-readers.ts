import {
  openEffectInput,
  openPersonalMembers,
  openStoredEvents,
  openStoredRecords,
} from '@keelwerk/core';
import type { Site } from './marked-grid.ts';
import { feed } from './marked-skeleton.ts';

type Query = (sql: string) => Promise<readonly Record<string, unknown>[]>;

/** What the readers need of a started runtime. */
interface Readable {
  readonly app: { readonly registry: never };
  readonly sealed: {
    unit: (ns: unknown, s: unknown, f: (u: never) => Promise<unknown>) => Promise<unknown>;
  };
  readonly namespace: unknown;
  readonly backendId: string;
  readonly tenants: { acme: { id: string } };
}

/** What the kernel opens, as one text (all the jobs of one action at a command input), and the members it is judged for. */
interface View {
  readonly label: string;
  readonly members: readonly string[];
  readonly text: string;
}

const show = (_key: string, value: unknown) =>
  typeof value === 'bigint'
    ? value.toString()
    : value instanceof Uint8Array
      ? Buffer.from(value).toString('utf8')
      : value instanceof Set
        ? [...value]
        : value;

/** Every job of the dump, queued or ended, with its action, its command id and its stored input. */
async function jobsOf(queries: readonly Query[]) {
  const jobs: { action: string; commandId: string; input: unknown }[] = [];
  for (const query of queries) {
    for (const { schemaname } of await query(
      `select schemaname from pg_tables where tablename = 'kw_jobs'`,
    )) {
      for (const row of await query(`select input from "${String(schemaname)}"."kw_jobs"`)) {
        const input = typeof row.input === 'string' ? JSON.parse(row.input) : row.input;
        if (typeof input === 'object' && input !== null) jobs.push(input as never);
      }
    }
  }
  return jobs;
}

/**
 * Everything the kernel opens at a site, in views: rows, events, records and effect inputs as one
 * view; at a command input, one view for each job (queued or ended) and each personal member, so
 * that a member the erasure missed shows even when another member of the job is gone.
 */
async function readViews(
  runtime: Readable,
  site: Site,
  queries: readonly Query[],
  personal: readonly string[],
): Promise<readonly View[]> {
  const registry = runtime.app.registry as never as {
    entities: Map<string, { descriptor: unknown }>;
    actions: Map<string, { input: { fields: Record<string, unknown> } }>;
    effects: Map<string, never>;
  };
  const scope = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme.id,
  };
  const jobs = site === 'commandInput' ? await jobsOf(queries) : [];
  return (await runtime.sealed.unit(runtime.namespace, scope, async (unit) => {
    const u = unit as never as {
      rows: { find: (d: unknown, o: object) => Promise<{ rows: Record<string, unknown>[] }> };
      events: { readAll: (a: null, o: object) => Promise<{ events: unknown[] }> };
      streams: { read: (s: string, k: string, a: null, n: number) => Promise<unknown[]> };
    };
    const holder = registry.entities.get('mp.holder')?.descriptor;
    const rows = (await u.rows.find(holder, { includeArchived: true, includeErased: true })).rows;
    const events = (await u.events.readAll(null, { limit: 1000, includeTransient: true })).events;
    const opened = await openStoredEvents(unit as never, events as never);
    const records: unknown[] = [];
    for (const row of rows) {
      const stored = await u.streams.read('mp.log', String(row.id), null, 10);
      records.push(
        await openStoredRecords(
          unit as never,
          { stream: 'mp.log', key: String(row.id), personal, records: stored } as never,
        ),
      );
    }
    const opens: unknown[] = [];
    const effectRows =
      site === 'effectInput'
        ? (await u.rows.find(registry.entities.get('core.effect')?.descriptor, {})).rows
        : [];
    for (const row of effectRows) {
      const effect = registry.effects.get(String(row.type));
      if (effect === undefined || typeof row.input !== 'object' || row.input === null) continue;
      try {
        const { input } = await openEffectInput(
          unit as never,
          effect,
          String(row.id),
          row.input as never,
        );
        opens.push(input);
      } catch {
        // A destroyed key reads as absent.
      }
    }
    const whole: View = {
      label: site,
      members: personal,
      text: JSON.stringify(
        { rows, opened: opened.map((e: { data: unknown }) => e.data), records, opens },
        show,
      ),
    };
    const perMember = new Map<string, string>();
    for (const job of jobs) {
      const fields = registry.actions.get(job.action)?.input.fields;
      if (fields === undefined || !job.action.startsWith('mp.')) continue;
      for (const name of personal) {
        let text = '';
        try {
          const member = { fields: { [name]: fields[name] } };
          const value = { [name]: (job.input as Record<string, unknown>)[name] };
          const binding = { id: job.commandId, lost: 'gone' };
          text = JSON.stringify(
            await openPersonalMembers(unit as never, binding, member as never, value),
            show,
          );
        } catch {
          // A destroyed key reads as absent.
        }
        const label = `${job.action} ${name}`;
        perMember.set(label, `${perMember.get(label) ?? ''}\n${text}`);
      }
    }
    return site === 'commandInput'
      ? [...perMember].map(([label, text]) => ({
          label,
          members: [label.split(' ')[1] ?? ''],
          text,
        }))
      : [whole];
  })) as readonly View[];
}

/**
 * What an effect output claims at its place: both effects of `mp.ping` settled with an output
 * stored, and the continuation of each ran. Empty at every other place and when all of that is so.
 */
async function settledFindings(
  runtime: Readable,
  site: Site,
  expected: number,
): Promise<readonly string[]> {
  if (site !== 'effectOutput') return [];
  const registry = runtime.app.registry as never as {
    entities: Map<string, { descriptor: unknown }>;
  };
  const scope = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme.id,
  };
  const rows = (await runtime.sealed.unit(runtime.namespace, scope, async (unit) => {
    const u = unit as never as {
      rows: { find: (d: unknown, o: object) => Promise<{ rows: Record<string, unknown>[] }> };
    };
    return (await u.rows.find(registry.entities.get('core.effect')?.descriptor, {})).rows;
  })) as readonly Record<string, unknown>[];
  const pings = rows.filter((row) => row.type === 'mp.ping');
  const found: string[] = [];
  if (pings.length !== expected)
    found.push(`expected ${expected} effects of mp.ping, found ${pings.length}`);
  for (const row of pings) {
    if (row.status !== 'succeeded' || row.output === null || row.output === undefined)
      found.push(`an effect of mp.ping is ${String(row.status)} with no output stored`);
  }
  if (feed.continued !== expected)
    found.push(`${feed.continued} continuations ran, not ${expected}`);
  return found;
}

export type { Readable, View };
export { readViews, settledFindings };
