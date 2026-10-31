// Application entry point.
// Loads the settings, opens the SQLite database, creates the event store,
// and starts the HTTP server that sends each request to the right route handler.

import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
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

// Reads and checks PORT and DATABASE_PATH. If either is invalid, logs every problem and exits.
function readConfigOrExit(): Config {
  const result = configSchema.safeParse(process.env);

  if (result.success) {
    return result.data;
  }

  for (const issue of result.error.issues) {
    console.error(`Invalid configuration: ${issue.path.map(String).join('.')}: ${issue.message}`);
  }
  process.exit(1);
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

// The URLs this service answers, with the one HTTP method each accepts and the handler for it.
const routes: { path: string; method: string; handler: RouteHandler }[] = [
  { path: '/transactions', method: 'POST', handler: handlePostTransactions },
  { path: '/tax-position', method: 'GET', handler: handleGetTaxPosition },
  { path: '/sale', method: 'PATCH', handler: handlePatchSale },
];

// Pulls the path out of the request URL (without the query string). Returns undefined if the URL is unreadable.
function readPath(request: IncomingMessage): string | undefined {
  try {
    return new URL(request.url ?? '/', 'http://localhost').pathname;
  } catch {
    return undefined;
  }
}

// Sends a 405 reply that also tells the caller which method is allowed for this path.
function sendMethodNotAllowed(response: ServerResponse, allowedMethod: string): void {
  response.writeHead(405, { 'Content-Type': 'application/json', Allow: allowedMethod });
  response.end(JSON.stringify({ errors: ['Method not allowed'] }));
}

// Sends the request to the matching handler, or replies 404 (unknown path) or 405 (wrong method).
function routeRequest(request: IncomingMessage, response: ServerResponse, store: EventStore): void {
  const path = readPath(request);
  const route = routes.find((candidate) => candidate.path === path);

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
    if (response.headersSent) {
      response.end();
      return;
    }
    sendErrorResponse(response, error);
  });
}

// ---------------------------------------------------------------------------
// Start up and shut down
// ---------------------------------------------------------------------------

// Stops accepting requests and closes the database cleanly when the process is asked to stop.
function shutDownOnSignals(server: Server, database: Database.Database): void {
  const shutDown = (signal: string): void => {
    console.log(`Received ${signal}, shutting down`);
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

// Puts everything together: settings, database, event store and the listening HTTP server.
function main(): void {
  loadEnvFileIfPresent();
  const config = readConfigOrExit();
  const { store, database } = openEventStore(config.DATABASE_PATH);

  const server = createServer((request, response) => {
    routeRequest(request, response, store);
  });

  server.listen(config.PORT, () => {
    console.log(
      `Tax service listening on port ${String(config.PORT)} (database: ${config.DATABASE_PATH})`,
    );
  });

  shutDownOnSignals(server, database);
}

main();
