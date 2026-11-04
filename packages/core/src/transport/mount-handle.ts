export interface MountHandle {
  /** Stops accepting, ends streams with a going-away signal, resolves when in-flight work is done or the deadline aborts. */
  close(deadline: AbortSignal): Promise<void>;
}
