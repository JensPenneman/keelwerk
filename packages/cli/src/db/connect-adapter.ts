import type {
  AdapterEnvironment,
  DataAdapter,
  DataAdapterFactory,
  PlacementConfig,
} from '@keelwerk/core';
import type { CliHost } from '../context/cli-host.ts';
import { localFailure } from '../context/local-failure.ts';
import { messageOf } from '../doctor/message-of.ts';
import { unanswered } from '../doctor/unanswered.ts';
import { withinDeadline } from '../doctor/within-deadline.ts';

/**
 * Creates and connects the adapter of one placement or of the control store, without migrating.
 * The connect, with the version and role checks in it, is waited for no longer than the deadline
 * of `schedule`. An adapter that does not connect is closed again, without waiting for it
 * beyond the deadline, before the failure is thrown.
 */
export async function connectAdapter(
  name: string,
  factory: DataAdapterFactory,
  config: PlacementConfig,
  environment: AdapterEnvironment,
  schedule: CliHost['schedule'],
): Promise<{ readonly adapter: DataAdapter; readonly dialect: string }> {
  let adapter: DataAdapter | undefined;
  try {
    adapter = factory.create(config, environment);
    await withinDeadline(schedule, adapter.connect(), unanswered);
    return { adapter, dialect: factory.dialect };
  } catch (error) {
    if (adapter !== undefined) {
      await withinDeadline(
        schedule,
        adapter.close(0).catch(() => undefined),
        () => undefined,
      );
    }
    throw localFailure('unavailable', 'cli.placement_unreachable', `${name}: ${messageOf(error)}`);
  }
}
