// Request metrics for GET /metrics.
// Keeps a small in-memory tally of finished requests (how many, and how long they took)
// and shows it as plain text, one labelled value per line. The tally starts again from zero when the service restarts.

import type { IncomingMessage, ServerResponse } from 'node:http';

// Everything we know about a request once it has finished.
export interface FinishedRequest {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}

// The running total of how long requests to one method and route have taken.
interface DurationTotals {
  count: number;
  totalMs: number;
  maxMs: number;
}

// How many requests finished, keyed by a label such as `method="GET",route="/sale",status="405"`.
const requestCounts = new Map<string, number>();

// How long requests took, keyed by a label such as `method="GET",route="/sale"`.
const durationsByRoute = new Map<string, DurationTotals>();

// Builds the label text for a method and route, such as `method="GET",route="/sale"`.
function routeLabels(method: string, route: string): string {
  return `method="${method}",route="${route}"`;
}

// Adds one finished request to the count for its method, route and status code.
function countRequest(request: FinishedRequest): void {
  const labels = `${routeLabels(request.method, request.route)},status="${String(request.statusCode)}"`;
  const previousCount = requestCounts.get(labels) ?? 0;

  requestCounts.set(labels, previousCount + 1);
}

// Adds one finished request's duration to the totals for its method and route.
function addDuration(request: FinishedRequest): void {
  const labels = routeLabels(request.method, request.route);
  const totals = durationsByRoute.get(labels) ?? { count: 0, totalMs: 0, maxMs: 0 };

  totals.count += 1;
  totals.totalMs += request.durationMs;
  totals.maxMs = Math.max(totals.maxMs, request.durationMs);

  durationsByRoute.set(labels, totals);
}

// Records a request that has finished, so it shows up in the next /metrics reading.
export function recordRequest(request: FinishedRequest): void {
  countRequest(request);
  addDuration(request);
}

// Turns a number of milliseconds into text with three decimal places.
function formatMilliseconds(milliseconds: number): string {
  return milliseconds.toFixed(3);
}

// Builds the lines that show how many requests finished, in a steady (sorted) order.
function renderRequestCountLines(): string[] {
  const labels = [...requestCounts.keys()].sort();

  return labels.map((label) => {
    const count = requestCounts.get(label) ?? 0;
    return `http_requests_total{${label}} ${String(count)}`;
  });
}

// Builds the lines that show how long requests took (count, total and slowest), in a steady (sorted) order.
function renderDurationLines(): string[] {
  const labels = [...durationsByRoute.keys()].sort();
  const lines: string[] = [];

  for (const label of labels) {
    const totals = durationsByRoute.get(label);
    if (totals === undefined) {
      continue;
    }
    lines.push(`http_request_duration_ms_count{${label}} ${String(totals.count)}`);
    lines.push(`http_request_duration_ms_sum{${label}} ${formatMilliseconds(totals.totalMs)}`);
    lines.push(`http_request_duration_ms_max{${label}} ${formatMilliseconds(totals.maxMs)}`);
  }

  return lines;
}

// Builds the full plain text shown by GET /metrics.
export function renderMetrics(): string {
  const lines = [
    '# Requests finished, by method, route and status code',
    ...renderRequestCountLines(),
    '',
    '# Request duration in milliseconds, by method and route',
    ...renderDurationLines(),
  ];

  return `${lines.join('\n')}\n`;
}

// Handles GET /metrics. Replies 200 with the metrics as plain text.
export function handleGetMetrics(
  _request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(renderMetrics());

  return Promise.resolve();
}
