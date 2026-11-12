import type { ConsumerSpec } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { consumers, reactionDispatcher } from '@keelwerk/events';

/** Every value planted through a path of the inventory. */
const dumpMarker = {
  email: 'erasure.dump.marker@example.test',
  notes: 'dump marker private note',
  topic: 'dump marker topic',
  beaReply: 'dump marker bea reply',
  adaReply: 'dump marker ada reply',
  tag: 'dump marker personal tag',
  claim: 'dump.claim.marker@example.test',
  address: 'dump marker async address',
  deadAddress: 'dump marker dead job address',
  deliver: 'dump.deliver.marker@example.test',
  contact: 'dump marker relay contact',
  timed: 'dump marker timer address',
  token: 'dump marker credential token',
  effectOutput: 'dump marker effect output',
  effectRefusal: 'dump marker effect refusal',
  parkedCause: 'dump marker parked cause',
};

/** Values a module wrote into a job key: the dump test pins that they are still found (WP-130). */
const gapMarker = { jobKey: 'dump gap job key address' };

/** A consumer that refuses every person for good, with an error that quotes a marker: its stream is parked. */
const parkingConsumer: ConsumerSpec = {
  id: 'probe.parker',
  selector: { streamTypes: ['probe.person'] },
  start: 'beginning',
  maxAttempts: 1,
  consume: () => Promise.reject(errors.validation(`Refused ${dumpMarker.parkedCause}`)),
};

/** The event worker of the dump tests: the reaction dispatcher and a consumer that parks. */
function dumpDispatcher(): ReturnType<typeof consumers> {
  return consumers({
    consumers: [reactionDispatcher(), parkingConsumer],
    runs: ['asyncReactions'],
  });
}

export { dumpDispatcher, dumpMarker, gapMarker };
