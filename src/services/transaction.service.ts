// Coordinates ingesting SALES and TAX_PAYMENT events.
// Rejects a sale whose invoiceId has been used before, otherwise saves the event to the store.

import type { Transaction } from '../schemas/transaction.js';
import type { EventStore } from '../storage/event-store.interface.js';

// A date far enough in the future that findUpTo returns every event in the store.
const FAR_FUTURE_DATE = '9999-12-31T23:59:59Z';

// The error thrown when a sale uses an invoiceId that already exists. The HTTP layer turns it into a 400 response.
export class DuplicateInvoiceError extends Error {
  readonly statusCode = 400;

  // Creates the error with the standard message.
  constructor() {
    super('Invoice already exists');
    this.name = 'DuplicateInvoiceError';
  }
}

// Returns true if a SALES event with this invoiceId is already in the store.
async function invoiceExists(store: EventStore, invoiceId: string): Promise<boolean> {
  const allEvents = await store.findUpTo(FAR_FUTURE_DATE);

  return allEvents.some((event) => event.eventType === 'SALES' && event.invoiceId === invoiceId);
}

// Saves a transaction to the store. A SALES event with an invoiceId that already exists is rejected.
export async function ingestTransaction(store: EventStore, event: Transaction): Promise<void> {
  if (event.eventType === 'SALES') {
    const alreadyExists = await invoiceExists(store, event.invoiceId);
    if (alreadyExists) {
      throw new DuplicateInvoiceError();
    }
  }

  await store.append(event);
}
