// End-to-end tests for PATCH /sale, using real HTTP requests against a fresh in-memory service.

import { describe, expect, it } from 'vitest';
import { buildItem, buildSale } from '../unit/event-builders.js';
import { useFreshServer } from './test-server.js';

const server = useFreshServer();

const validAmendment = {
  date: '2024-01-10T00:00:00Z',
  invoiceId: 'inv-1',
  itemId: 'item-a',
  cost: 500,
  taxRate: 0.1,
};

describe('PATCH /sale', () => {
  it('accepts a valid amendment to an existing sale with 202 and no body', async () => {
    const sale = buildSale('inv-1', '2024-01-01T00:00:00Z', [buildItem('item-a', 1000, 0.2)]);
    await server.send('POST', '/transactions', sale);

    const response = await server.send('PATCH', '/sale', validAmendment);

    expect(response.status).toBe(202);
    expect(response.text).toBe('');
  });

  it('accepts an amendment even though its sale has not arrived yet', async () => {
    const response = await server.send('PATCH', '/sale', validAmendment);

    expect(response.status).toBe(202);
    expect(response.text).toBe('');
  });

  it('rejects an invalid body with 400 and lists what is wrong', async () => {
    const response = await server.send('PATCH', '/sale', {
      invoiceId: 'inv-1',
      cost: 1.5,
      taxRate: 3,
    });

    expect(response.status).toBe(400);
    expect(response.text).toContain('date');
    expect(response.text).toContain('itemId');
    expect(response.text).toContain('cost');
    expect(response.text).toContain('taxRate');
  });

  it('rejects an amendment with an unknown field with 400', async () => {
    const response = await server.send('PATCH', '/sale', { ...validAmendment, reason: 'typo' });

    expect(response.status).toBe(400);
    expect(response.text).toContain('reason');
  });

  it('rejects a body that is not valid JSON with 400', async () => {
    const response = await server.sendRawBody('PATCH', '/sale', '{ nope');

    expect(response.status).toBe(400);
  });
});
