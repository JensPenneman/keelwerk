import type { LiveFrame, WireError } from '@keelwerk/core';
import { backoffDelay } from './backoff-delay.ts';
import type { LiveLeg, LiveLegRequest } from './live-leg.ts';
import type { LiveLegEvent } from './live-leg-event.ts';
import type { ResumeOptions } from './resume-options.ts';

const retired: WireError = {
  kind: 'not_found',
  code: 'core.api_version_retired',
  message: 'The API version of this subscription is no longer served.',
  retryable: false,
  requestId: '',
};

const closedEarly: WireError = {
  kind: 'unavailable',
  code: 'core.unavailable',
  message: 'The server closed the connection before it sent a frame.',
  retryable: true,
  requestId: '',
};

/**
 * A subscription that resumes from its last token (16.8.4, 16.9.5). A dropped connection, or an `end`
 * of `going_away` or `max_duration`, reopens after a backoff from the last token (the last item's
 * state or `head`); before the first frame `retry.retries` failed opens end the iteration with the
 * last failure, afterwards it never gives up until the signal aborts. `end` `complete` ends it;
 * `version_retired` and an `error` event are thrown through `options.failure`. A reset with the reason
 * `overflow` and a state reopens from that state and is not yielded; any other reset is yielded and the
 * subscription then reopens with its input and no token. The iterator is an object, not an async
 * generator: `return()` with a `next()` pending aborts the open connection at once.
 */
export function resumeFrames(
  open: LiveLeg,
  request: Omit<LiveLegRequest, 'after'>,
  options: ResumeOptions,
): AsyncIterable<LiveFrame<unknown>> {
  const iterate = (): AsyncIterator<LiveFrame<unknown>> => {
    let after = options.after;
    let leg: { iterator: AsyncIterator<LiveLegEvent>; abort: AbortController } | undefined;
    let ended = false;
    let received = false;
    /** Failed opens, and reopenings, since the last frame. */
    let consecutive = 0;
    let failedOpens = 0;
    let startAgain = false;
    const stop = new AbortController();
    const gone = new Promise<'gone'>((resolve) => {
      stop.signal.addEventListener('abort', () => resolve('gone'), { once: true });
    });
    const abortAll = (): void => stop.abort();
    if (options.signal?.aborted === true) stop.abort();
    else options.signal?.addEventListener('abort', abortAll, { once: true });

    const closeLeg = async (): Promise<void> => {
      const current = leg;
      leg = undefined;
      if (current === undefined) return;
      current.abort.abort();
      await current.iterator.return?.(undefined)?.catch(() => undefined);
    };
    const finish = async (): Promise<IteratorResult<LiveFrame<unknown>>> => {
      ended = true;
      options.signal?.removeEventListener('abort', abortAll);
      stop.abort();
      await closeLeg();
      return { done: true, value: undefined };
    };
    const wait = async (): Promise<void> => {
      const delay = backoffDelay(options.retry, Math.max(0, consecutive - 1));
      consecutive += 1;
      await options.retry.sleep(delay, stop.signal).catch(() => undefined);
    };
    const connect = async (): Promise<void> => {
      const abort = new AbortController();
      const link = (): void => abort.abort();
      if (stop.signal.aborted) abort.abort();
      else stop.signal.addEventListener('abort', link, { once: true });
      const opening = open({ ...request, ...(after !== undefined && { after }) }, abort.signal);
      const frames = await Promise.race([opening, gone]);
      if (frames === 'gone') {
        // Stopped while opening: the connection that arrives later is closed unread.
        abort.abort();
        void opening.then(
          (late) => late[Symbol.asyncIterator]().return?.(undefined),
          () => undefined,
        );
        return;
      }
      leg = { iterator: frames[Symbol.asyncIterator](), abort };
    };

    return {
      async next() {
        for (;;) {
          if (ended) return { done: true, value: undefined };
          if (stop.signal.aborted) return finish();
          if (startAgain) {
            startAgain = false;
            after = undefined;
            await closeLeg();
          }
          if (leg === undefined) {
            try {
              await connect();
            } catch (failure) {
              if (stop.signal.aborted) return finish();
              if (!options.dropped(failure)) {
                await finish();
                throw failure;
              }
              failedOpens += 1;
              if (!received && failedOpens > options.retry.retries) {
                await finish();
                throw failure;
              }
              await wait();
              continue;
            }
          }
          const current = leg;
          if (current === undefined) continue;
          let step: IteratorResult<LiveLegEvent>;
          try {
            const raced = await Promise.race([current.iterator.next(), gone]);
            if (raced === 'gone') return finish();
            step = raced;
          } catch (failure) {
            if (stop.signal.aborted) return finish();
            await closeLeg();
            if (!options.dropped(failure)) {
              await finish();
              throw failure;
            }
            failedOpens += 1;
            if (!received && failedOpens > options.retry.retries) {
              await finish();
              throw failure;
            }
            await wait();
            continue;
          }
          if (step.done === true) {
            if (stop.signal.aborted) return finish();
            await closeLeg();
            failedOpens += 1;
            if (!received && failedOpens > options.retry.retries) {
              await finish();
              throw options.failure(closedEarly);
            }
            await wait();
            continue;
          }
          const event = step.value;
          if (event.kind === 'error') {
            await finish();
            throw options.failure(event.error);
          }
          if (event.kind === 'end') {
            if (event.reason === 'complete') return finish();
            if (event.reason === 'version_retired') {
              await finish();
              throw options.failure(retired);
            }
            await closeLeg();
            failedOpens += 1;
            if (!received && failedOpens > options.retry.retries) {
              await finish();
              throw options.failure(closedEarly);
            }
            await wait();
            continue;
          }
          const frame = event.frame;
          if ('control' in frame && frame.control === 'reset') {
            if (frame.reason === 'overflow' && frame.state !== undefined) {
              after = frame.state;
              await closeLeg();
              continue;
            }
            startAgain = true;
            received = true;
            consecutive = 0;
            failedOpens = 0;
            return { done: false, value: frame };
          }
          if (!('control' in frame)) {
            if (frame.state !== undefined) after = frame.state;
          } else if (frame.control === 'head') {
            after = frame.state;
          }
          received = true;
          consecutive = 0;
          failedOpens = 0;
          return { done: false, value: frame };
        }
      },
      async return() {
        return finish();
      },
    };
  };
  return { [Symbol.asyncIterator]: iterate };
}
