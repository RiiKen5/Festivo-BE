const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const ApiResponse = require('../utils/apiResponse');
const { hashToken } = require('../utils/helpers');

// @desc    Register user
// @route   POST /api/v1/auth/register
// @access  Public
exports.register = catchAsync(async (req, res, next) => {
  const { email, password, phone, name, city, userType } = req.body;

  // Check if user exists
  const existingUser = await User.findOne({ $or: [{ email }, { phone }] });
  if (existingUser) {
    return next(new ApiError('User already exists with this email or phone', 400));
  }

  // Create user
  const user = await User.create({
    email,
    password,
    phone,
    name,
    city,
    userType: userType || 'all'
  });

  // Generate tokens
  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();

  // Store refresh token
  user.refreshTokens.push(refreshToken);
  await user.save();

  res.status(201).json(
    ApiResponse.success(
      {
        user,
        tokens: { accessToken, refreshToken }
      },
      'User registered successfully'
    )
  );
});

// @desc    Login user
// @route   POST /api/v1/auth/login
// @access  Public
exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return next(new ApiError('Please provide email and password', 400));
  }

  // Check user exists
  const user = await User.findOne({ email }).select('+password +refreshTokens');
  if (!user) {
    return next(new ApiError('Invalid credentials', 401));
  }

  // Check password
  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    return next(new ApiError('Invalid credentials', 401));
  }

  // Check if account is active
  if (!user.isActive) {
    return next(new ApiError('Your account has been deactivated', 403));
  }

  if (user.isBanned) {
    return next(new ApiError('Your account has been banned', 403));
  }

  // Generate tokens
  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();

  // Store refresh token (limit to 5 devices)
  if (user.refreshTokens.length >= 5) {
    user.refreshTokens.shift();
  }
  user.refreshTokens.push(refreshToken);
  user.lastLoginAt = new Date();
  await user.save();

  // Remove password from response
  user.password = undefined;
  user.refreshTokens = undefined;

  res.json(
    ApiResponse.success(
      {
        user,
        tokens: { accessToken, refreshToken }
      },
      'Login successful'
    )
  );
});

// @desc    Refresh token
// @route   POST /api/v1/auth/refresh-token
// @access  Public
exports.refreshToken = catchAsync(async (req, res, next) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return next(new ApiError('Refresh token required', 400));
  }

  // Verify refresh token
  let decoded;
  try {
    decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch (error) {
    return next(new ApiError('Invalid refresh token', 401));
  }

  // Get user and check if refresh token exists
  const user = await User.findById(decoded.id).select('+refreshTokens');

  if (!user || !user.refreshTokens.includes(refreshToken)) {
    return next(new ApiError('Invalid refresh token', 401));
  }

  // Generate new access token
  const newAccessToken = user.generateAccessToken();

  res.json(
    ApiResponse.success(
      { accessToken: newAccessToken },
      'Token refreshed successfully'
    )
  );
});

// @desc    Logout
// @route   POST /api/v1/auth/logout
// @access  Private
exports.logout = catchAsync(async (req, res, next) => {
  const { refreshToken } = req.body;

  // Get user with refresh tokens
  const user = await User.findById(req.user._id).select('+refreshTokens');

  if (refreshToken) {
    // Remove specific refresh token
    user.refreshTokens = user.refreshTokens.filter(token => token !== refreshToken);
  } else {
    // Remove all refresh tokens (logout from all devices)
    user.refreshTokens = [];
  }

  await user.save();

  res.json(ApiResponse.success(null, 'Logged out successfully'));
});

// @desc    Get current user
// @route   GET /api/v1/auth/me
// @access  Private
exports.getMe = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);

  res.json(ApiResponse.success(user, 'User retrieved successfully'));
});

// @desc    Update password
// @route   POST /api/v1/auth/change-password
// @access  Private
exports.changePassword = catchAsync(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select('+password +refreshTokens');

  // Check current password
  const isValid = await user.comparePassword(currentPassword);
  if (!isValid) {
    return next(new ApiError('Current password is incorrect', 400));
  }

  // Update password
  user.password = newPassword;
  user.refreshTokens = []; // Invalidate all sessions
  await user.save();

  // Generate new tokens
  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();

  user.refreshTokens.push(refreshToken);
  await user.save();

  res.json(
    ApiResponse.success(
      { tokens: { accessToken, refreshToken } },
      'Password changed successfully'
    )
  );
});

// @desc    Forgot password (send reset email)
// @route   POST /api/v1/auth/forgot-password
// @access  Public
exports.forgotPassword = catchAsync(async (req, res, next) => {
  const { email } = req.body;

  const user = await User.findOne({ email });
  if (!user) {
    return next(new ApiError('No user found with that email', 404));
  }

  // Generate reset token
  const resetToken = crypto.randomBytes(32).toString('hex');
  user.passwordResetToken = hashToken(resetToken);
  user.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

  await user.save();

  // Build reset URL
  const resetUrl = `${process.env.FRONTEND_URL}/auth/reset-password?token=${resetToken}`;

  // TODO: Send email with resetUrl using emailService
  // await emailService.sendPasswordReset(user.email, resetUrl);

  res.json(
    ApiResponse.success(
      { resetUrl }, // Remove this in production, only for development
      'Password reset link sent to email'
    )
  );
});

// @desc    Reset password
// @route   POST /api/v1/auth/reset-password
// @access  Public
exports.resetPassword = catchAsync(async (req, res, next) => {
  const { token, newPassword } = req.body;

  const hashedToken = hashToken(token);

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() }
  }).select('+refreshTokens');

  if (!user) {
    return next(new ApiError('Token is invalid or has expired', 400));
  }

  user.password = newPassword;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  user.refreshTokens = [];
  await user.save();

  res.json(ApiResponse.success(null, 'Password reset successful'));
});

// @desc    Update profile
// @route   PUT /api/v1/auth/profile
// @access  Private
exports.updateProfile = catchAsync(async (req, res, next) => {
  const allowedFields = ['name', 'bio', 'city', 'userType', 'interests', 'socialLinks', 'notifications'];
  const updates = {};

  allowedFields.forEach(field => {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  });

  const user = await User.findByIdAndUpdate(
    req.user._id,
    updates,
    { new: true, runValidators: true }
  );

  res.json(ApiResponse.success(user, 'Profile updated successfully'));
});

// @desc    Update profile photo
// @route   PUT /api/v1/auth/profile-photo
// @access  Private
exports.updateProfilePhoto = catchAsync(async (req, res, next) => {
  if (!req.file) {
    return next(new ApiError('Please upload a photo', 400));
  }

  // File URL will be set by upload middleware
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { profilePhoto: req.file.location || req.file.path },
    { new: true }
  );

  res.json(ApiResponse.success(user, 'Profile photo updated successfully'));
});

// @desc    Verify email
// @route   POST /api/v1/auth/verify-email
// @access  Private
exports.verifyEmail = catchAsync(async (req, res, next) => {
  const { token } = req.body;

  // TODO: Implement email verification logic
  // This would typically involve sending a verification link via email

  res.json(ApiResponse.success(null, 'Email verified successfully'));
});

// @desc    Request phone verification
// @route   POST /api/v1/auth/verify-phone/request
// @access  Private
exports.requestPhoneVerification = catchAsync(async (req, res, next) => {
  // TODO: Implement phone verification via SMS/OTP

  res.json(ApiResponse.success(null, 'OTP sent to your phone'));
});

// @desc    Verify phone with OTP
// @route   POST /api/v1/auth/verify-phone
// @access  Private
exports.verifyPhone = catchAsync(async (req, res, next) => {
  const { otp } = req.body;

  // TODO: Implement OTP verification logic

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { phoneVerified: true },
    { new: true }
  );

  res.json(ApiResponse.success(user, 'Phone verified successfully'));
});
