export function reset(): void {
  Object = null; // expect: lint/suspicious/noGlobalAssign
}
