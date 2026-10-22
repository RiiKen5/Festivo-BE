const User = require('../models/User');
const Event = require('../models/Event');
const Service = require('../models/Service');
const Booking = require('../models/Booking');
const Review = require('../models/Review');
const Payment = require('../models/Payment');
const Notification = require('../models/Notification');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const ApiResponse = require('../utils/apiResponse');

const round2 = (n) => Math.round((n || 0) * 100) / 100;

// @desc    Marketplace health and revenue
// @route   GET /api/v1/admin/stats
// @access  Admin
exports.getStats = catchAsync(async (req, res, next) => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const collected = { status: { $in: ['paid', 'partially_refunded', 'refunded'] } };

  const [users, newUsers, vendors, events, bookingsByStatus, money, money30d, payouts, pendingVerification, flaggedReviews] =
    await Promise.all([
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: since } }),
      Service.distinct('provider', { isActive: true }).then(ids => ids.length),
      Event.countDocuments(),
      Booking.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      moneyTotals(collected),
      moneyTotals({ ...collected, paidAt: { $gte: since } }),
      Payment.aggregate([
        { $match: { payoutStatus: 'pending' } },
        { $group: { _id: null, amount: { $sum: '$payeeAmount' }, count: { $sum: 1 } } }
      ]),
      Service.countDocuments({ isVerified: false, isActive: true }),
      Review.countDocuments({ $or: [{ isFlagged: true }, { 'reports.0': { $exists: true } }], isApproved: true })
    ]);

  res.json(ApiResponse.success({
    users: { total: users, last30Days: newUsers },
    vendors,
    events,
    bookings: Object.fromEntries(bookingsByStatus.map(b => [b._id, b.count])),
    money: { allTime: money, last30Days: money30d },
    payoutsDue: { amount: round2(payouts[0] && payouts[0].amount), count: (payouts[0] && payouts[0].count) || 0 },
    pendingVerification,
    flaggedReviews
  }, 'Admin stats retrieved'));
});

// GMV collected online, refunds, and platform revenue for matching payments
const moneyTotals = async (match) => {
  const [row] = await Payment.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        collected: { $sum: '$amount' },
        refunded: { $sum: '$refundedAmount' },
        platformRevenue: { $sum: '$platformFee' }
      }
    }
  ]);
  return {
    collected: round2(row && row.collected),
    refunded: round2(row && row.refunded),
    platformRevenue: round2(row && row.platformRevenue)
  };
};

// @desc    Payouts by status (default: due now)
// @route   GET /api/v1/admin/payouts?status=pending
// @access  Admin
exports.getPayouts = catchAsync(async (req, res, next) => {
  const { status = 'pending', page = 1, limit = 50 } = req.query;
  const query = { payoutStatus: status, status: { $in: ['paid', 'partially_refunded', 'refunded'] } };

  const [payments, total] = await Promise.all([
    Payment.find(query)
      .populate('payee', 'name email phone +payoutDetails')
      .populate('event', 'title date')
      .sort('createdAt')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean(),
    Payment.countDocuments(query)
  ]);

  res.json(ApiResponse.paginated(payments, page, limit, total, 'Payouts retrieved'));
});

// @desc    Record that a payout was sent (UPI/bank transfer done outside the app)
// @route   POST /api/v1/admin/payouts/:id/mark-paid
// @access  Admin
exports.markPayoutPaid = catchAsync(async (req, res, next) => {
  const { reference } = req.body;
  if (!reference) {
    return next(new ApiError('Transfer reference (UTR) is required', 400));
  }

  const payment = await Payment.findOneAndUpdate(
    { _id: req.params.id, payoutStatus: 'pending' },
    { payoutStatus: 'paid', payoutReference: reference, paidOutAt: new Date(), paidOutBy: req.user._id },
    { new: true }
  );

  if (!payment) {
    return next(new ApiError('No pending payout found', 404));
  }

  await Notification.createNotification({
    recipient: payment.payee,
    type: 'payment',
    title: 'Payout Sent',
    message: `₹${payment.payeeAmount} has been sent to your account (ref ${reference})`,
    relatedBooking: payment.booking,
    relatedEvent: payment.event,
    actionUrl: '/dashboard'
  });

  res.json(ApiResponse.success(payment, 'Payout marked as paid'));
});

// @desc    Services awaiting verification
// @route   GET /api/v1/admin/services/unverified
// @access  Admin
exports.getUnverifiedServices = catchAsync(async (req, res, next) => {
  const services = await Service.find({ isVerified: false, isActive: true })
    .populate('provider', 'name email phone phoneVerified createdAt')
    .sort('createdAt')
    .limit(100)
    .lean();

  res.json(ApiResponse.success(services, 'Unverified services retrieved'));
});

// @desc    Reviews flagged or reported by users
// @route   GET /api/v1/admin/reviews/flagged
// @access  Admin
exports.getFlaggedReviews = catchAsync(async (req, res, next) => {
  const reviews = await Review.find({
    $or: [{ isFlagged: true }, { 'reports.0': { $exists: true } }],
    isApproved: true
  })
    .populate('reviewer', 'name email')
    .populate('service', 'serviceName')
    .sort('-updatedAt')
    .limit(100)
    .lean();

  res.json(ApiResponse.success(reviews, 'Flagged reviews retrieved'));
});
