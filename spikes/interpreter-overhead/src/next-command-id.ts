let counter = 0;

/** A fresh command id, so no run is answered from a receipt. */
export function nextCommandId(): string {
  counter += 1;
  return `00000000-0000-7000-8000-${String(counter).padStart(12, '0')}`;
}
