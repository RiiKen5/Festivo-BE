const Booking = require('../models/Booking');
const Event = require('../models/Event');
const Service = require('../models/Service');
const Notification = require('../models/Notification');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const ApiResponse = require('../utils/apiResponse');

// @desc    Get all bookings (with filters)
// @route   GET /api/v1/bookings
// @access  Private
exports.getBookings = catchAsync(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    status,
    paymentStatus,
    role, // 'organizer' or 'vendor'
    sort = '-createdAt'
  } = req.query;

  // Build query based on user role in bookings
  const query = {};

  if (role === 'vendor') {
    query.vendor = req.user._id;
  } else if (role === 'organizer') {
    query.organizer = req.user._id;
  } else {
    // Get all bookings where user is either organizer or vendor
    query.$or = [
      { organizer: req.user._id },
      { vendor: req.user._id }
    ];
  }

  if (status) query.status = status;
  if (paymentStatus) query.paymentStatus = paymentStatus;

  const bookings = await Booking.find(query)
    .populate('event', 'title date city coverPhoto')
    .populate('service', 'serviceName category basePrice coverImage')
    .populate('organizer', 'name profilePhoto')
    .populate('vendor', 'name profilePhoto')
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

  const total = await Booking.countDocuments(query);

  res.json(
    ApiResponse.paginated(bookings, page, limit, total, 'Bookings retrieved successfully')
  );
});

// @desc    Get single booking
// @route   GET /api/v1/bookings/:id
// @access  Private
exports.getBooking = catchAsync(async (req, res, next) => {
  const booking = await Booking.findById(req.params.id)
    .populate('event', 'title date time city address coverPhoto organizer')
    .populate('service', 'serviceName category basePrice priceUnit coverImage provider')
    .populate('organizer', 'name email phone profilePhoto')
    .populate('vendor', 'name email phone profilePhoto');

  if (!booking) {
    return next(new ApiError('Booking not found', 404));
  }

  // Check if user is part of booking
  if (
    booking.organizer._id.toString() !== req.user._id.toString() &&
    booking.vendor._id.toString() !== req.user._id.toString() &&
    req.user.role !== 'admin'
  ) {
    return next(new ApiError('Not authorized to view this booking', 403));
  }

  res.json(ApiResponse.success(booking, 'Booking retrieved successfully'));
});

// @desc    Create booking
// @route   POST /api/v1/bookings
// @access  Private
exports.createBooking = catchAsync(async (req, res, next) => {
  const { eventId, serviceId, eventDate, priceAgreed, notes, requirements } = req.body;

  // Get event and service
  const event = await Event.findById(eventId);
  if (!event) {
    return next(new ApiError('Event not found', 404));
  }

  const service = await Service.findById(serviceId);
  if (!service) {
    return next(new ApiError('Service not found', 404));
  }

  // Check if user owns the event
  if (event.organizer.toString() !== req.user._id.toString()) {
    return next(new ApiError('You can only create bookings for your own events', 403));
  }

  // Check if service is available
  if (service.availability === 'not_taking_orders') {
    return next(new ApiError('This service is not accepting bookings', 400));
  }

  // Check for existing booking
  const existingBooking = await Booking.findOne({
    event: eventId,
    service: serviceId,
    status: { $nin: ['cancelled', 'refunded'] }
  });

  if (existingBooking) {
    return next(new ApiError('A booking already exists for this service and event', 400));
  }

  const booking = await Booking.create({
    event: eventId,
    service: serviceId,
    organizer: req.user._id,
    vendor: service.provider,
    eventDate: eventDate || event.date,
    priceAgreed,
    notes,
    requirements
  });

  // Notify vendor
  await Notification.createNotification({
    recipient: service.provider,
    type: 'booking',
    title: 'New Booking Request',
    message: `You have a new booking request for ${service.serviceName}`,
    relatedBooking: booking._id,
    relatedEvent: eventId,
    actionUrl: `/bookings/${booking._id}`
  });

  // Populate and return
  await booking.populate([
    { path: 'event', select: 'title date city' },
    { path: 'service', select: 'serviceName category' },
    { path: 'vendor', select: 'name profilePhoto' }
  ]);

  res.status(201).json(ApiResponse.success(booking, 'Booking created successfully'));
});

// @desc    Update booking
// @route   PUT /api/v1/bookings/:id
// @access  Private
exports.updateBooking = catchAsync(async (req, res, next) => {
  const { priceAgreed, notes, requirements } = req.body;

  let booking = await Booking.findById(req.params.id);

  if (!booking) {
    return next(new ApiError('Booking not found', 404));
  }

  // Only organizer can update
  if (booking.organizer.toString() !== req.user._id.toString()) {
    return next(new ApiError('Not authorized', 403));
  }

  // Can only update pending bookings
  if (booking.status !== 'pending') {
    return next(new ApiError('Cannot update booking that is not pending', 400));
  }

  booking = await Booking.findByIdAndUpdate(
    req.params.id,
    { priceAgreed, notes, requirements },
    { new: true, runValidators: true }
  );

  res.json(ApiResponse.success(booking, 'Booking updated successfully'));
});

// @desc    Confirm booking (vendor)
// @route   POST /api/v1/bookings/:id/confirm
// @access  Private
exports.confirmBooking = catchAsync(async (req, res, next) => {
  const booking = await Booking.findById(req.params.id);

  if (!booking) {
    return next(new ApiError('Booking not found', 404));
  }

  if (booking.vendor.toString() !== req.user._id.toString()) {
    return next(new ApiError('Only vendor can confirm booking', 403));
  }

  if (booking.status !== 'pending') {
    return next(new ApiError('Booking is not pending', 400));
  }

  booking.status = 'confirmed';
  await booking.save();

  // Notify organizer
  await Notification.createNotification({
    recipient: booking.organizer,
    type: 'booking',
    title: 'Booking Confirmed',
    message: 'Your booking has been confirmed by the vendor',
    relatedBooking: booking._id,
    actionUrl: `/bookings/${booking._id}`
  });

  res.json(ApiResponse.success(booking, 'Booking confirmed successfully'));
});

// @desc    Cancel booking
// @route   POST /api/v1/bookings/:id/cancel
// @access  Private
exports.cancelBooking = catchAsync(async (req, res, next) => {
  const { reason } = req.body;
  const booking = await Booking.findById(req.params.id);

  if (!booking) {
    return next(new ApiError('Booking not found', 404));
  }

  // Check if user can cancel
  if (
    booking.organizer.toString() !== req.user._id.toString() &&
    booking.vendor.toString() !== req.user._id.toString()
  ) {
    return next(new ApiError('Not authorized', 403));
  }

  // Can't cancel completed bookings
  if (booking.status === 'completed') {
    return next(new ApiError('Cannot cancel completed booking', 400));
  }

  booking.status = 'cancelled';
  booking.cancellationReason = reason;
  booking.cancelledBy = req.user._id;
  booking.cancelledAt = new Date();
  await booking.save();

  // Notify the other party
  const notifyUser = booking.organizer.toString() === req.user._id.toString()
    ? booking.vendor
    : booking.organizer;

  await Notification.createNotification({
    recipient: notifyUser,
    type: 'booking',
    title: 'Booking Cancelled',
    message: `A booking has been cancelled. Reason: ${reason || 'No reason provided'}`,
    relatedBooking: booking._id,
    actionUrl: `/bookings/${booking._id}`
  });

  res.json(ApiResponse.success(booking, 'Booking cancelled successfully'));
});

// @desc    Complete booking
// @route   POST /api/v1/bookings/:id/complete
// @access  Private
exports.completeBooking = catchAsync(async (req, res, next) => {
  const booking = await Booking.findById(req.params.id);

  if (!booking) {
    return next(new ApiError('Booking not found', 404));
  }

  // Only organizer can mark as complete
  if (booking.organizer.toString() !== req.user._id.toString()) {
    return next(new ApiError('Only organizer can mark booking as complete', 403));
  }

  if (booking.status !== 'confirmed' && booking.status !== 'in_progress') {
    return next(new ApiError('Booking must be confirmed or in progress to complete', 400));
  }

  booking.status = 'completed';
  booking.completedAt = new Date();
  await booking.save();

  // Notify vendor
  await Notification.createNotification({
    recipient: booking.vendor,
    type: 'booking',
    title: 'Booking Completed',
    message: 'Your booking has been marked as completed',
    relatedBooking: booking._id,
    actionUrl: `/bookings/${booking._id}`
  });

  res.json(ApiResponse.success(booking, 'Booking completed successfully'));
});

// @desc    Update payment status (organizer)
// @route   POST /api/v1/bookings/:id/payment
// @access  Private
exports.updatePayment = catchAsync(async (req, res, next) => {
  const { amount, paymentMethod, transactionId, notes } = req.body;
  const booking = await Booking.findById(req.params.id);

  if (!booking) {
    return next(new ApiError('Booking not found', 404));
  }

  // Only organizer can update payment
  if (booking.organizer.toString() !== req.user._id.toString()) {
    return next(new ApiError('Only organizer can update payment', 403));
  }

  // Add payment record to payments array
  if (!booking.payments) booking.payments = [];
  booking.payments.push({
    amount,
    paymentMethod,
    transactionId,
    paidAt: new Date(),
    notes
  });

  // Calculate total paid from payments array
  booking.totalPaid = booking.payments.reduce((sum, p) => sum + p.amount, 0);
  booking.pricePaid = booking.totalPaid;
  booking.paymentMethod = paymentMethod;
  if (transactionId) booking.transactionId = transactionId;

  // Update payment status
  if (booking.totalPaid >= booking.priceAgreed) {
    booking.paymentStatus = 'paid';
  } else if (booking.totalPaid > 0) {
    booking.paymentStatus = 'partial';
  }

  await booking.save();

  // Notify vendor
  await Notification.createNotification({
    recipient: booking.vendor,
    type: 'payment',
    title: 'Payment Received',
    message: `Payment of ₹${amount} received for booking`,
    relatedBooking: booking._id,
    actionUrl: `/bookings/${booking._id}`
  });

  res.json(ApiResponse.success(booking, 'Payment updated successfully'));
});

// @desc    Record payment (vendor)
// @route   PUT /api/v1/bookings/:id/record-payment
// @access  Private (Vendor only)
exports.recordPayment = catchAsync(async (req, res, next) => {
  const { amount, paymentMethod, transactionId, notes } = req.body;

  if (!amount || amount <= 0) {
    return next(new ApiError('Valid payment amount is required', 400));
  }

  const booking = await Booking.findById(req.params.id).populate('service');

  if (!booking) {
    return next(new ApiError('Booking not found', 404));
  }

  // Verify vendor owns the service
  if (booking.vendor.toString() !== req.user._id.toString()) {
    return next(new ApiError('Not authorized - only the vendor can record payments', 403));
  }

  // Add payment record to payments array
  if (!booking.payments) booking.payments = [];
  booking.payments.push({
    amount,
    paymentMethod: paymentMethod || 'other',
    transactionId,
    paidAt: new Date(),
    notes
  });

  // Calculate total paid from payments array
  booking.totalPaid = booking.payments.reduce((sum, p) => sum + p.amount, 0);
  booking.pricePaid = booking.totalPaid;

  // Update payment status
  if (booking.totalPaid >= booking.priceAgreed) {
    booking.paymentStatus = 'paid';
  } else if (booking.totalPaid > 0) {
    booking.paymentStatus = 'partial';
  }

  await booking.save();

  // Notify organizer
  await Notification.createNotification({
    recipient: booking.organizer,
    type: 'payment',
    title: 'Payment Recorded',
    message: `Vendor recorded a payment of ₹${amount} for your booking`,
    relatedBooking: booking._id,
    actionUrl: `/bookings/${booking._id}`
  });

  res.json(ApiResponse.success(booking, 'Payment recorded successfully'));
});

// @desc    Get bookings for event
// @route   GET /api/v1/bookings/event/:eventId
// @access  Private
exports.getEventBookings = catchAsync(async (req, res, next) => {
  const event = await Event.findById(req.params.eventId);

  if (!event) {
    return next(new ApiError('Event not found', 404));
  }

  // Check ownership
  if (event.organizer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    return next(new ApiError('Not authorized', 403));
  }

  const bookings = await Booking.find({ event: req.params.eventId })
    .populate('service', 'serviceName category basePrice coverImage')
    .populate('vendor', 'name profilePhoto ratingAverage')
    .sort('-createdAt')
    .lean();

  res.json(ApiResponse.success(bookings, 'Event bookings retrieved'));
});

// @desc    Get vendor's upcoming bookings
// @route   GET /api/v1/bookings/vendor/upcoming
// @access  Private
exports.getVendorUpcomingBookings = catchAsync(async (req, res, next) => {
  const bookings = await Booking.find({
    vendor: req.user._id,
    status: { $in: ['pending', 'confirmed'] },
    eventDate: { $gte: new Date() }
  })
    .populate('event', 'title date city')
    .populate('service', 'serviceName')
    .populate('organizer', 'name phone')
    .sort('eventDate')
    .lean();

  res.json(ApiResponse.success(bookings, 'Upcoming bookings retrieved'));
});

// @desc    Get booking stats
// @route   GET /api/v1/bookings/stats
// @access  Private
exports.getBookingStats = catchAsync(async (req, res, next) => {
  const { role = 'organizer' } = req.query;

  const matchField = role === 'vendor' ? 'vendor' : 'organizer';

  const stats = await Booking.aggregate([
    { $match: { [matchField]: req.user._id } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalValue: { $sum: '$priceAgreed' },
        totalPaid: { $sum: '$pricePaid' }
      }
    }
  ]);

  // Format stats
  const formattedStats = {
    pending: { count: 0, totalValue: 0, totalPaid: 0 },
    confirmed: { count: 0, totalValue: 0, totalPaid: 0 },
    completed: { count: 0, totalValue: 0, totalPaid: 0 },
    cancelled: { count: 0, totalValue: 0, totalPaid: 0 }
  };

  stats.forEach(stat => {
    formattedStats[stat._id] = {
      count: stat.count,
      totalValue: stat.totalValue,
      totalPaid: stat.totalPaid
    };
  });

  res.json(ApiResponse.success(formattedStats, 'Booking stats retrieved'));
});
