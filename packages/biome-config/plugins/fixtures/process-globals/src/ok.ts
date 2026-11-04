import process from 'node:process';

export function read(): string | undefined {
  return process.cwd();
}
