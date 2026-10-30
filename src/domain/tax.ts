// Pure function that calculates the tax on a single item.
// Must not import storage, routes or services.

// Works out the tax on one item in whole pennies: cost x taxRate, rounded once.
export function calculateItemTax(cost: number, taxRate: number): number {
  return Math.round(cost * taxRate);
}
