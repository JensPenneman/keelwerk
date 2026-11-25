import type { StorageRow } from '@keelwerk/core';
import type { ControlReader } from './control-reader.ts';
import type { ControlSource } from './control-source.ts';
import type { ProcessFact } from './deployment-facts.ts';
import { doctorReadBounds } from './doctor-read-bounds.ts';
import { heldTenantsOf } from './held-tenants-of.ts';
import { hookFailuresOf } from './hook-failures-of.ts';
import { messageOf } from './message-of.ts';
import { walkPages } from './walk-pages.ts';

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function processFactOf(row: StorageRow, now: Temporal.Instant): ProcessFact {
  const beat = row.heartbeatAt;
  return {
    id: textOf(row.id) ?? '',
    name: textOf(row.name),
    roles: Array.isArray(row.roles) ? row.roles.map(String) : [],
    state: textOf(row.state) ?? 'unknown',
    heartbeatAgeMs:
      beat instanceof Temporal.Instant
        ? now.epochMilliseconds - beat.epochMilliseconds
        : Number.POSITIVE_INFINITY,
  };
}

/**
 * A reader over the core's control store: `core.process` for the processes, the event log for
 * failed tenant hooks. `now` is the clock the heartbeat ages are measured against.
 */
export function controlReaderOf(source: ControlSource, now: () => Temporal.Instant): ControlReader {
  return {
    reachable: async () => {
      try {
        await source.read((unit, entity) => unit.rows.count(entity('core.process')));
        return { reachable: true, detail: 'answered' };
      } catch (error) {
        return { reachable: false, detail: messageOf(error) };
      }
    },
    processes: () =>
      source.read(async (unit, entity) => {
        const processes: ProcessFact[] = [];
        let after: string | undefined;
        await walkPages(async () => {
          const page = await unit.rows.find(entity('core.process'), {
            where: { op: 'ne', field: 'state', value: 'stopped' },
            sort: [{ field: 'id', direction: 'asc' }],
            page: { first: doctorReadBounds.pageSize, ...(after === undefined ? {} : { after }) },
          });
          for (const row of page.rows) processes.push(processFactOf(row, now()));
          if (!page.pageInfo.hasNextPage) return false;
          if (page.pageInfo.endCursor === null) {
            throw new Error('the control store said that more rows follow and gave no cursor');
          }
          after = page.pageInfo.endCursor;
          return true;
        });
        return processes;
      }),
    hookFailures: () => source.read(hookFailuresOf),
    bumpedMarks: () => source.read((unit) => unit.marks?.bumped() ?? Promise.resolve([])),
    heldTenants: () => source.read(heldTenantsOf),
  };
}
