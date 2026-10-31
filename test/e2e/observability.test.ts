// End-to-end tests for the observability endpoints (GET /health and GET /metrics) and for how the service
// behaves when something unexpected goes wrong. Most tests use a fresh in-memory service like the other e2e files.
// The "database breaks" tests need a database file they can sabotage, so they start their own server, below.

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildPayment } from '../unit/event-builders.js';
import { useFreshServer } from './test-server.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '../..');

// ---------------------------------------------------------------------------
// Tests that use the normal fresh in-memory service
// ---------------------------------------------------------------------------

describe('observability endpoints', () => {
  const server = useFreshServer();

  it('reports 200 and { "status": "ok" } on GET /health when the service is healthy', async () => {
    const response = await server.send('GET', '/health');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.json).toEqual({ status: 'ok' });
  });

  it('answers GET /metrics with 200 and plain text containing http_requests_total', async () => {
    // A request has to finish first: the counters only list requests that have already completed.
    await server.send('GET', '/health');

    const response = await server.send('GET', '/metrics');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(response.text).toContain('http_requests_total');
  });

  it('counts a request in GET /metrics after it has been made', async () => {
    const before = await server.send('GET', '/metrics');
    await server.send('POST', '/transactions', buildPayment('2024-01-05T00:00:00Z', 500));
    const after = await server.send('GET', '/metrics');

    const expectedLine = 'http_requests_total{method="POST",route="/transactions",status="202"} 1';
    expect(before.text).not.toContain(expectedLine);
    expect(after.text).toContain(expectedLine);
  });

  it('records how long requests took, in milliseconds, in GET /metrics', async () => {
    await server.send('POST', '/transactions', buildPayment('2024-01-05T00:00:00Z', 500));

    const response = await server.send('GET', '/metrics');

    expect(response.text).toContain(
      'http_request_duration_ms_count{method="POST",route="/transactions"} 1',
    );
    expect(response.text).toMatch(
      /http_request_duration_ms_sum\{method="POST",route="\/transactions"\} \d+\.\d{3}/,
    );
  });

  it('answers an unknown path with 404 and a "Not found" message', async () => {
    const response = await server.send('GET', '/no-such-path');

    expect(response.status).toBe(404);
    expect(response.json).toEqual({ errors: ['Not found'] });
  });

  it('counts every unknown path under one "unmatched" label so random URLs cannot flood the metrics', async () => {
    await server.send('GET', '/no-such-path-one');
    await server.send('GET', '/no-such-path-two');

    const response = await server.send('GET', '/metrics');

    expect(response.text).toContain(
      'http_requests_total{method="GET",route="unmatched",status="404"} 2',
    );
    expect(response.text).not.toContain('no-such-path');
  });
});

// ---------------------------------------------------------------------------
// Tests where the database breaks while the service is running
// ---------------------------------------------------------------------------

// A running service whose database file can be sabotaged by the test.
interface SabotageableServer {
  baseUrl: string;
  breakDatabase(): void;
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
    }, 15_000);

    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('listening on port')) {
        clearTimeout(timer);
        resolveReady();
      }
    });
    child.once('exit', () => {
      clearTimeout(timer);
      rejectReady(new Error(`Server exited before it was ready. Output:\n${output}`));
    });
  });
}

// Asks the service process to stop and waits for it to exit.
async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  return new Promise((resolveStopped) => {
    child.once('exit', () => {
      resolveStopped();
    });
    child.kill('SIGTERM');
  });
}

// Starts the real service with its database in a file, and gives the test a way to break that database.
// Breaking it deletes the events table from a second connection, so the service's next database call fails.
async function startServerWithBreakableDatabase(databasePath: string): Promise<SabotageableServer> {
  const port = await findFreePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, NODE_ENV: 'e2e', PORT: String(port), DATABASE_PATH: databasePath },
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
    breakDatabase: () => {
      const saboteur = new Database(databasePath);
      try {
        saboteur.exec('DROP TABLE events');
      } finally {
        saboteur.close();
      }
    },
    stop: () => stopProcess(child),
  };
}

describe('when the database breaks while the service is running', () => {
  let temporaryFolder: string;
  let server: SabotageableServer;

  beforeEach(async () => {
    temporaryFolder = mkdtempSync(join(tmpdir(), 'tax-service-e2e-'));
    server = await startServerWithBreakableDatabase(join(temporaryFolder, 'broken.db'));
  });

  afterEach(async () => {
    await server.stop();
    rmSync(temporaryFolder, { recursive: true, force: true });
  });

  it('answers an unexpected internal error with 500 and only a generic message, with no internal details', async () => {
    server.breakDatabase();
    const payment = buildPayment('2024-01-05T00:00:00Z', 500);

    const response = await fetch(`${server.baseUrl}/transactions`, {
      method: 'POST',
      body: JSON.stringify(payment),
    });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ errors: ['Internal server error'] });

    // Nothing about the real cause may leak: not the database error, the table name, the file or the stack.
    expect(text).not.toMatch(/sqlite|no such table|events|broken\.db|stack|\bat\s/i);
  });

  it('answers GET /health with 503 and only { "status": "error" } when the database cannot be read', async () => {
    server.breakDatabase();

    const response = await fetch(`${server.baseUrl}/health`);
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({ status: 'error' });
    expect(text).not.toMatch(/sqlite|no such table|events|broken\.db/i);
  });
});
