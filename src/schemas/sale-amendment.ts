// Zod schema for the PATCH /sale body: a change to the cost and tax rate of one item in one sale.
// The type is derived from the schema, so the two can never drift apart.

import { z } from 'zod';
import { idSchema, isoDateSchema, penniesSchema, taxRateSchema } from './common.js';

// An amendment to one item of a sale, effective from the given date.
// It may arrive before the sale it refers to, so it only names the invoice and item.
export const saleAmendmentSchema = z.strictObject({
  date: isoDateSchema,
  invoiceId: idSchema,
  itemId: idSchema,
  cost: penniesSchema,
  taxRate: taxRateSchema,
});

export type SaleAmendment = z.infer<typeof saleAmendmentSchema>;
