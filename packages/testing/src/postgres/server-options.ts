/**
 * The server's options: `max_connections` 200, as the container starts it and as `startServer`
 * starts it again.
 */
export const serverOptions = ['-c', 'max_connections=200'] as const;
