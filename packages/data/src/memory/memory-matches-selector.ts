import type { EventSelector } from '@keelwerk/core';
import type { MemoryLoggedEvent } from './memory-logged-event.ts';

/** Whether an event is in the selector; a name may be local ('changed') or full ('app.note.changed'). */
export function memoryMatchesSelector(
  logged: MemoryLoggedEvent,
  selector: EventSelector | undefined,
): boolean {
  if (selector === undefined) return true;
  const { event, name } = logged;
  if (selector.streamTypes !== undefined && !selector.streamTypes.includes(event.stream.type)) {
    return false;
  }
  if (selector.partition !== undefined && event.partition !== selector.partition) return false;
  if (
    selector.names !== undefined &&
    !selector.names.includes(name) &&
    !selector.names.includes(event.type)
  ) {
    return false;
  }
  if (
    selector.streams !== undefined &&
    !selector.streams.some(
      (stream) => stream.type === event.stream.type && stream.id === event.stream.id,
    )
  ) {
    return false;
  }
  return true;
}
