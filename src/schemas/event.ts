// Zod schema for the DomainEvent union: every kind of event the domain layer works with.
// This is what gets stored in the event store and read back to calculate the tax position.
// The type is derived from the schema, so the two can never drift apart.

import { z } from 'zod';
import { saleAmendmentSchema } from './sale-amendment.js';
import { salesEventSchema, taxPaymentEventSchema } from './transaction.js';

// A SALE_AMENDMENT event: the amendment fields plus an eventType so it can be stored with the others.
export const saleAmendmentEventSchema = saleAmendmentSchema.extend({
  eventType: z.literal('SALE_AMENDMENT'),
});

// Any event in the event store: a sale, a tax payment or a sale amendment, told apart by "eventType".
export const domainEventSchema = z.discriminatedUnion('eventType', [
  salesEventSchema,
  taxPaymentEventSchema,
  saleAmendmentEventSchema,
]);

export type SaleAmendmentEvent = z.infer<typeof saleAmendmentEventSchema>;
export type DomainEvent = z.infer<typeof domainEventSchema>;
