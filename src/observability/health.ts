// Health check for GET /health.
// Does a quick read from the event store to prove the database can be reached.
// If it cannot, the real reason is written to the log and never sent back to the caller.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../routes/route-helpers.js';
import type { EventStore } from '../storage/event-store.interface.js';
import { describeError, logger } from './logger.js';

// A date at the very start of time, so the read touches the database but returns almost nothing.
const EARLIEST_DATE = '1970-01-01T00:00:00Z';

// Handles GET /health. Replies 200 { "status": "ok" } if the database can be read, otherwise 503 { "status": "error" }.
export async function handleGetHealth(
  _request: IncomingMessage,
  response: ServerResponse,
  store: EventStore,
): Promise<void> {
  try {
    await store.findUpTo(EARLIEST_DATE);
    sendJson(response, 200, { status: 'ok' });
  } catch (error) {
    logger.error('Health check failed: database could not be read', {
      reason: describeError(error),
    });
    sendJson(response, 503, { status: 'error' });
  }
}
