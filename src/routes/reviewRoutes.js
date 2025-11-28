const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { protect, restrictTo } = require('../middlewares/auth');
const { validate, reviewValidations, paramValidations, paginationValidations } = require('../middlewares/validation');

// Public routes
router.get('/service/:serviceId', paginationValidations, validate, reviewController.getServiceReviews);
router.get('/service/:serviceId/stats', reviewController.getServiceReviewStats);
router.get('/vendor/:vendorId', paginationValidations, validate, reviewController.getVendorReviews);

// Protected routes
router.use(protect);

router.get('/my-reviews', paginationValidations, validate, reviewController.getMyReviews);

router.post(
  '/',
  reviewValidations.create,
  validate,
  reviewController.createReview
);

router.put('/:id', paramValidations.mongoId, validate, reviewController.updateReview);
router.delete('/:id', paramValidations.mongoId, validate, reviewController.deleteReview);

router.post('/:id/respond', paramValidations.mongoId, validate, reviewController.addVendorResponse);
router.post('/:id/helpful', paramValidations.mongoId, validate, reviewController.markHelpful);
router.delete('/:id/helpful', paramValidations.mongoId, validate, reviewController.removeHelpful);
router.post('/:id/flag', paramValidations.mongoId, validate, reviewController.flagReview);

// Admin routes
router.put('/:id/moderate', restrictTo('admin'), paramValidations.mongoId, validate, reviewController.moderateReview);

module.exports = router;
