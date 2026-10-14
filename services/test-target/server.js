/**
 * NetReplay Test Target Service
 *
 * A lightweight, deterministic HTTP test server designed for network fault
 * injection and baseline latency measurements.
 *
 * Built exclusively using Node.js built-in modules (node:http, node:url).
 */

import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Configuration bounds for safety
const DEFAULT_SLOW_DELAY_MS = 100;
const MAX_SLOW_DELAY_MS = 5000;
const MIN_SLOW_DELAY_MS = 0;

/**
 * Sends a structured JSON HTTP response.
 *
 * @param {http.ServerResponse} res
 * @param {number} statusCode
 * @param {object} payload
 * @param {boolean} isHead
 */
function sendJson(res, statusCode, payload, isHead = false) {
  const jsonString = JSON.stringify(payload);
  const buffer = Buffer.from(jsonString, 'utf-8');

  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Connection': 'keep-alive',
  });

  if (isHead) {
    res.end();
  } else {
    res.end(buffer);
  }
}

/**
 * Handles incoming HTTP requests.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
export async function handleRequest(req, res) {
  const isHead = req.method === 'HEAD';

  // Only GET and HEAD requests are permitted on this test target
  if (req.method !== 'GET' && !isHead) {
    sendJson(res, 405, {
      status: 'error',
      error: 'Method Not Allowed',
      message: `HTTP method ${req.method} is not supported. Use GET.`,
    }, isHead);
    return;
  }

  let parsedUrl;
  try {
    // Construct WHATWG URL safely using dummy base
    parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  } catch {
    sendJson(res, 400, {
      status: 'error',
      error: 'Bad Request',
      message: 'Invalid request URL.',
    }, isHead);
    return;
  }

  const { pathname, searchParams } = parsedUrl;

  try {
    // ------------------------------------------------------------------------
    // Route: GET /health
    // Purpose: Container readiness and liveness checks
    // ------------------------------------------------------------------------
    if (pathname === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        service: 'test-target',
        healthy: true,
        uptimeSeconds: Math.floor(process.uptime()),
      }, isHead);
      return;
    }

    // ------------------------------------------------------------------------
    // Route: GET /api/demo and GET /ok
    // Purpose: Deterministic endpoint for baseline & fault-injected comparisons
    // ------------------------------------------------------------------------
    if (pathname === '/api/demo' || pathname === '/ok' || pathname === '/api/ok') {
      const requestId = searchParams.get('requestId') || searchParams.get('id') || null;

      sendJson(res, 200, {
        status: 'ok',
        service: 'test-target',
        message: 'NetReplay deterministic test target response',
        requestId,
        timestamp: new Date().toISOString(),
        _documentation: {
          determinism: 'Payload structure and message are deterministic across runs.',
          nondeterministicFields: ['timestamp'],
          description: 'The timestamp field reflects server time for request inspection.',
        },
      }, isHead);
      return;
    }

    // ------------------------------------------------------------------------
    // Route: GET /status/:code or GET /status?code=...
    // Purpose: Returns a controlled HTTP status code for testing error handling
    // ------------------------------------------------------------------------
    if (
      pathname.startsWith('/status/') ||
      pathname.startsWith('/api/status/') ||
      pathname === '/status' ||
      pathname === '/api/status'
    ) {
      let codeStr = '';
      if (pathname.startsWith('/status/')) {
        codeStr = pathname.slice('/status/'.length);
      } else if (pathname.startsWith('/api/status/')) {
        codeStr = pathname.slice('/api/status/'.length);
      } else {
        codeStr = searchParams.get('code') || '';
      }

      if (!/^\d{3}$/.test(codeStr)) {
        sendJson(res, 400, {
          status: 'error',
          error: 'Bad Request',
          message: 'Invalid status code parameter. Must be a 3-digit integer between 200 and 599.',
        }, isHead);
        return;
      }

      const targetStatusCode = Number.parseInt(codeStr, 10);
      if (targetStatusCode < 200 || targetStatusCode > 599) {
        sendJson(res, 400, {
          status: 'error',
          error: 'Bad Request',
          message: `Status code ${targetStatusCode} is out of allowable HTTP range (200-599).`,
        }, isHead);
        return;
      }

      sendJson(res, targetStatusCode, {
        status: targetStatusCode < 400 ? 'ok' : 'error',
        statusCode: targetStatusCode,
        service: 'test-target',
        message: `Controlled test response with HTTP status ${targetStatusCode}`,
      }, isHead);
      return;
    }

    // ------------------------------------------------------------------------
    // Route: GET /large or GET /api/large
    // Purpose: Returns bounded deterministic payload for testing bandwidth limits
    // ------------------------------------------------------------------------
    if (pathname === '/large' || pathname === '/api/large') {
      const rawSize = searchParams.get('sizeKb');
      let sizeKb = 64; // Default: 64 KB

      if (rawSize !== null) {
        if (!/^\d+$/.test(rawSize)) {
          sendJson(res, 400, {
            status: 'error',
            error: 'Bad Request',
            message: "Invalid 'sizeKb' parameter. Must be an integer between 1 and 1024.",
          }, isHead);
          return;
        }
        sizeKb = Math.max(1, Math.min(Number.parseInt(rawSize, 10), 1024)); // Cap at 1MB
      }

      const chunkSize = 1024;
      const pattern = 'NetReplay-Deterministic-Throughput-Test-Payload-Chunk-Block-0123456789ABCDEF\n';
      const chunk = pattern.repeat(Math.ceil(chunkSize / pattern.length)).slice(0, chunkSize);
      const data = chunk.repeat(sizeKb);

      sendJson(res, 200, {
        status: 'ok',
        service: 'test-target',
        message: `Bounded payload of ${sizeKb} KB`,
        sizeBytes: Buffer.byteLength(data, 'utf-8'),
        data,
      }, isHead);
      return;
    }

    // ------------------------------------------------------------------------
    // Route: GET /slow or GET /api/slow
    // Purpose: Simulates internal application processing delay (vs network delay)
    // ------------------------------------------------------------------------
    if (pathname === '/api/slow' || pathname === '/slow') {
      const rawDelay = searchParams.get('delay') ?? searchParams.get('ms');
      let delayMs = DEFAULT_SLOW_DELAY_MS;

      if (rawDelay !== null) {
        // Enforce integer-only syntax (disallow floats, negative signs, non-numeric strings)
        if (!/^\d+$/.test(rawDelay)) {
          sendJson(res, 400, {
            status: 'error',
            error: 'Bad Request',
            message: `Invalid 'delay' parameter. Must be an integer between ${MIN_SLOW_DELAY_MS} and ${MAX_SLOW_DELAY_MS} ms.`,
          }, isHead);
          return;
        }

        delayMs = Number.parseInt(rawDelay, 10);

        if (delayMs > MAX_SLOW_DELAY_MS) {
          sendJson(res, 400, {
            status: 'error',
            error: 'Bad Request',
            message: `Delay ${delayMs} ms exceeds the maximum allowed limit of ${MAX_SLOW_DELAY_MS} ms.`,
          }, isHead);
          return;
        }
      }

      // Safe asynchronous delay simulation using timer
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      sendJson(res, 200, {
        status: 'ok',
        service: 'test-target',
        message: 'Simulated application delay completed',
        simulatedDelayMs: delayMs,
        type: 'application_processing_delay',
        _documentation: {
          purpose: 'Demonstrates server-side processing latency as distinct from network transport latency.',
        },
      }, isHead);
      return;
    }

    // ------------------------------------------------------------------------
    // Route: 404 Catch-All
    // ------------------------------------------------------------------------
    sendJson(res, 404, {
      status: 'error',
      error: 'Not Found',
      message: `The requested endpoint '${pathname}' does not exist on this test target.`,
    }, isHead);
  } catch (err) {
    // Catch unexpected runtime errors and return 500 without leaking stack trace
    console.error(`[test-target] Unexpected error processing ${req.method} ${pathname}:`, err?.message || err);
    sendJson(res, 500, {
      status: 'error',
      error: 'Internal Server Error',
      message: 'An unexpected server error occurred.',
    }, isHead);
  }
}

/**
 * Creates and initializes the HTTP server.
 *
 * @returns {http.Server}
 */
export function createServer() {
  return http.createServer(handleRequest);
}

// Start server directly when executed as main module
const isMain = process.argv[1] && (
  process.argv[1].endsWith('server.js') ||
  process.argv[1] === import.meta.filename
);

if (isMain) {
  const server = createServer();

  server.listen(PORT, HOST, () => {
    console.log(`[test-target] Server listening on http://${HOST}:${PORT}`);
    console.log(`[test-target] Health check: http://${HOST}:${PORT}/health`);
    console.log(`[test-target] Demo endpoint: http://${HOST}:${PORT}/api/demo`);
    console.log(`[test-target] Slow endpoint: http://${HOST}:${PORT}/api/slow?delay=100`);
  });

  // Graceful shutdown
  const shutdown = (signal) => {
    console.log(`\n[test-target] Received ${signal}. Shutting down gracefully...`);
    server.close(() => {
      console.log('[test-target] Server closed successfully.');
      process.exit(0);
    });

    // Force exit after 3s if connections hang
    setTimeout(() => {
      console.error('[test-target] Forcing shutdown after timeout.');
      process.exit(1);
    }, 3000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
