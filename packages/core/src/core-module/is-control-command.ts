/** Whether `ref` names an explicit command only the runtime's control path runs (S-109): they make the rows of the control plane. */
export function isControlCommand(ref: string): boolean {
  switch (ref) {
    case 'core.backend.create':
    case 'core.tenant.create':
      return true;
    default:
      return false;
  }
}
