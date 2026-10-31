// Small helpers that build events for the unit tests, so each test only spells out what matters to it.
// This file contains no tests itself.

import type { SaleAmendmentEvent } from '../../src/schemas/event.js';
import type { SaleItem, SalesEvent, TaxPaymentEvent } from '../../src/schemas/transaction.js';

// Builds one sale item with the given id, cost in pennies and tax rate.
export function buildItem(itemId: string, cost: number, taxRate: number): SaleItem {
  return { itemId, cost, taxRate };
}

// Builds a SALES event for an invoice with the given items.
export function buildSale(invoiceId: string, date: string, items: SaleItem[]): SalesEvent {
  return { eventType: 'SALES', date, invoiceId, items };
}

// Builds a TAX_PAYMENT event for the given amount in pennies.
export function buildPayment(date: string, amount: number): TaxPaymentEvent {
  return { eventType: 'TAX_PAYMENT', date, amount };
}

// Builds a SALE_AMENDMENT event that changes the cost and tax rate of one item.
export function buildAmendment(
  invoiceId: string,
  itemId: string,
  date: string,
  cost: number,
  taxRate: number,
): SaleAmendmentEvent {
  return { eventType: 'SALE_AMENDMENT', date, invoiceId, itemId, cost, taxRate };
}
