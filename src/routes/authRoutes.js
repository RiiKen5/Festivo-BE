const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middlewares/auth');
const { authLimiter } = require('../middlewares/rateLimiter');
const { validate, authValidations } = require('../middlewares/validation');

// Public routes
router.post(
  '/register',
  authLimiter,
  authValidations.register,
  validate,
  authController.register
);

router.post(
  '/login',
  authLimiter,
  authValidations.login,
  validate,
  authController.login
);

router.post('/refresh-token', authController.refreshToken);

router.post(
  '/forgot-password',
  authLimiter,
  authValidations.forgotPassword,
  validate,
  authController.forgotPassword
);

router.post(
  '/reset-password',
  authValidations.resetPassword,
  validate,
  authController.resetPassword
);

// Admin registration (requires secret key)
router.post(
  '/register-admin',
  authLimiter,
  authController.registerAdmin
);

// Google OAuth
router.post('/google', authLimiter, authController.googleAuth);

// Email verification (public - user clicks link from email)
router.post('/verify-email', authController.verifyEmail);

// Protected routes
router.use(protect);

router.get('/me', authController.getMe);
router.post('/logout', authController.logout);

router.post(
  '/change-password',
  authValidations.changePassword,
  validate,
  authController.changePassword
);

router.put('/profile', authController.updateProfile);
router.put('/profile-photo', authController.updateProfilePhoto);

router.post('/resend-email-verification', authController.resendEmailVerification);
router.post('/verify-phone/request', authController.requestPhoneVerification);
router.post('/verify-phone', authController.verifyPhone);

module.exports = router;
