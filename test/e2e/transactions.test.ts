// End-to-end tests for POST /transactions, using real HTTP requests against a fresh in-memory service.

import { describe, expect, it } from 'vitest';
import { buildItem, buildPayment, buildSale } from '../unit/event-builders.js';
import { taxPositionPath, useFreshServer } from './test-server.js';

const server = useFreshServer();

describe('POST /transactions', () => {
  it('accepts a valid SALES event with 202 and no body', async () => {
    const sale = buildSale('inv-1', '2024-01-01T00:00:00Z', [buildItem('item-a', 1000, 0.2)]);

    const response = await server.send('POST', '/transactions', sale);

    expect(response.status).toBe(202);
    expect(response.text).toBe('');
  });

  it('accepts a valid TAX_PAYMENT event with 202 and no body', async () => {
    const payment = buildPayment('2024-01-05T00:00:00Z', 500);

    const response = await server.send('POST', '/transactions', payment);

    expect(response.status).toBe(202);
    expect(response.text).toBe('');
  });

  it('rejects a second sale with the same invoiceId using 400 and "Invoice already exists"', async () => {
    const sale = buildSale('inv-1', '2024-01-01T00:00:00Z', [buildItem('item-a', 1000, 0.2)]);
    await server.send('POST', '/transactions', sale);

    const response = await server.send('POST', '/transactions', sale);

    expect(response.status).toBe(400);
    expect(response.json).toEqual({ errors: ['Invoice already exists'] });
  });

  it('does not count the rejected duplicate sale in the tax position', async () => {
    const sale = buildSale('inv-1', '2024-01-01T00:00:00Z', [buildItem('item-a', 1000, 0.2)]);
    await server.send('POST', '/transactions', sale);
    await server.send('POST', '/transactions', sale);

    const response = await server.send('GET', taxPositionPath('2024-02-01T00:00:00Z'));

    expect(response.json).toEqual({ date: '2024-02-01T00:00:00Z', taxPosition: 200 });
  });

  it('rejects a sale that repeats an itemId with 400 and names the repeated itemId', async () => {
    const sale = buildSale('inv-1', '2024-01-01T00:00:00Z', [
      buildItem('item-a', 1000, 0.2),
      buildItem('item-b', 500, 0.2),
      buildItem('item-a', 700, 0.2),
    ]);

    const response = await server.send('POST', '/transactions', sale);

    expect(response.status).toBe(400);
    expect(response.json).toEqual({
      errors: [
        'items.2.itemId: Duplicate itemId "item-a" at position 2 (first used at position 0)',
      ],
    });
  });

  it('rejects an invalid body with 400 and lists what is wrong', async () => {
    const invalidSale = {
      eventType: 'SALES',
      date: 'not-a-date',
      invoiceId: 'inv-1',
      items: [{ itemId: 'item-a', cost: -5, taxRate: 0.2 }],
    };

    const response = await server.send('POST', '/transactions', invalidSale);

    expect(response.status).toBe(400);
    expect(response.json).toEqual({
      errors: [expect.stringContaining('date'), expect.stringContaining('items.0.cost')],
    });
  });

  it('rejects an unknown eventType with 400', async () => {
    const response = await server.send('POST', '/transactions', {
      eventType: 'REFUND',
      date: '2024-01-01T00:00:00Z',
    });

    expect(response.status).toBe(400);
  });

  it('rejects a body that is not valid JSON with 400', async () => {
    const response = await server.sendRawBody('POST', '/transactions', '{ this is not json');

    expect(response.status).toBe(400);
    expect(response.json).toEqual({ errors: ['Request body must be valid JSON'] });
  });

  it('rejects a body with an unknown field with 400', async () => {
    const paymentWithExtraField = {
      ...buildPayment('2024-01-05T00:00:00Z', 500),
      note: 'surprise',
    };

    const response = await server.send('POST', '/transactions', paymentWithExtraField);

    expect(response.status).toBe(400);
    expect(response.text).toContain('note');
  });

  it('accepts a sale dated in the future', async () => {
    const futureSale = buildSale('inv-future', '2099-01-01T00:00:00Z', [
      buildItem('item-a', 1000, 0.2),
    ]);

    const response = await server.send('POST', '/transactions', futureSale);

    expect(response.status).toBe(202);
  });
});
