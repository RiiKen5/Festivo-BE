/**
 * Custom API Error class for handling operational errors
 */
class ApiError extends Error {
  constructor(message, statusCode, errors = null) {
    super(message);

    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    this.errors = errors;

    // Set error code based on status
    this.code = this.getErrorCode(statusCode);

    Error.captureStackTrace(this, this.constructor);
  }

  getErrorCode(statusCode) {
    const codes = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_SERVER_ERROR'
    };
    return codes[statusCode] || 'UNKNOWN_ERROR';
  }
}

module.exports = ApiError;
