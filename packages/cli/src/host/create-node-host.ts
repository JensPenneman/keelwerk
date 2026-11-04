import { homedir } from 'node:os';
import { cwd, env, stdin, stdout } from 'node:process';
import { newUuidV7 } from '@keelwerk/core';
import type { CliHost } from '../context/cli-host.ts';
import { fetchSocket } from './fetch-socket.ts';
import { nodeHostFiles } from './node-host-files.ts';
import { promptSecret } from './prompt-secret.ts';
import { readAll } from './read-all.ts';

/** The machine the binary runs on: the process environment, the file system, the network and the terminal. */
export function createNodeHost(): CliHost {
  return {
    env,
    cwd: cwd(),
    homeDir: homedir(),
    interactive: stdout.isTTY,
    stdinInteractive: stdin.isTTY === true,
    files: nodeHostFiles,
    fetch: (url, request) => fetch(url, request),
    fetchSocket,
    now: () => Date.now(),
    newId: newUuidV7,
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    readStdin: () => readAll(stdin),
    promptSecret,
  };
}
