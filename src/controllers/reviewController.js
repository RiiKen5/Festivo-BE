const Review = require('../models/Review');
const Booking = require('../models/Booking');
const Service = require('../models/Service');
const Notification = require('../models/Notification');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const ApiResponse = require('../utils/apiResponse');

// @desc    Get reviews for a service
// @route   GET /api/v1/reviews/service/:serviceId
// @access  Public
exports.getServiceReviews = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 20, sort = '-createdAt', minRating } = req.query;

  const query = { service: req.params.serviceId, isApproved: true };
  if (minRating) query.rating = { $gte: parseInt(minRating) };

  const reviews = await Review.find(query)
    .populate('reviewer', 'name profilePhoto')
    .populate('event', 'title eventType')
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

  const total = await Review.countDocuments(query);

  res.json(
    ApiResponse.paginated(reviews, page, limit, total, 'Reviews retrieved successfully')
  );
});

// @desc    Get single review
// @route   GET /api/v1/reviews/:id
// @access  Public
exports.getReview = catchAsync(async (req, res, next) => {
  const review = await Review.findById(req.params.id)
    .populate('reviewer', 'name profilePhoto')
    .populate('service', 'serviceName category coverImage')
    .populate('vendor', 'name profilePhoto')
    .populate('event', 'title eventType');

  if (!review) {
    return next(new ApiError('Review not found', 404));
  }

  res.json(ApiResponse.success(review, 'Review retrieved successfully'));
});

// @desc    Get reviews for a vendor
// @route   GET /api/v1/reviews/vendor/:vendorId
// @access  Public
exports.getVendorReviews = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 20, sort = '-createdAt' } = req.query;

  const query = { vendor: req.params.vendorId, isApproved: true };

  const reviews = await Review.find(query)
    .populate('reviewer', 'name profilePhoto')
    .populate('service', 'serviceName category')
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

  const total = await Review.countDocuments(query);

  res.json(
    ApiResponse.paginated(reviews, page, limit, total, 'Reviews retrieved successfully')
  );
});

// @desc    Create review
// @route   POST /api/v1/reviews
// @access  Private
exports.createReview = catchAsync(async (req, res, next) => {
  const { bookingId, rating, reviewText, ratings, photos } = req.body;

  // Get booking
  const booking = await Booking.findById(bookingId)
    .populate('service')
    .populate('event');

  if (!booking) {
    return next(new ApiError('Booking not found', 404));
  }

  // Check if user is the organizer
  if (booking.organizer.toString() !== req.user._id.toString()) {
    return next(new ApiError('Only the organizer can review this booking', 403));
  }

  // Check if booking is completed
  if (booking.status !== 'completed') {
    return next(new ApiError('Can only review completed bookings', 400));
  }

  // Check if already reviewed
  const existingReview = await Review.findOne({ booking: bookingId });
  if (existingReview) {
    return next(new ApiError('You have already reviewed this booking', 400));
  }

  const review = await Review.create({
    booking: bookingId,
    service: booking.service._id,
    vendor: booking.vendor,
    reviewer: req.user._id,
    event: booking.event._id,
    rating,
    reviewText,
    ratings,
    photos
  });

  // Notify vendor
  await Notification.createNotification({
    recipient: booking.vendor,
    type: 'review',
    title: 'New Review',
    message: `${req.user.name} left a ${rating}-star review for ${booking.service.serviceName}`,
    relatedBooking: bookingId,
    relatedUser: req.user._id,
    actionUrl: `/reviews/${review._id}`
  });

  // Award XP
  const User = require('../models/User');
  await User.findByIdAndUpdate(req.user._id, {
    $inc: { xpPoints: 10 }
  });

  await review.populate([
    { path: 'reviewer', select: 'name profilePhoto' },
    { path: 'service', select: 'serviceName' }
  ]);

  res.status(201).json(ApiResponse.success(review, 'Review created successfully'));
});

// @desc    Update review
// @route   PUT /api/v1/reviews/:id
// @access  Private
exports.updateReview = catchAsync(async (req, res, next) => {
  const { rating, reviewText, ratings, photos } = req.body;

  let review = await Review.findById(req.params.id);

  if (!review) {
    return next(new ApiError('Review not found', 404));
  }

  if (review.reviewer.toString() !== req.user._id.toString()) {
    return next(new ApiError('Not authorized to update this review', 403));
  }

  // Can only update within 7 days of creation
  const daysSinceCreation = (Date.now() - review.createdAt) / (1000 * 60 * 60 * 24);
  if (daysSinceCreation > 7) {
    return next(new ApiError('Can only edit reviews within 7 days of posting', 400));
  }

  review = await Review.findByIdAndUpdate(
    req.params.id,
    { rating, reviewText, ratings, photos },
    { new: true, runValidators: true }
  );

  res.json(ApiResponse.success(review, 'Review updated successfully'));
});

// @desc    Delete review
// @route   DELETE /api/v1/reviews/:id
// @access  Private
exports.deleteReview = catchAsync(async (req, res, next) => {
  const review = await Review.findById(req.params.id);

  if (!review) {
    return next(new ApiError('Review not found', 404));
  }

  if (review.reviewer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    return next(new ApiError('Not authorized to delete this review', 403));
  }

  await Review.findByIdAndDelete(req.params.id);

  res.json(ApiResponse.success(null, 'Review deleted successfully'));
});

// @desc    Add vendor response
// @route   POST /api/v1/reviews/:id/respond
// @access  Private
exports.addVendorResponse = catchAsync(async (req, res, next) => {
  const { response } = req.body;

  const review = await Review.findById(req.params.id);

  if (!review) {
    return next(new ApiError('Review not found', 404));
  }

  if (review.vendor.toString() !== req.user._id.toString()) {
    return next(new ApiError('Only the vendor can respond to this review', 403));
  }

  if (review.vendorResponse) {
    return next(new ApiError('You have already responded to this review', 400));
  }

  review.vendorResponse = response;
  review.respondedAt = new Date();
  await review.save();

  // Notify reviewer
  await Notification.createNotification({
    recipient: review.reviewer,
    type: 'review',
    title: 'Vendor Response',
    message: 'The vendor has responded to your review',
    relatedUser: req.user._id,
    actionUrl: `/reviews/${review._id}`
  });

  res.json(ApiResponse.success(review, 'Response added successfully'));
});

// @desc    Mark review as helpful
// @route   POST /api/v1/reviews/:id/helpful
// @access  Private
exports.markHelpful = catchAsync(async (req, res, next) => {
  const review = await Review.findById(req.params.id);

  if (!review) {
    return next(new ApiError('Review not found', 404));
  }

  const added = await review.addHelpfulVote(req.user._id);

  if (!added) {
    return next(new ApiError('You have already marked this review as helpful', 400));
  }

  res.json(ApiResponse.success({ helpfulCount: review.helpfulCount }, 'Marked as helpful'));
});

// @desc    Remove helpful vote
// @route   DELETE /api/v1/reviews/:id/helpful
// @access  Private
exports.removeHelpful = catchAsync(async (req, res, next) => {
  const review = await Review.findById(req.params.id);

  if (!review) {
    return next(new ApiError('Review not found', 404));
  }

  const removed = await review.removeHelpfulVote(req.user._id);

  if (!removed) {
    return next(new ApiError('You have not marked this review as helpful', 400));
  }

  res.json(ApiResponse.success({ helpfulCount: review.helpfulCount }, 'Helpful vote removed'));
});

// @desc    Flag review
// @route   POST /api/v1/reviews/:id/flag
// @access  Private
exports.flagReview = catchAsync(async (req, res, next) => {
  const { reason } = req.body;

  const review = await Review.findById(req.params.id);

  if (!review) {
    return next(new ApiError('Review not found', 404));
  }

  review.isFlagged = true;
  review.flagReason = reason;
  await review.save();

  // TODO: Notify admin about flagged review

  res.json(ApiResponse.success(null, 'Review flagged for moderation'));
});

// @desc    Report review
// @route   POST /api/v1/reviews/:id/report
// @access  Private
exports.reportReview = catchAsync(async (req, res, next) => {
  const { reason } = req.body;

  if (!reason) {
    return next(new ApiError('Report reason is required', 400));
  }

  const review = await Review.findById(req.params.id);

  if (!review) {
    return next(new ApiError('Review not found', 404));
  }

  // Check if user already reported this review
  const alreadyReported = review.reports && review.reports.some(
    report => report.reportedBy.toString() === req.user._id.toString()
  );

  if (alreadyReported) {
    return next(new ApiError('You have already reported this review', 400));
  }

  // Add report
  if (!review.reports) review.reports = [];
  review.reports.push({
    reportedBy: req.user._id,
    reason,
    createdAt: new Date()
  });

  // Auto-flag if multiple reports
  if (review.reports.length >= 3) {
    review.isFlagged = true;
    review.flagReason = 'Multiple user reports';
  }

  await review.save();

  // TODO: Notify admin about reported review

  res.json(ApiResponse.success(null, 'Review reported successfully'));
});

// @desc    Get my reviews
// @route   GET /api/v1/reviews/my-reviews
// @access  Private
exports.getMyReviews = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 20 } = req.query;

  const reviews = await Review.find({ reviewer: req.user._id })
    .populate('service', 'serviceName coverImage')
    .populate('vendor', 'name profilePhoto')
    .sort('-createdAt')
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

  const total = await Review.countDocuments({ reviewer: req.user._id });

  res.json(
    ApiResponse.paginated(reviews, page, limit, total, 'Your reviews retrieved')
  );
});

// @desc    Get review stats for service
// @route   GET /api/v1/reviews/service/:serviceId/stats
// @access  Public
exports.getServiceReviewStats = catchAsync(async (req, res, next) => {
  const stats = await Review.aggregate([
    { $match: { service: require('mongoose').Types.ObjectId(req.params.serviceId), isApproved: true } },
    {
      $group: {
        _id: null,
        averageRating: { $avg: '$rating' },
        totalReviews: { $sum: 1 },
        avgQuality: { $avg: '$ratings.quality' },
        avgPunctuality: { $avg: '$ratings.punctuality' },
        avgProfessionalism: { $avg: '$ratings.professionalism' },
        avgValueForMoney: { $avg: '$ratings.valueForMoney' }
      }
    }
  ]);

  // Rating distribution
  const distribution = await Review.aggregate([
    { $match: { service: require('mongoose').Types.ObjectId(req.params.serviceId), isApproved: true } },
    {
      $group: {
        _id: '$rating',
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: -1 } }
  ]);

  res.json(
    ApiResponse.success(
      { summary: stats[0] || {}, distribution },
      'Review stats retrieved'
    )
  );
});

// @desc    Approve/Reject review (admin)
// @route   PUT /api/v1/reviews/:id/moderate
// @access  Private/Admin
exports.moderateReview = catchAsync(async (req, res, next) => {
  const { isApproved, reason } = req.body;

  const review = await Review.findByIdAndUpdate(
    req.params.id,
    { isApproved, isFlagged: false },
    { new: true }
  );

  if (!review) {
    return next(new ApiError('Review not found', 404));
  }

  // Notify reviewer if rejected
  if (!isApproved) {
    await Notification.createNotification({
      recipient: review.reviewer,
      type: 'system',
      title: 'Review Rejected',
      message: reason || 'Your review has been rejected for violating our guidelines',
      actionUrl: '/my-reviews'
    });
  }

  res.json(ApiResponse.success(review, `Review ${isApproved ? 'approved' : 'rejected'}`));
});
