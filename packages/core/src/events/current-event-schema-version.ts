/**
 * The event schema version that generated and domain events are written with now (section 15.1.9).
 * An event stored with another version was written by an older build; its payload is not upcast
 * until the kernel reads it.
 */
export const currentEventSchemaVersion = 1;
