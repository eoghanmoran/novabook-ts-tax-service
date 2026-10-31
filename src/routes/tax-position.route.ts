// HTTP handler for GET /tax-position.
// Reads the date from the query string, validates it, and asks the service for the tax position.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { taxPositionQuerySchema } from '../schemas/tax-position.js';
import { queryTaxPosition } from '../services/tax-position.service.js';
import type { EventStore } from '../storage/event-store.interface.js';
import { sendErrorResponse, sendJson, sendValidationErrors } from './route-helpers.js';

// Collects the query string parameters of the request into a plain object.
function readQueryParameters(request: IncomingMessage): Record<string, string> {
  const url = new URL(request.url ?? '/', 'http://localhost');

  return Object.fromEntries(url.searchParams);
}

// Handles GET /tax-position?date=... Replies 200 with { date, taxPosition }, 400 for bad input, 500 otherwise.
export async function handleGetTaxPosition(
  request: IncomingMessage,
  response: ServerResponse,
  store: EventStore,
): Promise<void> {
  try {
    const query = readQueryParameters(request);
    const result = taxPositionQuerySchema.safeParse(query);

    if (!result.success) {
      sendValidationErrors(response, result.error);
      return;
    }

    const taxPosition = await queryTaxPosition(store, result.data.date);
    sendJson(response, 200, taxPosition);
  } catch (error) {
    sendErrorResponse(response, error);
  }
}
