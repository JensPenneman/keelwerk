import pg from 'pg';

/** What `createPostgresClient` takes: the driver's settings and the owner's handler of errors. */
export interface PostgresClientSettings extends pg.ClientConfig {
  /**
   * Called with every error the client emits once it is connected: the server ended the connection
   * or the socket failed. The owner reads the error's message and never logs the object: the driver
   * does not promise what an error carries, and a client's options hold the password.
   */
  onError(error: Error): void;
}

/**
 * The one place a client that is not the pool's is created. The handler of its errors is attached
 * before the client is returned, so no state of the client lacks one: an `error` event that nobody
 * handles would end the process. An error while the client is connecting rejects `connect()`
 * instead.
 */
export function createPostgresClient(settings: PostgresClientSettings): pg.Client {
  const { onError, ...config } = settings;
  const client = new pg.Client(config);
  client.on('error', onError);
  return client;
}
