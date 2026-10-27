const RSVP = require('../models/RSVP');
const Event = require('../models/Event');
const User = require('../models/User');
const Notification = require('../models/Notification');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const ApiResponse = require('../utils/apiResponse');
const { canAccessEvent } = require('../utils/eventAccess');
const checkoutService = require('../services/checkoutService');
const policies = require('../config/policies');

// @desc    Get RSVPs for an event
// @route   GET /api/v1/rsvps/event/:eventId
// @access  Private
exports.getEventRSVPs = catchAsync(async (req, res, next) => {
  const { status } = req.query;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 1000);

  const event = await Event.findById(req.params.eventId);
  if (!event) {
    return next(new ApiError('Event not found', 404));
  }

  // Check authorization
  const isAuthorized =
    event.organizer.toString() === req.user._id.toString() ||
    event.coOrganizers.includes(req.user._id) ||
    req.user.role === 'admin';

  if (!isAuthorized) {
    return next(new ApiError('Not authorized to view RSVPs for this event', 403));
  }

  const query = { event: req.params.eventId };
  if (status) query.status = status;

  // Organizers also see the contact number of guests who RSVPed without an account
  const rsvps = await RSVP.find(query)
    .select('+guestPhone')
    .populate('attendee', 'name profilePhoto email phone')
    .sort('-createdAt')
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

  const total = await RSVP.countDocuments(query);

  res.json(
    ApiResponse.paginated(rsvps, page, limit, total, 'RSVPs retrieved successfully')
  );
});

// @desc    Create/Update RSVP
// @route   POST /api/v1/rsvps
// @access  Private
exports.createRSVP = catchAsync(async (req, res, next) => {
  const { eventId, status = 'going', guestsCount = 0, inviteCode } = req.body;

  const event = await Event.findById(eventId).select('+inviteCode');
  if (!event || !(await canAccessEvent(event, req.user, inviteCode))) {
    return next(new ApiError('Event not found', 404));
  }

  if (['cancelled', 'completed'].includes(event.status) || new Date(event.date) < startOfToday()) {
    return next(new ApiError('This event is no longer accepting RSVPs', 400));
  }

  let rsvp = await RSVP.findOne({ event: eventId, attendee: req.user._id });

  const needsTicket = event.entryFee > 0 && status === 'going';
  if (needsTicket && rsvp && rsvp.paymentStatus === 'paid' && rsvp.status === 'going') {
    return next(new ApiError('You already have a ticket for this event', 400));
  }

  // Capacity counts the attendee plus their guests, excluding any seats
  // this attendee already holds
  if (status === 'going' && event.maxAttendees) {
    const alreadyHeld = rsvp && rsvp.status === 'going' ? 1 + (rsvp.guestsCount || 0) : 0;
    if (event.currentAttendees - alreadyHeld + 1 + guestsCount > event.maxAttendees) {
      return next(new ApiError('Event is at full capacity', 400));
    }
  }

  // Paid events: the seat is confirmed once the ticket payment succeeds
  const savedStatus = needsTicket ? 'pending_payment' : status;

  const isNew = !rsvp;
  if (rsvp) {
    rsvp.status = savedStatus;
    rsvp.guestsCount = guestsCount;
    await rsvp.save();
  } else {
    rsvp = await RSVP.create({
      event: eventId,
      attendee: req.user._id,
      status: savedStatus,
      guestsCount
    });
  }

  if (needsTicket) {
    const checkout = await checkoutService.createTicketOrder(rsvp, event);
    await rsvp.populate('attendee', 'name profilePhoto');
    return res.status(isNew ? 201 : 200).json(
      ApiResponse.success({ rsvp, checkout }, 'Complete payment to confirm your ticket')
    );
  }

  // Notify organizer
  if (isNew && status === 'going') {
    await Notification.createNotification({
      recipient: event.organizer,
      type: 'rsvp',
      title: 'New RSVP',
      message: `${req.user.name} is coming to your event "${event.title}"`,
      relatedEvent: eventId,
      relatedUser: req.user._id,
      actionUrl: `/events/${eventId}`
    });
  }

  await rsvp.populate('attendee', 'name profilePhoto');

  res.status(isNew ? 201 : 200).json(ApiResponse.success(rsvp, 'RSVP saved successfully'));
});

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

// @desc    Get my RSVP for event
// @route   GET /api/v1/rsvps/event/:eventId/my-rsvp
// @access  Private
exports.getMyRSVP = catchAsync(async (req, res, next) => {
  const rsvp = await RSVP.findOne({
    event: req.params.eventId,
    attendee: req.user._id
  });

  if (!rsvp) {
    return res.json(ApiResponse.success(null, 'No RSVP found'));
  }

  res.json(ApiResponse.success(rsvp, 'RSVP retrieved'));
});

// @desc    Update RSVP
// @route   PUT /api/v1/rsvps/:id
// @access  Private
exports.updateRSVP = catchAsync(async (req, res, next) => {
  const { status, guestsCount } = req.body;

  let rsvp = await RSVP.findById(req.params.id);

  if (!rsvp) {
    return next(new ApiError('RSVP not found', 404));
  }

  if (String(rsvp.attendee) !== String(req.user._id)) {
    return next(new ApiError('Not authorized to update this RSVP', 403));
  }

  const event = await Event.findById(rsvp.event);
  if (!event) {
    return next(new ApiError('Event not found', 404));
  }

  const nextStatus = status || rsvp.status;
  const nextGuests = guestsCount !== undefined ? guestsCount : rsvp.guestsCount;

  // Tickets cover a fixed number of people and are bought via POST /rsvps
  if (event.entryFee > 0 &&
      ((nextStatus === 'going' && rsvp.paymentStatus !== 'paid') || nextGuests !== rsvp.guestsCount)) {
    return next(new ApiError('Ticketed RSVPs cannot be changed here. Cancel and buy a new ticket instead.', 400));
  }
  const oldTotal = rsvp.status === 'going' ? 1 + (rsvp.guestsCount || 0) : 0;
  const newTotal = nextStatus === 'going' ? 1 + (nextGuests || 0) : 0;

  // Check capacity if increasing attendees
  if (newTotal > oldTotal && event.maxAttendees &&
      event.currentAttendees - oldTotal + newTotal > event.maxAttendees) {
    return next(new ApiError('Event is at full capacity', 400));
  }

  // Event counts are recalculated by the RSVP save hook
  rsvp.status = nextStatus;
  rsvp.guestsCount = nextGuests;
  await rsvp.save();

  await rsvp.populate('attendee', 'name profilePhoto');

  res.json(ApiResponse.success(rsvp, 'RSVP updated successfully'));
});

// @desc    Cancel RSVP
// @route   DELETE /api/v1/rsvps/:id
// @access  Private
exports.cancelRSVP = catchAsync(async (req, res, next) => {
  const rsvp = await RSVP.findById(req.params.id);

  if (!rsvp) {
    return next(new ApiError('RSVP not found', 404));
  }

  if (String(rsvp.attendee) !== String(req.user._id)) {
    return next(new ApiError('Not authorized', 403));
  }

  let refunded = 0;
  if (rsvp.paymentStatus === 'paid') {
    const event = await Event.findById(rsvp.event);
    refunded = await checkoutService.refundTicket(rsvp, policies.ticketRefundShare(event), 'Attendee cancelled');
  }

  rsvp.status = 'cancelled';
  await rsvp.save();

  res.json(ApiResponse.success(
    { refundIssued: refunded },
    refunded > 0 ? `RSVP cancelled. ₹${refunded} will be refunded.` : 'RSVP cancelled successfully'
  ));
});

// @desc    Check in attendee
// @route   POST /api/v1/rsvps/:id/check-in
// @access  Private
exports.checkInAttendee = catchAsync(async (req, res, next) => {
  const rsvp = await RSVP.findById(req.params.id).populate('event');

  if (!rsvp) {
    return next(new ApiError('RSVP not found', 404));
  }

  // Check authorization (organizer or co-organizer)
  const event = rsvp.event;
  const isAuthorized =
    event.organizer.toString() === req.user._id.toString() ||
    event.coOrganizers?.includes(req.user._id);

  if (!isAuthorized) {
    return next(new ApiError('Not authorized to check in attendees', 403));
  }

  if (rsvp.status !== 'going') {
    return next(new ApiError('This RSVP is not confirmed', 400));
  }

  rsvp.checkedIn = true;
  rsvp.checkedInAt = new Date();
  await rsvp.save();

  res.json(ApiResponse.success(rsvp, 'Attendee checked in successfully'));
});

// @desc    Check in by code
// @route   POST /api/v1/rsvps/check-in-code
// @access  Private
exports.checkInByCode = catchAsync(async (req, res, next) => {
  const { code, eventId } = req.body;

  const event = await Event.findById(eventId);
  if (!event) {
    return next(new ApiError('Event not found', 404));
  }

  // Check authorization
  const isAuthorized =
    event.organizer.toString() === req.user._id.toString() ||
    event.coOrganizers?.includes(req.user._id);

  if (!isAuthorized) {
    return next(new ApiError('Not authorized', 403));
  }

  const rsvp = await RSVP.findOne({
    event: eventId,
    checkInCode: code.toUpperCase()
  }).populate('attendee', 'name profilePhoto');

  if (!rsvp) {
    return next(new ApiError('Invalid check-in code', 404));
  }

  if (rsvp.status !== 'going') {
    return next(new ApiError('This RSVP is not confirmed', 400));
  }

  if (rsvp.checkedIn) {
    return next(new ApiError('Attendee already checked in', 400));
  }

  rsvp.checkedIn = true;
  rsvp.checkedInAt = new Date();
  await rsvp.save();

  res.json(ApiResponse.success(rsvp, 'Attendee checked in successfully'));
});

// @desc    Mark attendee as attended (post-event)
// @route   POST /api/v1/rsvps/:id/attended
// @access  Private
exports.markAttended = catchAsync(async (req, res, next) => {
  const rsvp = await RSVP.findById(req.params.id).populate('event');

  if (!rsvp) {
    return next(new ApiError('RSVP not found', 404));
  }

  // Only organizer can mark attendance
  if (rsvp.event.organizer.toString() !== req.user._id.toString()) {
    return next(new ApiError('Not authorized', 403));
  }

  rsvp.attended = true;
  await rsvp.save();

  // User stats are updated via model hook

  res.json(ApiResponse.success(rsvp, 'Attendance marked successfully'));
});

// @desc    Submit event rating
// @route   POST /api/v1/rsvps/:id/rate
// @access  Private
exports.rateEvent = catchAsync(async (req, res, next) => {
  const { rating, review } = req.body;

  const rsvp = await RSVP.findById(req.params.id).populate('event');

  if (!rsvp) {
    return next(new ApiError('RSVP not found', 404));
  }

  if (String(rsvp.attendee) !== String(req.user._id)) {
    return next(new ApiError('Not authorized', 403));
  }

  // Check if event has passed
  if (new Date(rsvp.event.date) > new Date()) {
    return next(new ApiError('Cannot rate an event that has not happened yet', 400));
  }

  rsvp.eventRating = rating;
  rsvp.eventReview = review;
  await rsvp.save();

  // Update event overall rating
  const ratings = await RSVP.aggregate([
    { $match: { event: rsvp.event._id, eventRating: { $exists: true } } },
    {
      $group: {
        _id: null,
        avgRating: { $avg: '$eventRating' },
        totalReviews: { $sum: 1 }
      }
    }
  ]);

  if (ratings.length > 0) {
    await Event.findByIdAndUpdate(rsvp.event._id, {
      overallRating: Math.round(ratings[0].avgRating * 10) / 10,
      totalReviews: ratings[0].totalReviews
    });
  }

  res.json(ApiResponse.success(rsvp, 'Rating submitted successfully'));
});

// @desc    Get my RSVPs
// @route   GET /api/v1/rsvps/my-rsvps
// @access  Private
exports.getMyRSVPs = catchAsync(async (req, res, next) => {
  const { status, upcoming = 'true', page = 1, limit = 20 } = req.query;

  const query = { attendee: req.user._id, status: status || { $ne: 'cancelled' } };

  const rsvps = await RSVP.find(query)
    .populate({
      path: 'event',
      select: 'title slug date time city locationName coverPhoto status entryFee',
      match: upcoming === 'true' ? { date: { $gte: startOfToday() } } : {}
    })
    .lean();

  // Drop RSVPs whose event didn't match, then order by event date
  // (sorting on a populated field can't happen in the query)
  const sorted = rsvps
    .filter(rsvp => rsvp.event !== null)
    .sort((a, b) => (new Date(a.event.date) - new Date(b.event.date)) * (upcoming === 'true' ? 1 : -1));
  const pageItems = sorted.slice((page - 1) * limit, page * limit);

  res.json(
    ApiResponse.paginated(pageItems, page, limit, sorted.length, 'Your RSVPs retrieved')
  );
});

// @desc    Get RSVP stats for event
// @route   GET /api/v1/rsvps/event/:eventId/stats
// @access  Private
exports.getRSVPStats = catchAsync(async (req, res, next) => {
  const event = await Event.findById(req.params.eventId);
  if (!event) {
    return next(new ApiError('Event not found', 404));
  }

  // Check authorization
  if (event.organizer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    return next(new ApiError('Not authorized', 403));
  }

  const stats = await RSVP.aggregate([
    { $match: { event: event._id } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalGuests: { $sum: '$guestsCount' }
      }
    }
  ]);

  const checkedInCount = await RSVP.countDocuments({
    event: event._id,
    checkedIn: true
  });

  res.json(
    ApiResponse.success(
      { byStatus: stats, checkedIn: checkedInCount },
      'RSVP stats retrieved'
    )
  );
});

const crypto = require('crypto');
const { hashToken } = require('../utils/helpers');

// What a guest without an account is shown about their own RSVP
const guestView = (rsvp) => ({
  _id: rsvp._id,
  event: rsvp.event,
  guestName: rsvp.guestName,
  status: rsvp.status,
  guestsCount: rsvp.guestsCount,
  paymentStatus: rsvp.paymentStatus,
  amountPaid: rsvp.amountPaid,
  checkInCode: rsvp.status === 'going' ? rsvp.checkInCode : undefined
});

// Indian mobile numbers, with or without +91 / spaces
const normalisePhone = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const digits = String(value).replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(digits) ? digits : undefined;
};

// @desc    RSVP without an account (free events, from the invite link)
// @route   POST /api/v1/rsvps/guest
// @access  Public (rate limited)
exports.createGuestRSVP = catchAsync(async (req, res, next) => {
  const { eventId, inviteCode, guestToken } = req.body;
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const status = req.body.status || 'going';
  const guestsCount = Number(req.body.guestsCount || 0);
  const phone = normalisePhone(req.body.phone);

  if (name.length < 2 || name.length > 80) return next(new ApiError('Please enter your name', 400));
  if (!['going', 'maybe', 'not_going'].includes(status)) return next(new ApiError('Invalid response', 400));
  if (!Number.isInteger(guestsCount) || guestsCount < 0 || guestsCount > 10) {
    return next(new ApiError('You can bring up to 10 people', 400));
  }
  if (phone === undefined) return next(new ApiError('Please enter a valid 10-digit mobile number, or leave it empty', 400));
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return next(new ApiError('Please enter a valid email, or leave it empty', 400));
  if (!require('mongoose').isValidObjectId(eventId)) return next(new ApiError('Event not found', 404));

  const event = await Event.findById(eventId).select('+inviteCode');
  if (!event || !(await canAccessEvent(event, null, inviteCode))) {
    return next(new ApiError('Event not found', 404));
  }
  if (['cancelled', 'completed'].includes(event.status) || new Date(event.date) < startOfToday()) {
    return next(new ApiError('This event is no longer accepting RSVPs', 400));
  }
  // Tickets are bought without an account too; the phone number is how the
  // host and Festivo reach the buyer about refunds
  const needsTicket = event.entryFee > 0 && status === 'going';

  // The same guest changing their answer: by their private token, else by phone
  let rsvp = null;
  if (typeof guestToken === 'string' && guestToken) {
    rsvp = await RSVP.findOne({ event: eventId, guestTokenHash: hashToken(guestToken) }).select('+guestPhone');
  }
  // A guest finishing an unpaid ticket already gave their number
  if (needsTicket && !phone && !(rsvp && rsvp.guestPhone)) {
    return next(new ApiError('Please enter your mobile number to buy a ticket', 400));
  }
  const foundByToken = !!rsvp;
  if (!rsvp && phone) {
    rsvp = await RSVP.findOne({ event: eventId, guestPhone: phone, attendee: { $exists: false } });
  }

  // A bought ticket covers a fixed number of people; cancel it to change
  if (rsvp && rsvp.paymentStatus === 'paid' && rsvp.status === 'going') {
    return next(new ApiError(needsTicket && guestsCount === rsvp.guestsCount
      ? 'You already have a ticket for this event'
      : 'You have a ticket for this event. Cancel it first to change your answer.', 400));
  }

  if (status === 'going' && event.maxAttendees) {
    const alreadyHeld = rsvp && rsvp.status === 'going' ? 1 + (rsvp.guestsCount || 0) : 0;
    if (event.currentAttendees - alreadyHeld + 1 + guestsCount > event.maxAttendees) {
      return next(new ApiError('Event is at full capacity', 400));
    }
  }

  // A fresh token each time the guest is identified by phone, so only the
  // latest device can change the answer
  const token = foundByToken ? guestToken : crypto.randomBytes(24).toString('base64url');
  const savedStatus = needsTicket ? 'pending_payment' : status;
  const isNew = !rsvp;
  if (rsvp) {
    rsvp.guestName = name;
    rsvp.status = savedStatus;
    rsvp.guestsCount = guestsCount;
    if (phone) rsvp.guestPhone = phone;
    if (email) rsvp.guestEmail = email;
    rsvp.guestTokenHash = hashToken(token);
    await rsvp.save();
  } else {
    rsvp = await RSVP.create({
      event: eventId,
      guestName: name,
      guestPhone: phone || undefined,
      guestEmail: email || undefined,
      guestTokenHash: hashToken(token),
      status: savedStatus,
      guestsCount
    });
  }

  if (needsTicket) {
    const checkout = await checkoutService.createTicketOrder(rsvp, event);
    return res.status(isNew ? 201 : 200).json(ApiResponse.success(
      { rsvp: guestView(rsvp), guestToken: token, checkout },
      'Complete payment to confirm your ticket'
    ));
  }

  if (email && status === 'going') {
    emailGuestTicket({ email, name, event, rsvp, token, paid: false });
  }

  if (isNew && status === 'going') {
    await Notification.createNotification({
      recipient: event.organizer,
      type: 'rsvp',
      title: 'New RSVP',
      message: `${name}${guestsCount ? ` (+${guestsCount})` : ''} is coming to "${event.title}"`,
      relatedEvent: eventId,
      actionUrl: `/events/${eventId}`
    });
  }

  res.status(isNew ? 201 : 200).json(ApiResponse.success({ rsvp: guestView(rsvp), guestToken: token }, 'RSVP saved'));
});

// A private link that brings a guest's RSVP back on any device
const guestLink = (event, token) => {
  const { frontendUrl } = require('../config/frontend');
  const invite = !event.isPublic && event.inviteCode ? `&invite=${encodeURIComponent(event.inviteCode)}` : '';
  return `${frontendUrl()}/events/${event.slug}?guest=${encodeURIComponent(token)}${invite}`;
};

// Sent in the background; a slow mail server never holds up the RSVP
const emailGuestTicket = ({ email, name, event, rsvp, token, paid }) => {
  setImmediate(() => {
    require('../services/emailService').sendGuestTicket({
      to: email, name, event, checkInCode: rsvp.checkInCode, paid, link: guestLink(event, token)
    }).catch(error => console.error('Could not email guest ticket:', error.message));
  });
};
exports.emailGuestTicket = emailGuestTicket;

// @desc    A guest's own RSVP, from their private token
// @route   GET /api/v1/rsvps/guest?token=
// @access  Public
exports.getGuestRSVP = catchAsync(async (req, res, next) => {
  const { token } = req.query;
  if (typeof token !== 'string' || token.length < 20) return next(new ApiError('RSVP not found', 404));
  const rsvp = await RSVP.findOne({ guestTokenHash: hashToken(token) });
  if (!rsvp) return next(new ApiError('RSVP not found', 404));
  res.json(ApiResponse.success(guestView(rsvp), 'RSVP retrieved'));
});

// @desc    A guest cancels their own RSVP or ticket, from their private token
// @route   POST /api/v1/rsvps/guest/cancel
// @access  Public (rate limited)
exports.cancelGuestRSVP = catchAsync(async (req, res, next) => {
  const { token } = req.body;
  if (typeof token !== 'string' || token.length < 20) return next(new ApiError('RSVP not found', 404));
  const rsvp = await RSVP.findOne({ guestTokenHash: hashToken(token) });
  if (!rsvp) return next(new ApiError('RSVP not found', 404));
  if (rsvp.status === 'cancelled') return next(new ApiError('This RSVP is already cancelled', 400));

  let refunded = 0;
  if (rsvp.paymentStatus === 'paid') {
    const event = await Event.findById(rsvp.event);
    refunded = await checkoutService.refundTicket(rsvp, policies.ticketRefundShare(event), 'Guest cancelled');
  }

  rsvp.status = 'cancelled';
  await rsvp.save();

  res.json(ApiResponse.success(
    { rsvp: guestView(rsvp), refundIssued: refunded },
    refunded > 0 ? `Cancelled. ₹${refunded} will be refunded to how you paid.` : 'Your RSVP is cancelled'
  ));
});
