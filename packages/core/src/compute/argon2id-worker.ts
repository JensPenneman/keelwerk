import { parentPort } from 'node:worker_threads';
import type { Argon2idJob } from './run-argon2id-job.ts';
import { runArgon2idJob } from './run-argon2id-job.ts';

const port = parentPort;
// biome-ignore lint/plugin: this file is a worker entry point, which runs when the worker starts and is never imported
port?.on('message', (job: Argon2idJob) => port.postMessage(runArgon2idJob(job)));
