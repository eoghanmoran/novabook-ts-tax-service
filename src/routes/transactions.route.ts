// HTTP handler for POST /transactions.
// Reads the JSON body, validates it as a SALES or TAX_PAYMENT event, and passes it to the service.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { transactionSchema } from '../schemas/transaction.js';
import { ingestTransaction } from '../services/transaction.service.js';
import type { EventStore } from '../storage/event-store.interface.js';
import {
  readJsonBody,
  sendEmpty,
  sendErrorResponse,
  sendValidationErrors,
} from './route-helpers.js';

// Handles POST /transactions. Replies 202 with no body on success, 400 for bad input, 500 otherwise.
export async function handlePostTransactions(
  request: IncomingMessage,
  response: ServerResponse,
  store: EventStore,
): Promise<void> {
  try {
    const body = await readJsonBody(request);
    const result = transactionSchema.safeParse(body);

    if (!result.success) {
      sendValidationErrors(response, result.error);
      return;
    }

    await ingestTransaction(store, result.data);
    sendEmpty(response, 202);
  } catch (error) {
    sendErrorResponse(response, error);
  }
}
