// Coordinates amending a sale.
// Amendments are always accepted, even if the sale they refer to has not arrived yet.

import type { SaleAmendmentEvent } from '../schemas/event.js';
import type { SaleAmendment } from '../schemas/sale-amendment.js';
import type { EventStore } from '../storage/event-store.interface.js';

// Turns an amendment request into a SALE_AMENDMENT event and saves it to the store.
export async function amendSale(store: EventStore, amendment: SaleAmendment): Promise<void> {
  const amendmentEvent: SaleAmendmentEvent = { ...amendment, eventType: 'SALE_AMENDMENT' };

  await store.append(amendmentEvent);
}
