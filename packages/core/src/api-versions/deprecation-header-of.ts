import { declaredInstantOf } from './declared-instant-of.ts';

/** The `Deprecation` header value (RFC 9745, `@<seconds>`) for a declared `at`, or undefined when the text names no instant (`declaredInstantOf`). The one writer both HTTP transports use (18.5). */
export function deprecationHeaderOf(at: string): string | undefined {
  const instant = declaredInstantOf(at);
  return instant === undefined ? undefined : `@${Math.floor(instant.epochMilliseconds / 1000)}`;
}
