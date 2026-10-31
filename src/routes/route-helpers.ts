// Small helpers shared by the route handlers: reading a JSON body, sending responses,
// and turning errors into consistent HTTP replies.
// Every error reply has the same shape: { "errors": ["message", ...] }.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { z } from 'zod';
import { DuplicateInvoiceError, InvalidJsonError } from '../common/errors.js';
import { describeError, logger } from '../observability/logger.js';

// The only message ever sent to the caller for an unexpected failure, so internal details never leak.
const GENERIC_ERROR_MESSAGE = 'Internal server error';

// Reads the whole request body as text.
async function readBodyText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }

  return Buffer.concat(chunks).toString('utf8');
}

// Reads the request body and parses it as JSON. Throws InvalidJsonError if it is not valid JSON.
export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const text = await readBodyText(request);

  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidJsonError();
  }
}

// Sends a JSON body with the given status code.
export function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

// Sends a status code with no body.
export function sendEmpty(response: ServerResponse, statusCode: number): void {
  response.writeHead(statusCode);
  response.end();
}

// Turns Zod's validation problems into plain messages such as "items.0.cost: Too small...".
function formatValidationMessages(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    if (issue.path.length === 0) {
      return issue.message;
    }
    return `${issue.path.map(String).join('.')}: ${issue.message}`;
  });
}

// Sends a 400 response listing every validation problem found.
export function sendValidationErrors(response: ServerResponse, error: z.ZodError): void {
  sendJson(response, 400, { errors: formatValidationMessages(error) });
}

// Writes an unexpected error to the log with its message and, when it has one, its stack trace.
// The log line carries the request ID automatically, so it can be matched to the request that failed.
function logUnexpectedError(error: unknown): void {
  const stack = error instanceof Error ? error.stack : undefined;

  logger.error('Unexpected error while handling request', { reason: describeError(error), stack });
}

// Sends the right error response for anything thrown while handling a request.
// Known client mistakes get a 400 with their message.
// Everything else gets a generic 500, and the real cause is written to the log (never sent to the caller).
export function sendErrorResponse(response: ServerResponse, error: unknown): void {
  if (error instanceof DuplicateInvoiceError || error instanceof InvalidJsonError) {
    sendJson(response, error.statusCode, { errors: [error.message] });
    return;
  }

  logUnexpectedError(error);
  sendJson(response, 500, { errors: [GENERIC_ERROR_MESSAGE] });
}
