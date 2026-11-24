/** What the test saw of the subscription bodies a deployment answered. */
export interface StreamTap {
  /** Settles when a stream body has carried its `head` event: the subscription is registered on the server. */
  readonly headSeen: Promise<void>;
  /** Settles when the first stream was cut after its first `data` event. */
  readonly cut: Promise<void>;
  /** Settles when the second `/subscribe` reached the deployment's host and waits at the gate. */
  readonly reopened: Promise<void>;
  /** Called by the host for the second `/subscribe`. */
  readonly reopenedNow: () => void;
  /** The request bodies of every `/subscribe`, in order. */
  readonly bodies: string[];
  /** How many `/subscribe` requests were let through to the deployment (the second one waits at the gate). */
  forwarded: number;
  /** The second `/subscribe` is not forwarded to the deployment before this settles. */
  readonly gate: Promise<void>;
  /** Lets the second `/subscribe` through. */
  readonly release: () => void;
  /** Called by `tapped` when a body carried `head`. */
  readonly seenHead: () => void;
  /** Called by `tapped` when it cut the first stream. */
  readonly wasCut: () => void;
}

export function newTap(): StreamTap {
  const gate = Promise.withResolvers<void>();
  const head = Promise.withResolvers<void>();
  const cut = Promise.withResolvers<void>();
  const reopened = Promise.withResolvers<void>();
  return {
    headSeen: head.promise,
    cut: cut.promise,
    reopened: reopened.promise,
    forwarded: 0,
    bodies: [],
    gate: gate.promise,
    release: gate.resolve,
    reopenedNow: reopened.resolve,
    seenHead: head.resolve,
    wasCut: cut.resolve,
  };
}

/**
 * The response with its body observed; with `cutAfterData` the first stream breaks, as a dropped
 * link does, right after it delivered its first `data` event.
 */
export function tapped(tap: StreamTap, response: Response, cutAfterData: boolean): Response {
  if (response.body === null) return response;
  const reader = response.body.getReader();
  let breakNext = false;
  let cutDone = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (breakNext) {
        cutDone = true;
        tap.wasCut();
        await reader.cancel().catch(() => undefined);
        controller.error(new TypeError('terminated'));
        return;
      }
      const chunk = await reader.read();
      if (chunk.done) {
        controller.close();
        return;
      }
      const text = new TextDecoder().decode(chunk.value);
      if (text.includes('event: head')) tap.seenHead();
      if (cutAfterData && !cutDone && text.includes('event: data')) breakNext = true;
      controller.enqueue(chunk.value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
  return new Response(body, { status: response.status, headers: response.headers });
}
