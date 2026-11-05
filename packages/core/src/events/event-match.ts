/** What `EventStore.find` looks for: the events one command wrote, the events it caused, or one event by id. */
export type EventMatch =
  | { readonly commandId: string }
  | { readonly causationId: string }
  | { readonly eventId: string };
