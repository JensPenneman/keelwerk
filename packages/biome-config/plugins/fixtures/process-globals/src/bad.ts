export function read(): string | undefined {
  return process.env.TOKEN; // expect: lint/style/noProcessEnv, lint/correctness/noProcessGlobal
}
