// A structured JSON logger. Each log line is one JSON object written to stdout, for example:
// {"level":"info","time":1718000000000,"requestId":"...","message":"Request completed","statusCode":202}
// The request ID is carried through each request with AsyncLocalStorage, so code deep inside a request
// can log without the ID being passed around. The logger stays silent when NODE_ENV is "test".

import { AsyncLocalStorage } from 'node:async_hooks';

type LogLevel = 'info' | 'warn' | 'error';

// Extra fields that can be added to a log line, such as { statusCode: 202 }.
type LogFields = Record<string, unknown>;

// Names the logger sets itself. Extra fields with these names are ignored so they cannot overwrite them.
const RESERVED_FIELD_NAMES = ['level', 'time', 'requestId', 'message'];

const requestIdStorage = new AsyncLocalStorage<string>();

// Runs the given function with a request ID attached. Any logging done inside it includes that ID.
export function runWithRequestId<T>(requestId: string, work: () => T): T {
  return requestIdStorage.run(requestId, work);
}

// Returns true when logging should be switched off (during automated tests).
function isLoggingDisabled(): boolean {
  return process.env.NODE_ENV === 'test';
}

// Copies the extra fields, leaving out any whose names the logger uses for itself.
function withoutReservedFields(fields: LogFields): LogFields {
  const allowedFields: LogFields = {};

  for (const [name, value] of Object.entries(fields)) {
    if (!RESERVED_FIELD_NAMES.includes(name)) {
      allowedFields[name] = value;
    }
  }

  return allowedFields;
}

// Builds the object for one log line: level, time, request ID (if there is one), message, then the extra fields.
function buildLogLine(level: LogLevel, message: string, fields: LogFields): LogFields {
  const requestId = requestIdStorage.getStore();
  const line: LogFields = { level, time: Date.now() };

  if (requestId !== undefined) {
    line.requestId = requestId;
  }

  line.message = message;

  return { ...line, ...withoutReservedFields(fields) };
}

// Writes one log line to stdout, unless logging is switched off.
function writeLog(level: LogLevel, message: string, fields: LogFields): void {
  if (isLoggingDisabled()) {
    return;
  }

  const line = buildLogLine(level, message, fields);
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

// Turns anything that was thrown into a short piece of text that is safe to put in a log line.
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export const logger = {
  // Logs something that happened normally, such as a request completing or the server starting.
  info(message: string, fields: LogFields = {}): void {
    writeLog('info', message, fields);
  },

  // Logs something unexpected that did not stop the work, such as a request the caller got wrong.
  warn(message: string, fields: LogFields = {}): void {
    writeLog('warn', message, fields);
  },

  // Logs something that failed, such as a database error or a server-side failure.
  error(message: string, fields: LogFields = {}): void {
    writeLog('error', message, fields);
  },
};
