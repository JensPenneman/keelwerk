/** Whether `text` is a module id: kebab-case, starting with a letter. */
export function isModuleId(text: string): boolean {
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(text);
}
