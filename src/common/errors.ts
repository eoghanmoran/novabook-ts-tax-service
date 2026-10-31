// Custom error types shared across layers, each carrying the HTTP status code it should be reported with.
// Services throw these, and the routes turn them into responses.

// The error thrown when a sale uses an invoiceId that already exists.
export class DuplicateInvoiceError extends Error {
  readonly statusCode = 400;

  // Creates the error with the standard message.
  constructor() {
    super('Invoice already exists');
    this.name = 'DuplicateInvoiceError';
  }
}

// The error thrown when a request body cannot be read as JSON.
export class InvalidJsonError extends Error {
  readonly statusCode = 400;

  // Creates the error with the standard message.
  constructor() {
    super('Request body must be valid JSON');
    this.name = 'InvalidJsonError';
  }
}
