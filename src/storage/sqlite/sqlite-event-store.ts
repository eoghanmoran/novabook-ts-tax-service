// SQLite implementation of the event store interface, using better-sqlite3.
// Events are only ever appended, never updated or deleted.

import type Database from 'better-sqlite3';
import { domainEventSchema, type DomainEvent } from '../../schemas/event.js';
import type { EventStore } from '../event-store.interface.js';
import { runMigrations } from './migrations.js';

// One row read back from the events table: just the JSON text of the event.
interface PayloadRow {
  payload: string;
}

// Turns an ISO 8601 date string into UTC epoch milliseconds.
// Throws a RangeError if the text is not a date that can be understood.
function toEpochMilliseconds(isoDate: string): number {
  const milliseconds = Date.parse(isoDate);

  if (Number.isNaN(milliseconds)) {
    throw new RangeError(`Cannot parse date: "${isoDate}"`);
  }

  return milliseconds;
}

export class SqliteEventStore implements EventStore {
  private readonly insertStatement: Database.Statement;
  private readonly selectUpToStatement: Database.Statement;

  // Sets up the events table if needed and prepares the two SQL statements used by this store.
  constructor(database: Database.Database) {
    runMigrations(database);

    this.insertStatement = database.prepare(
      'INSERT INTO events (timestamp_ms, payload) VALUES (?, ?)',
    );
    this.selectUpToStatement = database.prepare(
      'SELECT payload FROM events WHERE timestamp_ms <= ? ORDER BY timestamp_ms ASC, id ASC',
    );
  }

  // Saves one event, storing its date as epoch milliseconds and the whole event as JSON.
  // better-sqlite3 is synchronous, so there is nothing to await. The method is async only to match the interface.
  // eslint-disable-next-line @typescript-eslint/require-await
  async append(event: DomainEvent): Promise<void> {
    const timestampMs = toEpochMilliseconds(event.date);
    const payload = JSON.stringify(event);

    this.insertStatement.run(timestampMs, payload);
  }

  // Returns all events dated on or before the given date, oldest first, with ties in the order they were saved.
  // Each stored JSON payload is checked against the event schema on the way out.
  // eslint-disable-next-line @typescript-eslint/require-await
  async findUpTo(date: string): Promise<readonly DomainEvent[]> {
    const timestampMs = toEpochMilliseconds(date);
    const rows = this.selectUpToStatement.all(timestampMs) as PayloadRow[];

    return rows.map((row) => domainEventSchema.parse(JSON.parse(row.payload)));
  }
}
