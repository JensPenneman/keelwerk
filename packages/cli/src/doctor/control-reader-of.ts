import type { ControlReader } from './control-reader.ts';
import type { ControlSource } from './control-source.ts';
import type { ProcessFact } from './deployment-facts.ts';
import { hookFailuresOf } from './hook-failures-of.ts';

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * A reader over the core's control store: `core.process` for the processes, the event log for
 * failed tenant hooks. `now` is the clock the heartbeat ages are measured against.
 */
export function controlReaderOf(source: ControlSource, now: () => Temporal.Instant): ControlReader {
  const anchorSinks = source.anchorSinks?.bind(source);
  return {
    ...(anchorSinks === undefined ? {} : { anchorSinks }),
    reachable: async () => {
      try {
        await source.read((unit) => unit.rows.count(source.entity('core.process')));
        return { reachable: true, detail: 'answered' };
      } catch (error) {
        return { reachable: false, detail: error instanceof Error ? error.message : String(error) };
      }
    },
    processes: async () => {
      const page = await source.read((unit) => unit.rows.find(source.entity('core.process'), {}));
      return page.rows.map((row): ProcessFact => {
        const beat = row.heartbeatAt;
        return {
          id: textOf(row.id) ?? '',
          name: textOf(row.name),
          roles: Array.isArray(row.roles) ? row.roles.map(String) : [],
          state: textOf(row.state) ?? 'unknown',
          heartbeatAgeMs:
            beat instanceof Temporal.Instant
              ? now().epochMilliseconds - beat.epochMilliseconds
              : Number.POSITIVE_INFINITY,
        };
      });
    },
    hookFailures: () => source.read(hookFailuresOf),
  };
}
