/**
 * Standardized API Response helper
 */
class ApiResponse {
  /**
   * Success response
   * @param {any} data - Response data
   * @param {string} message - Success message
   * @param {object} meta - Additional metadata (pagination, etc.)
   */
  static success(data, message = 'Success', meta = null) {
    const response = {
      success: true,
      message,
      data
    };

    if (meta) {
      response.meta = meta;
    }

    return response;
  }

  /**
   * Error response
   * @param {string} message - Error message
   * @param {string} code - Error code
   * @param {array} errors - Validation errors array
   */
  static error(message, code = 'ERROR', errors = null) {
    const response = {
      success: false,
      error: {
        code,
        message
      }
    };

    if (errors) {
      response.error.errors = errors;
    }

    return response;
  }

  /**
   * Paginated response
   * @param {array} data - Array of items
   * @param {number} page - Current page
   * @param {number} limit - Items per page
   * @param {number} total - Total items
   * @param {string} message - Success message
   */
  static paginated(data, page, limit, total, message = 'Success') {
    return {
      success: true,
      message,
      data,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1
      }
    };
  }
}

module.exports = ApiResponse;
