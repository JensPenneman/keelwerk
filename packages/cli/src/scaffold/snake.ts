/** `mailbox-entry` becomes `mailbox_entry`. */
export function snake(kebabName: string): string {
  return kebabName.replaceAll('-', '_');
}
