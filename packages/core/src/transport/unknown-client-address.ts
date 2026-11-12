/**
 * The address a connection-less carrier is counted under, wherever a limit is kept per client
 * address: every such caller shares this one key, so having no address is never a way past a bucket.
 */
export const unknownClientAddress = 'unknown';
