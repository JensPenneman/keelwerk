/** What the test saw of the subscription bodies a deployment answered. */
export interface StreamTap {
  /** The body of the newest stream has carried its `head` event: the subscription is registered on the server. */
  headSeen: boolean;
  /** The first stream was cut after its first `data` event. */
  cut: boolean;
  /** The request bodies of every `/subscribe`, in order. */
  readonly bodies: string[];
  /** How many `/subscribe` requests were let through to the deployment (the second one waits at the gate). */
  forwarded: number;
  /** The second `/subscribe` is not forwarded to the deployment before this settles. */
  readonly gate: Promise<void>;
  /** Lets the second `/subscribe` through. */
  readonly release: () => void;
}

export function newTap(): StreamTap {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { headSeen: false, cut: false, forwarded: 0, bodies: [], gate, release };
}

/**
 * The response with its body observed; with `cutAfterData` the first stream breaks, as a dropped
 * link does, right after it delivered its first `data` event.
 */
export function tapped(tap: StreamTap, response: Response, cutAfterData: boolean): Response {
  if (response.body === null) return response;
  const reader = response.body.getReader();
  let breakNext = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (breakNext) {
        tap.cut = true;
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
      if (text.includes('event: head')) tap.headSeen = true;
      if (cutAfterData && !tap.cut && text.includes('event: data')) breakNext = true;
      controller.enqueue(chunk.value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
  return new Response(body, { status: response.status, headers: response.headers });
}
