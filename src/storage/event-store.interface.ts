// The storage interface: describes what the rest of the app can ask of the event store.
// Services depend on this interface, never on a specific database.
// The store is append-only: events are added and read back, but never changed or deleted.

import type { DomainEvent } from '../schemas/event.js';

export interface EventStore {
  // Saves one event at the end of the store.
  append(event: DomainEvent): Promise<void>;

  // Returns every event dated on or before the given date (an ISO 8601 string).
  // Events come back ordered by date, oldest first. Events with the same date keep the order they were saved in.
  findUpTo(date: string): Promise<readonly DomainEvent[]>;
}

// The token used to look up the event store when wiring the app together.
export const EVENT_STORE = Symbol('EventStore');
