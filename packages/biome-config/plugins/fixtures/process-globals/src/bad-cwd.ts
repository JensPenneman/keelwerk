export function where(): string {
  return process.cwd(); // expect: lint/correctness/noProcessGlobal
}
