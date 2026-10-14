/**
 * NetReplay Toxiproxy Engine Adapter Package
 *
 * Public entrypoint exporting client, adapter, validation schemas, and error classes.
 */

export { ToxiproxyClient } from './client.js';
export { ToxiproxyAdapter } from './adapter.js';
export {
  validateProxyConfig,
  validateAndMapFault,
  BOUNDS,
  VALID_STREAMS,
  VALID_FAULT_TYPES,
} from './validation.js';
export {
  ToxiproxyError,
  ToxiproxyValidationError,
  ToxiproxyHttpError,
  ToxiproxyNotFoundError,
  ToxiproxyConflictError,
  ToxiproxyConnectionError,
  ToxiproxyTimeoutError,
  ToxiproxyCleanupError,
} from './errors.js';
