import { kernelCommandIdPrefix } from './kernel-command-id-prefix.ts';

/** Whether a command id is in the form the kernel reserves for the commands it makes itself. */
export function isKernelCommandId(commandId: string): boolean {
  return commandId.startsWith(kernelCommandIdPrefix);
}
