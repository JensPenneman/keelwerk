import { recordingLive } from './recording-live.ts';

/** The live module with a hub whose buffers hold 20 items and 8 KiB and whose visibility set holds 3 ids: a copy of the real module, for the overflow and saturation tests. `smallHubs` lists the hub of each runtime that served it. */
const small = recordingLive({
  maxBufferedItems: 20,
  maxBufferedBytes: 8192,
  visibilityBound: 3,
});

export const smallLive = small.module;
export const smallHubs = small.opened;
