const jwt = require('jsonwebtoken');
const ApiError = require('../utils/apiError');
const catchAsync = require('../utils/catchAsync');
const User = require('../models/User');

// Protect routes - require authentication
exports.protect = catchAsync(async (req, res, next) => {
  let token;

  // Get token from header
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(new ApiError('Not authorized to access this route', 401));
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from token
    req.user = await User.findById(decoded.id).select('-password');

    if (!req.user) {
      return next(new ApiError('User not found', 404));
    }

    if (!req.user.isActive) {
      return next(new ApiError('Your account has been deactivated', 403));
    }

    if (req.user.isBanned) {
      return next(new ApiError('Your account has been banned', 403));
    }

    next();
  } catch (error) {
    return next(new ApiError('Not authorized to access this route', 401));
  }
});

// Optional authentication - attach user if token exists
exports.optionalAuth = catchAsync(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
    } catch (error) {
      // Token invalid, continue without user
    }
  }

  next();
});

// Check ownership of a resource
exports.checkOwnership = (model, paramId = 'id', ownerField = 'organizer') => {
  return catchAsync(async (req, res, next) => {
    const document = await model.findById(req.params[paramId]);

    if (!document) {
      return next(new ApiError('Resource not found', 404));
    }

    // Admin can access everything
    if (req.user.role === 'admin') {
      req.resource = document;
      return next();
    }

    // Check if user is the owner
    const ownerId = typeof document[ownerField] === 'object'
      ? document[ownerField]._id.toString()
      : document[ownerField].toString();

    if (ownerId !== req.user._id.toString()) {
      return next(new ApiError('Not authorized to perform this action', 403));
    }

    req.resource = document;
    next();
  });
};

// Restrict to specific roles
exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(new ApiError('You do not have permission to perform this action', 403));
    }
    next();
  };
};

// Check user type
exports.checkUserType = (...types) => {
  return (req, res, next) => {
    if (!types.includes(req.user.userType) && req.user.userType !== 'all') {
      return next(new ApiError('You do not have permission to perform this action', 403));
    }
    next();
  };
};

// Verify email middleware
exports.requireVerifiedEmail = (req, res, next) => {
  if (!req.user.emailVerified) {
    return next(new ApiError('Please verify your email to access this feature', 403));
  }
  next();
};

// Verify phone middleware
exports.requireVerifiedPhone = (req, res, next) => {
  if (!req.user.phoneVerified) {
    return next(new ApiError('Please verify your phone to access this feature', 403));
  }
  next();
};
