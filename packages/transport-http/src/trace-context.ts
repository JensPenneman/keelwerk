const traceparentPattern = /^[0-9a-f]{2}-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

/** The `traceparent` header when it is a well-formed W3C trace context with non-zero ids, else undefined. */
export function traceContext(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }
  const match = traceparentPattern.exec(value.trim());
  if (match === null || /^0+$/.test(match[1] ?? '') || /^0+$/.test(match[2] ?? '')) {
    return undefined;
  }
  return value.trim();
}
