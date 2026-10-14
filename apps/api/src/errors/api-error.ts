/**
 * NetReplay API Error Hierarchy
 *
 * Provides strongly-typed HTTP API error classes with status codes and structured details.
 */

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly details?: unknown;

  constructor(statusCode: number, errorCode: string, message: string, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
  }
}

export class BadRequestError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(400, 'BAD_REQUEST', message, details);
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(404, 'NOT_FOUND', message, details);
  }
}

export class ConflictError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(409, 'CONFLICT', message, details);
  }
}

export class ServiceUnavailableError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(503, 'SERVICE_UNAVAILABLE', message, details);
  }
}

export class UnprocessableEntityError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(422, 'UNPROCESSABLE_ENTITY', message, details);
  }
}
