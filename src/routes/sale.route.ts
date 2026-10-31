// HTTP handler for PATCH /sale.
// Reads the JSON body, validates it as a sale amendment, and passes it to the service.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { saleAmendmentSchema } from '../schemas/sale-amendment.js';
import { amendSale } from '../services/sale.service.js';
import type { EventStore } from '../storage/event-store.interface.js';
import {
  readJsonBody,
  sendEmpty,
  sendErrorResponse,
  sendValidationErrors,
} from './route-helpers.js';

// Handles PATCH /sale. Replies 202 with no body on success, 400 for bad input, 500 otherwise.
export async function handlePatchSale(
  request: IncomingMessage,
  response: ServerResponse,
  store: EventStore,
): Promise<void> {
  try {
    const body = await readJsonBody(request);
    const result = saleAmendmentSchema.safeParse(body);

    if (!result.success) {
      sendValidationErrors(response, result.error);
      return;
    }

    await amendSale(store, result.data);
    sendEmpty(response, 202);
  } catch (error) {
    sendErrorResponse(response, error);
  }
}
