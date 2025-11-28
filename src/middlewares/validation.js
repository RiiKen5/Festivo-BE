const { validationResult, body, param, query } = require('express-validator');
const ApiError = require('../utils/apiError');

// Validation result handler
const validate = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(error => ({
      field: error.path,
      message: error.msg
    }));

    return next(new ApiError('Validation Error', 400, errorMessages));
  }

  next();
};

// Auth validations
const authValidations = {
  register: [
    body('email')
      .isEmail()
      .withMessage('Please provide a valid email')
      .normalizeEmail(),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters')
      .matches(/\d/)
      .withMessage('Password must contain a number'),
    body('phone')
      .isMobilePhone('en-IN')
      .withMessage('Please provide a valid Indian phone number'),
    body('name')
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Name must be between 2 and 100 characters'),
    body('city')
      .trim()
      .notEmpty()
      .withMessage('City is required')
  ],
  login: [
    body('email')
      .isEmail()
      .withMessage('Please provide a valid email')
      .normalizeEmail(),
    body('password')
      .notEmpty()
      .withMessage('Password is required')
  ],
  forgotPassword: [
    body('email')
      .isEmail()
      .withMessage('Please provide a valid email')
      .normalizeEmail()
  ],
  resetPassword: [
    body('token')
      .notEmpty()
      .withMessage('Token is required'),
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters')
  ],
  changePassword: [
    body('currentPassword')
      .notEmpty()
      .withMessage('Current password is required'),
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('New password must be at least 8 characters')
      .matches(/\d/)
      .withMessage('New password must contain a number')
  ]
};

// Event validations
const eventValidations = {
  create: [
    body('title')
      .trim()
      .isLength({ min: 3, max: 200 })
      .withMessage('Title must be between 3 and 200 characters'),
    body('description')
      .trim()
      .isLength({ min: 10, max: 5000 })
      .withMessage('Description must be between 10 and 5000 characters'),
    body('eventType')
      .isIn(['birthday', 'house_party', 'meetup', 'wedding', 'corporate', 'farewell', 'other'])
      .withMessage('Invalid event type'),
    body('date')
      .isISO8601()
      .withMessage('Please provide a valid date'),
    body('time')
      .notEmpty()
      .withMessage('Time is required'),
    body('locationName')
      .trim()
      .notEmpty()
      .withMessage('Location name is required'),
    body('address')
      .trim()
      .notEmpty()
      .withMessage('Address is required'),
    body('city')
      .trim()
      .notEmpty()
      .withMessage('City is required'),
    body('coordinates')
      .isArray({ min: 2, max: 2 })
      .withMessage('Coordinates must be [longitude, latitude]'),
    body('expectedGuests')
      .isInt({ min: 1 })
      .withMessage('Expected guests must be at least 1')
  ],
  update: [
    body('title')
      .optional()
      .trim()
      .isLength({ min: 3, max: 200 })
      .withMessage('Title must be between 3 and 200 characters'),
    body('description')
      .optional()
      .trim()
      .isLength({ min: 10, max: 5000 })
      .withMessage('Description must be between 10 and 5000 characters'),
    body('eventType')
      .optional()
      .isIn(['birthday', 'house_party', 'meetup', 'wedding', 'corporate', 'farewell', 'other'])
      .withMessage('Invalid event type')
  ]
};

// Service validations
const serviceValidations = {
  create: [
    body('serviceName')
      .trim()
      .isLength({ min: 3, max: 200 })
      .withMessage('Service name must be between 3 and 200 characters'),
    body('category')
      .isIn(['food', 'decor', 'photography', 'music', 'cleanup', 'entertainment', 'venue', 'other'])
      .withMessage('Invalid category'),
    body('description')
      .trim()
      .isLength({ min: 10, max: 2000 })
      .withMessage('Description must be between 10 and 2000 characters'),
    body('basePrice')
      .isFloat({ min: 0 })
      .withMessage('Base price must be a positive number'),
    body('priceUnit')
      .isIn(['per_event', 'per_hour', 'per_day', 'per_person'])
      .withMessage('Invalid price unit'),
    body('city')
      .trim()
      .notEmpty()
      .withMessage('City is required')
  ]
};

// Booking validations
const bookingValidations = {
  create: [
    body('eventId')
      .isMongoId()
      .withMessage('Invalid event ID'),
    body('serviceId')
      .isMongoId()
      .withMessage('Invalid service ID'),
    body('eventDate')
      .isISO8601()
      .withMessage('Please provide a valid event date'),
    body('priceAgreed')
      .isFloat({ min: 0 })
      .withMessage('Price must be a positive number')
  ]
};

// Review validations
const reviewValidations = {
  create: [
    body('bookingId')
      .isMongoId()
      .withMessage('Invalid booking ID'),
    body('rating')
      .isInt({ min: 1, max: 5 })
      .withMessage('Rating must be between 1 and 5'),
    body('reviewText')
      .trim()
      .isLength({ min: 10, max: 1000 })
      .withMessage('Review must be between 10 and 1000 characters')
  ]
};

// Message validations
const messageValidations = {
  create: [
    body('receiverId')
      .isMongoId()
      .withMessage('Invalid receiver ID'),
    body('messageText')
      .trim()
      .isLength({ min: 1, max: 5000 })
      .withMessage('Message must be between 1 and 5000 characters')
  ]
};

// Task validations
const taskValidations = {
  create: [
    body('eventId')
      .isMongoId()
      .withMessage('Invalid event ID'),
    body('taskName')
      .trim()
      .isLength({ min: 3, max: 200 })
      .withMessage('Task name must be between 3 and 200 characters'),
    body('category')
      .isIn(['venue', 'food', 'decor', 'music', 'photo', 'logistics', 'communication', 'other'])
      .withMessage('Invalid category')
  ]
};

// RSVP validations
const rsvpValidations = {
  create: [
    body('eventId')
      .isMongoId()
      .withMessage('Invalid event ID'),
    body('status')
      .optional()
      .isIn(['going', 'maybe', 'not_going'])
      .withMessage('Invalid status')
  ]
};

// Common param validations
const paramValidations = {
  mongoId: [
    param('id')
      .isMongoId()
      .withMessage('Invalid ID')
  ]
};

// Pagination query validations
const paginationValidations = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
];

module.exports = {
  validate,
  authValidations,
  eventValidations,
  serviceValidations,
  bookingValidations,
  reviewValidations,
  messageValidations,
  taskValidations,
  rsvpValidations,
  paramValidations,
  paginationValidations
};
