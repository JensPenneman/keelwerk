/**
 * Whether a resolver's id belongs to the module that fills it: the id starts with the module's id
 * and a dot (section 8.5). The core's own fills, which the test harness adds after composition,
 * keep the ids they have.
 */
// The kernel's module may carry any id: its name is reserved (no app can declare it) and the harness answers as the kernel.
export function ownsResolverId(module: string, id: unknown): boolean {
  return module === 'core' || (typeof id === 'string' && id.startsWith(`${module}.`));
}
