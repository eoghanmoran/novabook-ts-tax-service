// Zod schemas for the POST /transactions body, which is either a SALES event or a TAX_PAYMENT event.
// The TypeScript types are derived from the schemas, so the two can never drift apart.

import { z } from 'zod';
import { idSchema, isoDateSchema, penniesSchema, taxRateSchema } from './common.js';

// One item sold within a sale: its id, its cost in pennies and the tax rate that applies to it.
export const saleItemSchema = z.strictObject({
  itemId: idSchema,
  cost: penniesSchema,
  taxRate: taxRateSchema,
});

// Checks that no two items in a sale share an itemId.
// Each repeat is reported with the repeated itemId and its position in the items list.
function rejectDuplicateItemIds(items: SaleItem[], context: z.RefinementCtx): void {
  const firstPositionById = new Map<string, number>();

  items.forEach((item, position) => {
    const firstPosition = firstPositionById.get(item.itemId);

    if (firstPosition === undefined) {
      firstPositionById.set(item.itemId, position);
      return;
    }

    context.addIssue({
      code: 'custom',
      message: `Duplicate itemId "${item.itemId}" at position ${String(position)} (first used at position ${String(firstPosition)})`,
      path: [position, 'itemId'],
    });
  });
}

// A SALES event: a sale invoice with one or more items, each with a unique itemId.
export const salesEventSchema = z.strictObject({
  eventType: z.literal('SALES'),
  date: isoDateSchema,
  invoiceId: idSchema,
  items: z.array(saleItemSchema).superRefine(rejectDuplicateItemIds),
});

// A TAX_PAYMENT event: an amount of tax paid, in pennies, on a given date.
export const taxPaymentEventSchema = z.strictObject({
  eventType: z.literal('TAX_PAYMENT'),
  date: isoDateSchema,
  amount: penniesSchema,
});

// The body accepted by POST /transactions: either event type, told apart by "eventType".
export const transactionSchema = z.discriminatedUnion('eventType', [
  salesEventSchema,
  taxPaymentEventSchema,
]);

export type SaleItem = z.infer<typeof saleItemSchema>;
export type SalesEvent = z.infer<typeof salesEventSchema>;
export type TaxPaymentEvent = z.infer<typeof taxPaymentEventSchema>;
export type Transaction = z.infer<typeof transactionSchema>;
