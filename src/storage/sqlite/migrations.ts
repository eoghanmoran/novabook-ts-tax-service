// Database setup for the SQLite event store.
// Creates the events table and its index the first time the app runs, and does nothing after that.

import type Database from 'better-sqlite3';

// Creates the events table and index if they do not exist yet.
// timestamp_ms is the event date as UTC epoch milliseconds, used for sorting and filtering.
// payload is the whole event as JSON text.
export function runMigrations(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp_ms INTEGER NOT NULL,
      payload TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_timestamp_ms_id
      ON events (timestamp_ms, id);
  `);
}
