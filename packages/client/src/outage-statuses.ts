/** The answers of a host that is down or draining, or of a proxy or gate that cannot reach it: try again soon. */
export const outageStatuses: ReadonlySet<number> = new Set([408, 502, 503, 504]);
