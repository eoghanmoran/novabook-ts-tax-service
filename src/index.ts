// Application entry point.
// Loads the settings, opens the SQLite database, creates the event store,
// and starts the HTTP server that sends each request to the right route handler.
// Every request gets its own ID for the logs, and its outcome is logged and counted in the metrics.

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { handleGetHealth } from './observability/health.js';
import { describeError, logger, runWithRequestId } from './observability/logger.js';
import { handleGetMetrics, recordRequest } from './observability/metrics.js';
import { handleGetTaxPosition } from './routes/tax-position.route.js';
import { handlePatchSale } from './routes/sale.route.js';
import { handlePostTransactions } from './routes/transactions.route.js';
import { sendErrorResponse, sendJson } from './routes/route-helpers.js';
import type { EventStore } from './storage/event-store.interface.js';
import { SqliteEventStore } from './storage/sqlite/sqlite-event-store.js';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

// The settings the service needs, checked when it starts. Missing values fall back to the defaults.
const configSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().trim().min(1).default('./data/tax-service.db'),
});

type Config = z.infer<typeof configSchema>;

// Loads a .env file from the current folder into the environment, if there is one.
// Variables that are already set in the environment are not overwritten.
function loadEnvFileIfPresent(): void {
  try {
    process.loadEnvFile();
  } catch (error) {
    const isMissingFile = error instanceof Error && 'code' in error && error.code === 'ENOENT';
    if (!isMissingFile) {
      throw error;
    }
  }
}

// Reads and checks PORT and DATABASE_PATH. If either is invalid, logs every problem and returns undefined.
function readConfig(): Config | undefined {
  const result = configSchema.safeParse(process.env);

  if (result.success) {
    return result.data;
  }

  for (const issue of result.error.issues) {
    logger.error('Invalid configuration', {
      setting: issue.path.map(String).join('.'),
      problem: issue.message,
    });
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

// Opens the SQLite database, creating its folder first if needed, and returns the event store.
function openEventStore(databasePath: string): { store: EventStore; database: Database.Database } {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const database = new Database(databasePath);
  const store = new SqliteEventStore(database);

  return { store, database };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

// A function that handles one kind of request.
type RouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  store: EventStore,
) => Promise<void>;

// One URL the service answers, with the one HTTP method it accepts and the handler for it.
interface Route {
  path: string;
  method: string;
  handler: RouteHandler;
}

const routes: Route[] = [
  { path: '/transactions', method: 'POST', handler: handlePostTransactions },
  { path: '/tax-position', method: 'GET', handler: handleGetTaxPosition },
  { path: '/sale', method: 'PATCH', handler: handlePatchSale },
  { path: '/health', method: 'GET', handler: handleGetHealth },
  { path: '/metrics', method: 'GET', handler: handleGetMetrics },
];

// Pulls the path out of the request URL (without the query string). Returns undefined if the URL is unreadable.
function readPath(request: IncomingMessage): string | undefined {
  try {
    return new URL(request.url ?? '/', 'http://localhost').pathname;
  } catch {
    return undefined;
  }
}

// Finds the route for a path, or undefined if the service has no such path.
function findRoute(path: string | undefined): Route | undefined {
  return routes.find((candidate) => candidate.path === path);
}

// Sends a 405 reply that also tells the caller which method is allowed for this path.
function sendMethodNotAllowed(response: ServerResponse, allowedMethod: string): void {
  response.writeHead(405, { 'Content-Type': 'application/json', Allow: allowedMethod });
  response.end(JSON.stringify({ errors: ['Method not allowed'] }));
}

// Sends the request to the route's handler, or replies 404 (unknown path) or 405 (wrong method).
function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: EventStore,
  route: Route | undefined,
): void {
  if (route === undefined) {
    sendJson(response, 404, { errors: ['Not found'] });
    return;
  }

  if (route.method !== request.method) {
    sendMethodNotAllowed(response, route.method);
    return;
  }

  // Handlers deal with their own errors. This is a last safety net so a surprise never crashes the server.
  route.handler(request, response, store).catch((error: unknown) => {
    // Once the reply has started it is too late to send an error, so this is the only place it gets logged.
    if (response.headersSent) {
      logger.error('Unhandled error after the response had started', {
        reason: describeError(error),
      });
      response.end();
      return;
    }
    // sendErrorResponse logs the cause itself.
    sendErrorResponse(response, error);
  });
}

// ---------------------------------------------------------------------------
// Request logging and metrics
// ---------------------------------------------------------------------------

// Paths that are checked often by monitoring tools. They are counted in the metrics but not logged, to avoid noise.
const UNLOGGED_PATHS = ['/health', '/metrics'];

// The label used in the metrics for requests that did not match any route, so random URLs cannot flood the metrics.
const UNMATCHED_ROUTE_LABEL = 'unmatched';

// Chooses how serious a finished request is, from its status code: 5xx is an error, 4xx a warning, the rest info.
function logLevelForStatus(statusCode: number): 'info' | 'warn' | 'error' {
  if (statusCode >= 500) {
    return 'error';
  }
  if (statusCode >= 400) {
    return 'warn';
  }
  return 'info';
}

// Works out how many milliseconds have passed since the request started.
function millisecondsSince(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

// Writes the log line for a finished request, unless it is one of the paths we leave out of the logs.
function logFinishedRequest(
  method: string,
  path: string | undefined,
  statusCode: number,
  durationMs: number,
): void {
  if (path !== undefined && UNLOGGED_PATHS.includes(path)) {
    return;
  }

  const level = logLevelForStatus(statusCode);
  logger[level]('Request completed', {
    method,
    path: path ?? '(unreadable)',
    statusCode,
    durationMs: Math.round(durationMs),
  });
}

// Arranges for the request to be logged and counted in the metrics once its response has been sent.
function trackWhenFinished(
  request: IncomingMessage,
  response: ServerResponse,
  requestId: string,
  path: string | undefined,
  route: Route | undefined,
): void {
  const startedAt = process.hrtime.bigint();
  const method = request.method ?? 'UNKNOWN';

  response.on('finish', () => {
    const durationMs = millisecondsSince(startedAt);
    const routeLabel = route?.path ?? UNMATCHED_ROUTE_LABEL;

    recordRequest({ method, route: routeLabel, statusCode: response.statusCode, durationMs });

    // Event listeners may not run inside the original request context, so the ID is attached again here.
    runWithRequestId(requestId, () => {
      logFinishedRequest(method, path, response.statusCode, durationMs);
    });
  });
}

// Handles one incoming request: gives it an ID, sets up its logging and metrics, then routes it.
function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: EventStore,
): void {
  const requestId = randomUUID();

  runWithRequestId(requestId, () => {
    const path = readPath(request);
    const route = findRoute(path);

    trackWhenFinished(request, response, requestId, path, route);
    routeRequest(request, response, store, route);
  });
}

// ---------------------------------------------------------------------------
// Start up and shut down
// ---------------------------------------------------------------------------

// Stops accepting requests and closes the database cleanly when the process is asked to stop.
function shutDownOnSignals(server: Server, database: Database.Database): void {
  const shutDown = (signal: string): void => {
    logger.info(`Received ${signal}, shutting down`);
    server.close(() => {
      database.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => {
    shutDown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutDown('SIGTERM');
  });
}

// Explains in plain English why the server could not start listening, for the log.
function describeListenProblem(error: NodeJS.ErrnoException, port: number): string {
  if (error.code === 'EADDRINUSE') {
    return `Port ${String(port)} is already in use. Stop the other program using it, or set a different PORT.`;
  }
  if (error.code === 'EACCES') {
    return `Not allowed to use port ${String(port)}. Try a port above 1023, or set a different PORT.`;
  }
  return `The server could not start listening on port ${String(port)}: ${error.message}`;
}

// Handles errors from the HTTP server. If it never managed to start listening (for example the port is taken),
// logs a clear message, closes the database and lets the process end with exit code 1 instead of a raw crash.
function exitCleanlyIfListenFails(server: Server, port: number, database: Database.Database): void {
  server.on('error', (error: NodeJS.ErrnoException) => {
    logger.error(describeListenProblem(error, port), { code: error.code, port });

    if (!server.listening) {
      database.close();
      process.exitCode = 1;
    }
  });
}

// Puts everything together: settings, database, event store and the listening HTTP server.
// If the settings are invalid it logs the problems and stops without starting anything.
function main(): void {
  loadEnvFileIfPresent();
  const config = readConfig();

  if (config === undefined) {
    process.exitCode = 1;
    return;
  }

  const { store, database } = openEventStore(config.DATABASE_PATH);

  const server = createServer((request, response) => {
    handleRequest(request, response, store);
  });

  exitCleanlyIfListenFails(server, config.PORT, database);

  server.listen(config.PORT, () => {
    logger.info(`Tax service listening on port ${String(config.PORT)}`, {
      port: config.PORT,
      databasePath: config.DATABASE_PATH,
    });
  });

  shutDownOnSignals(server, database);
}

main();
