const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const ApiResponse = require('../utils/apiResponse');
const { hashToken } = require('../utils/helpers');
const emailService = require('../services/emailService');
const smsService = require('../services/smsService');

// @desc    Register user
// @route   POST /api/v1/auth/register
// @access  Public
exports.register = catchAsync(async (req, res, next) => {
  const { email, password, phone, name, city, userType } = req.body;

  // Check if user exists
  const existingUser = await User.findOne({ $or: [{ email }, { phone }] });
  if (existingUser) {
    // If user exists but email not verified, allow re-registration (resend verification)
    if (!existingUser.emailVerified) {
      // Generate new verification token
      const emailVerificationToken = crypto.randomBytes(32).toString('hex');
      existingUser.emailVerificationToken = hashToken(emailVerificationToken);
      existingUser.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
      await existingUser.save();

      // Send verification email
      const verificationUrl = `${process.env.FRONTEND_URL}/auth/verify-email?token=${emailVerificationToken}`;
      try {
        await emailService.sendEmailVerification(existingUser, verificationUrl);
      } catch (error) {
        console.error('Failed to send verification email:', error.message);
      }

      return res.status(200).json(
        ApiResponse.success(
          {
            message: 'A verification email has been sent. Please check your inbox.',
            email: existingUser.email,
            ...(process.env.NODE_ENV === 'development' && {
              _dev: { emailVerificationUrl: verificationUrl }
            })
          },
          'Verification email resent. Please verify your email to continue.'
        )
      );
    }
    return next(new ApiError('User already exists with this email or phone', 400));
  }

  // Generate email verification token
  const emailVerificationToken = crypto.randomBytes(32).toString('hex');
  const hashedEmailToken = hashToken(emailVerificationToken);

  // Create user (NOT verified yet, NO tokens issued)
  const user = await User.create({
    email,
    password,
    phone,
    name,
    city,
    userType: userType || 'all',
    emailVerified: false,
    phoneVerified: false,
    emailVerificationToken: hashedEmailToken,
    emailVerificationExpires: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
  });

  // Send email verification link
  const verificationUrl = `${process.env.FRONTEND_URL}/auth/verify-email?token=${emailVerificationToken}`;
  let emailSent = false;
  try {
    await emailService.sendEmailVerification(user, verificationUrl);
    emailSent = true;
  } catch (error) {
    console.error('Failed to send verification email:', error.message);
  }

  // Response - NO tokens until email is verified
  res.status(201).json(
    ApiResponse.success(
      {
        message: 'Registration successful. Please verify your email to login.',
        email: user.email,
        emailSent,
        // For development - remove in production
        ...(process.env.NODE_ENV === 'development' && {
          _dev: {
            emailVerificationUrl: verificationUrl
          }
        })
      },
      'Please check your email and click the verification link to complete registration.'
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

  // Check email verification status
  if (!user.emailVerified) {
    // Generate new verification token for unverified user
    const emailVerificationToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = hashToken(emailVerificationToken);
    user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    await user.save();

    // Send verification email
    const verificationUrl = `${process.env.FRONTEND_URL}/auth/verify-email?token=${emailVerificationToken}`;
    try {
      await emailService.sendEmailVerification(user, verificationUrl);
    } catch (error) {
      console.error('Failed to send verification email:', error.message);
    }

    return res.status(403).json(
      ApiResponse.error(
        'Email not verified. A new verification link has been sent to your email.',
        403,
        {
          emailVerified: false,
          requiresVerification: true,
          ...(process.env.NODE_ENV === 'development' && {
            _dev: { emailVerificationUrl: verificationUrl }
          })
        }
      )
    );
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

  // Build verification status
  const verificationStatus = {
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified
  };

  res.json(
    ApiResponse.success(
      {
        user,
        tokens: { accessToken, refreshToken },
        verificationStatus
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

// @desc    Verify email with token
// @route   POST /api/v1/auth/verify-email
// @access  Public
exports.verifyEmail = catchAsync(async (req, res, next) => {
  const { token } = req.body;

  if (!token) {
    return next(new ApiError('Verification token is required', 400));
  }

  const hashedToken = hashToken(token);

  const user = await User.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationExpires: { $gt: Date.now() }
  }).select('+refreshTokens');

  if (!user) {
    return next(new ApiError('Invalid or expired verification token', 400));
  }

  // Mark email as verified
  user.emailVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;

  // Generate tokens NOW (first time user gets tokens)
  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();

  // Store refresh token
  user.refreshTokens = user.refreshTokens || [];
  user.refreshTokens.push(refreshToken);
  await user.save();

  // Send welcome email
  try {
    await emailService.sendWelcomeEmail(user);
  } catch (error) {
    console.error('Failed to send welcome email:', error.message);
  }

  res.json(
    ApiResponse.success(
      {
        user,
        tokens: { accessToken, refreshToken },
        emailVerified: true
      },
      'Email verified successfully. You are now logged in.'
    )
  );
});

// @desc    Resend email verification
// @route   POST /api/v1/auth/resend-email-verification
// @access  Private
exports.resendEmailVerification = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);

  if (user.emailVerified) {
    return next(new ApiError('Email is already verified', 400));
  }

  // Generate new verification token
  const emailVerificationToken = crypto.randomBytes(32).toString('hex');
  user.emailVerificationToken = hashToken(emailVerificationToken);
  user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  await user.save();

  // Send verification email
  const verificationUrl = `${process.env.FRONTEND_URL}/auth/verify-email?token=${emailVerificationToken}`;
  try {
    await emailService.sendEmailVerification(user, verificationUrl);
  } catch (error) {
    console.error('Failed to send verification email:', error.message);
    return next(new ApiError('Failed to send verification email', 500));
  }

  res.json(
    ApiResponse.success(
      {
        message: 'Verification email sent',
        ...(process.env.NODE_ENV === 'development' && {
          _dev: { emailVerificationUrl: verificationUrl }
        })
      },
      'Verification email sent successfully'
    )
  );
});

// @desc    Request phone verification (send OTP)
// @route   POST /api/v1/auth/verify-phone/request
// @access  Private
exports.requestPhoneVerification = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);

  if (user.phoneVerified) {
    return next(new ApiError('Phone is already verified', 400));
  }

  // Generate new OTP
  const phoneOTP = smsService.generateOTP(6);
  user.phoneOTP = phoneOTP;
  user.phoneOTPExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  await user.save();

  // Send OTP via SMS
  try {
    await smsService.sendOTP(user.phone, phoneOTP);
  } catch (error) {
    console.error('Failed to send OTP:', error.message);
  }

  res.json(
    ApiResponse.success(
      {
        message: 'OTP sent to your phone',
        expiresIn: '10 minutes',
        ...(process.env.NODE_ENV === 'development' && {
          _dev: { phoneOTP: phoneOTP }
        })
      },
      'OTP sent successfully'
    )
  );
});

// @desc    Verify phone with OTP
// @route   POST /api/v1/auth/verify-phone
// @access  Private
exports.verifyPhone = catchAsync(async (req, res, next) => {
  const { otp } = req.body;

  if (!otp) {
    return next(new ApiError('OTP is required', 400));
  }

  const user = await User.findById(req.user._id).select('+phoneOTP');

  if (user.phoneVerified) {
    return next(new ApiError('Phone is already verified', 400));
  }

  if (!user.phoneOTP || !user.phoneOTPExpires) {
    return next(new ApiError('No OTP request found. Please request a new OTP', 400));
  }

  if (Date.now() > user.phoneOTPExpires) {
    return next(new ApiError('OTP has expired. Please request a new one', 400));
  }

  if (user.phoneOTP !== otp) {
    return next(new ApiError('Invalid OTP', 400));
  }

  // Mark phone as verified
  user.phoneVerified = true;
  user.phoneOTP = undefined;
  user.phoneOTPExpires = undefined;
  await user.save();

  res.json(ApiResponse.success({ phoneVerified: true }, 'Phone verified successfully'));
});

// @desc    Register admin (requires secret key)
// @route   POST /api/v1/auth/register-admin
// @access  Public (but requires ADMIN_SECRET)
exports.registerAdmin = catchAsync(async (req, res, next) => {
  const { email, password, phone, name, city, adminSecret } = req.body;

  // Verify admin secret key
  const validSecret = process.env.ADMIN_SECRET || 'festivo-admin-secret-2024';
  if (adminSecret !== validSecret) {
    return next(new ApiError('Invalid admin secret key', 403));
  }

  // Check if user exists
  const existingUser = await User.findOne({ $or: [{ email }, { phone }] });
  if (existingUser) {
    return next(new ApiError('User already exists with this email or phone', 400));
  }

  // Create admin user
  const user = await User.create({
    email,
    password,
    phone,
    name,
    city,
    userType: 'all',
    role: 'admin'
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
      'Admin registered successfully'
    )
  );
});
