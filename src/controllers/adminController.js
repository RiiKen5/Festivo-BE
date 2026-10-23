const User = require('../models/User');
const Event = require('../models/Event');
const Service = require('../models/Service');
const Booking = require('../models/Booking');
const Review = require('../models/Review');
const Payment = require('../models/Payment');
const Notification = require('../models/Notification');
const RSVP = require('../models/RSVP');
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

// @desc    Where signups come from and how far each side gets in the funnel
// @route   GET /api/v1/admin/growth?days=30
// @access  Admin
exports.getGrowth = catchAsync(async (req, res, next) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const inWindow = { createdAt: { $gte: since } };
  const collected = { $in: ['paid', 'partially_refunded', 'refunded'] };
  const accepted = { $in: ['confirmed', 'in_progress', 'completed'] };

  const signups = await User.find({ ...inWindow, role: 'user' }).select('+acquisition').lean();
  const ids = signups.map(u => u._id);

  // Which of the new users reached each activation event
  const [requesters, listers, hosts, paidBookings, bookingRequests, confirmedVendors, activeVendors,
    eventsCreated, eventsWithGuests, northStar] = await Promise.all([
    Booking.distinct('organizer', { organizer: { $in: ids } }),
    Service.distinct('provider', { provider: { $in: ids } }),
    Event.distinct('organizer', { organizer: { $in: ids } }),
    Payment.countDocuments({ type: 'booking', status: collected, paidAt: { $gte: since } }),
    Booking.countDocuments(inWindow),
    Booking.distinct('vendor', { status: accepted }).then(v => v.length),
    Service.distinct('provider', { isActive: true }).then(v => v.length),
    Event.countDocuments(inWindow),
    RSVP.aggregate([
      { $match: { status: 'going' } },
      { $group: { _id: '$event', count: { $sum: 1 } } },
      { $match: { count: { $gte: 3 } } },
      { $lookup: { from: 'events', localField: '_id', foreignField: '_id', as: 'event' } },
      { $match: { 'event.createdAt': { $gte: since } } },
      { $count: 'n' }
    ]).then(r => (r[0] && r[0].n) || 0),
    Payment.aggregate([
      { $match: { type: 'booking', status: collected } },
      { $lookup: { from: 'bookings', localField: 'booking', foreignField: '_id', as: 'booking' } },
      { $match: { 'booking.status': 'completed', 'booking.updatedAt': { $gte: since } } },
      { $group: { _id: null, count: { $sum: 1 }, gmv: { $sum: '$amount' } } }
    ])
  ]);

  const sets = { requested: new Set(requesters.map(String)), listed: new Set(listers.map(String)), hosted: new Set(hosts.map(String)) };
  const bySource = {};
  for (const u of signups) {
    const source = (u.acquisition && u.acquisition.source) || 'unknown';
    const row = bySource[source] || (bySource[source] = { source, signups: 0, requestedBooking: 0, listedService: 0, createdEvent: 0, activated: 0 });
    const id = String(u._id);
    row.signups++;
    if (sets.requested.has(id)) row.requestedBooking++;
    if (sets.listed.has(id)) row.listedService++;
    if (sets.hosted.has(id)) row.createdEvent++;
    if (sets.requested.has(id) || sets.listed.has(id) || sets.hosted.has(id)) row.activated++;
  }

  res.json(ApiResponse.success({
    days,
    signups: signups.length,
    bySource: Object.values(bySource).sort((a, b) => b.signups - a.signups),
    funnel: {
      bookingRequests,
      paidBookings,
      completedPaidBookings: (northStar[0] && northStar[0].count) || 0,
      completedPaidGmv: round2(northStar[0] && northStar[0].gmv),
      eventsCreated,
      eventsWithThreeGuests: eventsWithGuests
    },
    supply: { activeVendors, vendorsWithAcceptedBooking: confirmedVendors }
  }, 'Growth metrics retrieved'));
});
