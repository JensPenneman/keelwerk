import type { CliHost } from '../context/cli-host.ts';
import { doctorReadBounds } from './doctor-read-bounds.ts';

/**
 * What `work` answers, or what `late` gives when the deadline of a read has passed first (it may
 * throw). The timer is the host's, so a case can step it, and it is cancelled as soon as `work`
 * has settled. `work` is not waited for after the deadline.
 */
export function withinDeadline<T>(
  schedule: CliHost['schedule'],
  work: Promise<T>,
  late: () => T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cancel = schedule(doctorReadBounds.deadlineMs, () => {
      try {
        resolve(late());
      } catch (error) {
        reject(error);
      }
    });
    work.then(
      (value) => {
        cancel();
        resolve(value);
      },
      (error: unknown) => {
        cancel();
        reject(error);
      },
    );
  });
}
