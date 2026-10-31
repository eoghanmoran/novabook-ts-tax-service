// End-to-end tests for whole scenarios that combine sales, payments and amendments,
// checking the tax position at different dates, with events arriving in any order.

import { describe, expect, it } from 'vitest';
import { buildItem, buildPayment, buildSale } from '../unit/event-builders.js';
import { taxPositionPath, useFreshServer } from './test-server.js';

const server = useFreshServer();

// Asks the service for the tax position at a date and returns just the number.
async function taxPositionAt(date: string): Promise<unknown> {
  const response = await server.send('GET', taxPositionPath(date));
  const body = response.json as { taxPosition: number };

  return body.taxPosition;
}

// Saves an amendment through PATCH /sale (the event type is added by the service).
async function amend(
  invoiceId: string,
  itemId: string,
  date: string,
  cost: number,
  taxRate: number,
): Promise<void> {
  await server.send('PATCH', '/sale', { date, invoiceId, itemId, cost, taxRate });
}

describe('full lifecycle', () => {
  it('applies an amendment that arrived before its sale once the sale arrives', async () => {
    await amend('inv-1', 'item-a', '2024-01-10T00:00:00Z', 500, 0.1);
    await server.send(
      'POST',
      '/transactions',
      buildSale('inv-1', '2024-01-01T00:00:00Z', [buildItem('item-a', 1000, 0.2)]),
    );

    // Before the amendment date the original tax of 200 applies. From then on the amended tax of 50 applies.
    expect(await taxPositionAt('2024-01-05T00:00:00Z')).toBe(200);
    expect(await taxPositionAt('2024-02-01T00:00:00Z')).toBe(50);
  });

  it('uses the latest amendment by date when an item is amended several times, whatever order they arrive in', async () => {
    await server.send(
      'POST',
      '/transactions',
      buildSale('inv-1', '2024-01-01T00:00:00Z', [buildItem('item-a', 1000, 0.2)]),
    );
    // Sent out of order on purpose: the later-dated amendment arrives first.
    await amend('inv-1', 'item-a', '2024-01-20T00:00:00Z', 300, 0.5);
    await amend('inv-1', 'item-a', '2024-01-10T00:00:00Z', 500, 0.1);

    expect(await taxPositionAt('2024-01-05T00:00:00Z')).toBe(200);
    expect(await taxPositionAt('2024-01-15T00:00:00Z')).toBe(50);
    expect(await taxPositionAt('2024-02-01T00:00:00Z')).toBe(150);
  });

  it('uses the amendment that arrived last when two amendments have the same date', async () => {
    await server.send(
      'POST',
      '/transactions',
      buildSale('inv-1', '2024-01-01T00:00:00Z', [buildItem('item-a', 1000, 0.2)]),
    );
    await amend('inv-1', 'item-a', '2024-01-10T00:00:00Z', 500, 0.1);
    await amend('inv-1', 'item-a', '2024-01-10T00:00:00Z', 400, 0.1);

    expect(await taxPositionAt('2024-02-01T00:00:00Z')).toBe(40);
  });

  it('amends only the item named, leaving other items in the sale alone', async () => {
    await server.send(
      'POST',
      '/transactions',
      buildSale('inv-1', '2024-01-01T00:00:00Z', [
        buildItem('item-a', 1000, 0.2),
        buildItem('item-b', 2000, 0.1),
      ]),
    );
    await amend('inv-1', 'item-a', '2024-01-10T00:00:00Z', 500, 0.1);

    // item-a: 50 (amended), item-b: 200 (original).
    expect(await taxPositionAt('2024-02-01T00:00:00Z')).toBe(250);
  });

  it('gives the right tax position at any query date for past and future dated events', async () => {
    await server.send(
      'POST',
      '/transactions',
      buildSale('inv-past', '2024-01-01T00:00:00Z', [buildItem('item-a', 1000, 0.2)]),
    );
    await server.send('POST', '/transactions', buildPayment('2024-01-15T00:00:00Z', 50));
    await server.send(
      'POST',
      '/transactions',
      buildSale('inv-future', '2099-01-01T00:00:00Z', [buildItem('item-a', 2000, 0.2)]),
    );

    expect(await taxPositionAt('2023-12-31T23:59:59Z')).toBe(0);
    expect(await taxPositionAt('2024-01-01T00:00:00Z')).toBe(200);
    expect(await taxPositionAt('2024-01-10T00:00:00Z')).toBe(200);
    expect(await taxPositionAt('2024-01-15T00:00:00Z')).toBe(150);
    expect(await taxPositionAt('2050-01-01T00:00:00Z')).toBe(150);
    expect(await taxPositionAt('2099-01-01T00:00:00Z')).toBe(550);
  });

  it('gives a negative tax position when more tax has been paid than is owed', async () => {
    await server.send(
      'POST',
      '/transactions',
      buildSale('inv-1', '2024-01-01T00:00:00Z', [buildItem('item-a', 1000, 0.2)]),
    );
    await server.send('POST', '/transactions', buildPayment('2024-01-05T00:00:00Z', 500));

    expect(await taxPositionAt('2024-02-01T00:00:00Z')).toBe(-300);
  });

  it('rounds each item separately before adding them up', async () => {
    await server.send(
      'POST',
      '/transactions',
      buildSale('inv-1', '2024-01-01T00:00:00Z', [
        buildItem('item-a', 5, 0.5),
        buildItem('item-b', 5, 0.5),
      ]),
    );

    // Each item is 2.5, rounded to 3. The total is 6, not 5.
    expect(await taxPositionAt('2024-02-01T00:00:00Z')).toBe(6);
  });
});
