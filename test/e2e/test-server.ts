// Test helper for the end-to-end tests. It starts the real service (src/index.ts) as a separate process
// with an in-memory SQLite database on a free port, so every test talks to the real thing over real HTTP.
// Call useFreshServer() at the top of a test file to get a brand new, empty server for every test.
// This file contains no tests itself.

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { afterEach, beforeEach } from 'vitest';

const PROJECT_ROOT = resolve(import.meta.dirname, '../..');
const STARTUP_TIMEOUT_MS = 15_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

// What a test gets back from a request: the status, the raw body text, the parsed JSON body and the headers.
export interface TestResponse {
  status: number;
  text: string;
  json: unknown;
  headers: Headers;
}

// The requests a test can make against its server.
export interface TestServer {
  // Sends a request. If body is given it is sent as JSON.
  send(method: string, path: string, body?: unknown): Promise<TestResponse>;

  // Sends a request with exactly the given text as the body, even if it is not valid JSON.
  sendRawBody(method: string, path: string, rawBody: string): Promise<TestResponse>;
}

// A server process that has been started, with the address to call it on and a way to stop it.
interface RunningServer {
  baseUrl: string;
  stop(): Promise<void>;
}

// Asks the operating system for a port that nothing else is using right now.
async function findFreePort(): Promise<number> {
  const probe = createServer();

  return new Promise((resolvePort, rejectPort) => {
    probe.once('error', rejectPort);
    probe.listen(0, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => {
        resolvePort(port);
      });
    });
  });
}

// Waits until the service prints that it is listening. Fails if it exits early or takes too long.
async function waitUntilListening(child: ChildProcess): Promise<void> {
  return new Promise((resolveReady, rejectReady) => {
    let output = '';

    const timer = setTimeout(() => {
      rejectReady(new Error(`Server did not start in time. Output so far:\n${output}`));
    }, STARTUP_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('listening on port')) {
        clearTimeout(timer);
        resolveReady();
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once('exit', () => {
      clearTimeout(timer);
      rejectReady(new Error(`Server exited before it was ready. Output:\n${output}`));
    });
  });
}

// Asks the server process to stop and waits for it to exit, forcing it if it takes too long.
async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  return new Promise((resolveStopped) => {
    const forceTimer = setTimeout(() => {
      child.kill('SIGKILL');
    }, SHUTDOWN_TIMEOUT_MS);

    child.once('exit', () => {
      clearTimeout(forceTimer);
      resolveStopped();
    });
    child.kill('SIGTERM');
  });
}

// Starts the real service on a free port with an empty in-memory database.
async function startServer(): Promise<RunningServer> {
  const port = await findFreePort();

  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: PROJECT_ROOT,
    // NODE_ENV is changed from "test" so the service logs its "listening" line, which we wait for below.
    env: { ...process.env, NODE_ENV: 'e2e', PORT: String(port), DATABASE_PATH: ':memory:' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitUntilListening(child);
  } catch (error) {
    await stopProcess(child);
    throw error;
  }

  return {
    baseUrl: `http://localhost:${String(port)}`,
    stop: () => stopProcess(child),
  };
}

// Turns the response body into JSON, or undefined if there is no body or it is not JSON.
function parseJsonOrUndefined(text: string): unknown {
  if (text === '') {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Makes one HTTP request and collects everything a test might want to check.
async function sendRequest(
  baseUrl: string,
  method: string,
  path: string,
  rawBody: string | undefined,
): Promise<TestResponse> {
  const init: RequestInit = { method };
  if (rawBody !== undefined) {
    init.body = rawBody;
    init.headers = { 'Content-Type': 'application/json' };
  }

  const response = await fetch(baseUrl + path, init);
  const text = await response.text();

  return {
    status: response.status,
    text,
    json: parseJsonOrUndefined(text),
    headers: response.headers,
  };
}

// Registers hooks so every test in the file gets its own new, empty server, then stops it afterwards.
export function useFreshServer(): TestServer {
  let running: RunningServer | undefined;

  beforeEach(async () => {
    running = await startServer();
  });

  afterEach(async () => {
    await running?.stop();
    running = undefined;
  });

  // Returns the address of the server for the current test.
  function currentBaseUrl(): string {
    if (running === undefined) {
      throw new Error('No test server is running. Call this from inside a test.');
    }
    return running.baseUrl;
  }

  return {
    send: (method, path, body) => {
      const rawBody = body === undefined ? undefined : JSON.stringify(body);
      return sendRequest(currentBaseUrl(), method, path, rawBody);
    },
    sendRawBody: (method, path, rawBody) => sendRequest(currentBaseUrl(), method, path, rawBody),
  };
}

// Builds the path for GET /tax-position with the date properly encoded (so a "+" in an offset survives).
export function taxPositionPath(date: string): string {
  return `/tax-position?date=${encodeURIComponent(date)}`;
}
