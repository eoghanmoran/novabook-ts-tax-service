// Pure function that works out the tax position: the tax owed from sales minus the tax already paid.
// Must not import storage, routes or services.

import type { DomainEvent } from '../schemas/event.js';
import type { SalesEvent } from '../schemas/transaction.js';
import { getEffectiveItemValues } from './amendments.js';
import { calculateItemTax } from './tax.js';

// Adds up the tax on every item in one sale, using each item's effective cost and tax rate.
function calculateSaleTax(sale: SalesEvent, events: DomainEvent[], queryDate: string): number {
  let saleTax = 0;

  for (const item of sale.items) {
    const values = getEffectiveItemValues(events, sale.invoiceId, item.itemId, queryDate);
    if (values === undefined) {
      continue;
    }
    saleTax += calculateItemTax(values.cost, values.taxRate);
  }

  return saleTax;
}

// Returns the tax position in whole pennies: total tax from sales minus total tax payments.
// The events passed in must already be filtered to dates on or before the query date.
export function calculateTaxPosition(events: DomainEvent[], queryDate: string): number {
  let taxFromSales = 0;
  let taxPaid = 0;

  for (const event of events) {
    if (event.eventType === 'SALES') {
      taxFromSales += calculateSaleTax(event, events, queryDate);
    }
    if (event.eventType === 'TAX_PAYMENT') {
      taxPaid += event.amount;
    }
  }

  return taxFromSales - taxPaid;
}
