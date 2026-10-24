const { frontendUrl } = require('../config/frontend');
const Event = require('../models/Event');
const User = require('../models/User');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const ApiResponse = require('../utils/apiResponse');
const { clearCache } = require('../middlewares/cache');
const { filterObject } = require('../utils/helpers');
const { canAccessEvent, serializeEvent } = require('../utils/eventAccess');
const { cityMatch } = require('../utils/helpers');

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const Booking = require('../models/Booking');
const RSVP = require('../models/RSVP');
const Notification = require('../models/Notification');
const checkoutService = require('../services/checkoutService');
const bookingService = require('../services/bookingService');
const Task = require('../models/Task');
const Service = require('../models/Service');
const { checklistFor } = require('../config/planTemplates');

// Fields an organizer may change via PUT /events/:id
const UPDATABLE_EVENT_FIELDS = [
  'title', 'description', 'eventType', 'date', 'time', 'endDate', 'timezone',
  'locationName', 'address', 'city', 'expectedGuests', 'maxAttendees',
  'budget', 'isPublic', 'entryFee', 'isPaid', 'coverPhoto', 'photos',
  'tags', 'category', 'vibeScore', 'metaTitle', 'metaDescription'
];

// @desc    Get all events with filters
// @route   GET /api/v1/events
// @access  Public
exports.getEvents = catchAsync(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    city,
    eventType,
    vibeScore,
    isPaid,
    dateFrom,
    dateTo,
    tags,
    sort = 'date',
    search
  } = req.query;

  // Build query
  const query = { isPublic: true, isPublished: true, status: { $ne: 'cancelled' } };

  if (city) query.city = cityMatch(city);
  if (eventType) query.eventType = { $in: eventType.split(',') };
  if (vibeScore) query.vibeScore = vibeScore;
  if (isPaid !== undefined) query.isPaid = isPaid === 'true';
  if (tags) query.tags = { $in: tags.split(',') };

  // Upcoming events only, unless a date range is asked for
  query.date = { $gte: dateFrom ? new Date(dateFrom) : startOfToday() };
  if (dateTo) query.date.$lte = new Date(dateTo);

  // Text search
  if (search) {
    query.$text = { $search: search };
  }

  // Execute query
  const events = await Event.find(query)
    .populate('organizer', 'name profilePhoto ratingAverage')
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

  const total = await Event.countDocuments(query);

  res.json(
    ApiResponse.paginated(events, page, limit, total, 'Events retrieved successfully')
  );
});

// @desc    Get single event
// @route   GET /api/v1/events/:id
// @access  Public
exports.getEvent = catchAsync(async (req, res, next) => {
  const event = await Event.findById(req.params.id)
    .select('+inviteCode')
    .populate('organizer', 'name profilePhoto bio ratingAverage totalRatings eventsOrganized')
    .populate('coOrganizers', 'name profilePhoto');

  await sendEventIfAccessible(event, req, res, next);
});

// Shared by getEvent and getEventBySlug. Inaccessible events are reported
// as not found so private events can't be discovered by guessing IDs.
const sendEventIfAccessible = async (event, req, res, next) => {
  if (!event || !(await canAccessEvent(event, req.user, req.query.invite))) {
    return next(new ApiError('Event not found', 404));
  }

  await Event.updateOne({ _id: event._id }, { $inc: { views: 1 } });

  res.json(ApiResponse.success(serializeEvent(event, req.user), 'Event retrieved successfully'));
};

// @desc    Get event by slug
// @route   GET /api/v1/events/slug/:slug
// @access  Public
exports.getEventBySlug = catchAsync(async (req, res, next) => {
  const event = await Event.findOne({ slug: req.params.slug })
    .select('+inviteCode')
    .populate('organizer', 'name profilePhoto bio ratingAverage totalRatings eventsOrganized')
    .populate('coOrganizers', 'name profilePhoto');

  await sendEventIfAccessible(event, req, res, next);
});

// @desc    Create event
// @route   POST /api/v1/events
// @access  Private
exports.createEvent = catchAsync(async (req, res, next) => {
  const eventData = {
    ...filterObject(req.body, UPDATABLE_EVENT_FIELDS),
    organizer: req.user._id
  };

  // Only set location if coordinates are provided
  if (req.body.coordinates && req.body.coordinates.length === 2) {
    eventData.location = {
      type: 'Point',
      coordinates: req.body.coordinates // [lng, lat]
    };
  }

  const event = await Event.create(eventData);

  // Start the organizer with a checklist for this kind of event
  if (req.body.withChecklist !== false) {
    await Task.insertMany(checklistFor(event, req.user._id));
  }

  // Update user stats
  await User.findByIdAndUpdate(req.user._id, {
    $inc: { eventsOrganized: 1, xpPoints: 50 }
  });

  // Update user level
  const user = await User.findById(req.user._id);
  user.updateLevel();
  await user.save();

  // Clear cache
  await clearCache('/api/v1/events');

  res.status(201).json(ApiResponse.success(event, 'Event created successfully'));
});

// @desc    Update event
// @route   PUT /api/v1/events/:id
// @access  Private
exports.updateEvent = catchAsync(async (req, res, next) => {
  let event = await Event.findById(req.params.id);

  if (!event) {
    return next(new ApiError('Event not found', 404));
  }

  // Check ownership
  if (event.organizer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    return next(new ApiError('Not authorized to update this event', 403));
  }

  // Update coordinates if provided
  if (req.body.coordinates) {
    req.body.location = {
      type: 'Point',
      coordinates: req.body.coordinates
    };
  }

  const updates = filterObject(req.body, UPDATABLE_EVENT_FIELDS);
  if (req.body.location) updates.location = req.body.location;

  event = await Event.findByIdAndUpdate(req.params.id, updates, {
    new: true,
    runValidators: true
  });

  // Clear cache
  await clearCache('/api/v1/events');

  res.json(ApiResponse.success(event, 'Event updated successfully'));
});

// @desc    Delete event
// @route   DELETE /api/v1/events/:id
// @access  Private
exports.deleteEvent = catchAsync(async (req, res, next) => {
  const event = await Event.findById(req.params.id);

  if (!event) {
    return next(new ApiError('Event not found', 404));
  }

  // Check ownership
  if (event.organizer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    return next(new ApiError('Not authorized to delete this event', 403));
  }

  await Event.findByIdAndDelete(req.params.id);

  // Clear cache
  await clearCache('/api/v1/events');

  res.json(ApiResponse.success(null, 'Event deleted successfully'));
});

// @desc    Get my events
// @route   GET /api/v1/events/my-events
// @access  Private
exports.getMyEvents = catchAsync(async (req, res, next) => {
  const { status, page = 1, limit = 20 } = req.query;

  const query = { organizer: req.user._id };
  if (status) query.status = status;

  const events = await Event.find(query)
    .select('+inviteCode')
    .sort('-createdAt')
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

  const total = await Event.countDocuments(query);

  res.json(
    ApiResponse.paginated(events, page, limit, total, 'Your events retrieved successfully')
  );
});

// @desc    Publish event
// @route   POST /api/v1/events/:id/publish
// @access  Private
exports.publishEvent = catchAsync(async (req, res, next) => {
  const event = await Event.findById(req.params.id);

  if (!event) {
    return next(new ApiError('Event not found', 404));
  }

  if (event.organizer.toString() !== req.user._id.toString()) {
    return next(new ApiError('Not authorized', 403));
  }

  event.isPublished = true;
  event.publishedAt = new Date();
  event.status = 'active';
  await event.save();

  await clearCache('/api/v1/events');

  res.json(ApiResponse.success(event, 'Event published successfully'));
});

// @desc    Unpublish event
// @route   POST /api/v1/events/:id/unpublish
// @access  Private
exports.unpublishEvent = catchAsync(async (req, res, next) => {
  const event = await Event.findById(req.params.id);

  if (!event) {
    return next(new ApiError('Event not found', 404));
  }

  if (event.organizer.toString() !== req.user._id.toString()) {
    return next(new ApiError('Not authorized', 403));
  }

  event.isPublished = false;
  event.status = 'draft';
  await event.save();

  await clearCache('/api/v1/events');

  res.json(ApiResponse.success(event, 'Event unpublished successfully'));
});

// @desc    Cancel event
// @route   POST /api/v1/events/:id/cancel
// @access  Private
exports.cancelEvent = catchAsync(async (req, res, next) => {
  const event = await Event.findById(req.params.id);

  if (!event) {
    return next(new ApiError('Event not found', 404));
  }

  if (event.organizer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    return next(new ApiError('Not authorized', 403));
  }

  if (event.status === 'cancelled') {
    return next(new ApiError('Event is already cancelled', 400));
  }

  // Stop new RSVPs and bookings before unwinding existing ones
  event.status = 'cancelled';
  event.isPublished = false;
  await event.save();

  const { reason } = req.body;
  const failures = [];

  // Vendor bookings are cancelled under the organizer cancellation policy
  const bookings = await Booking.find({
    event: event._id,
    status: { $in: ['pending', 'confirmed', 'in_progress'] }
  });
  for (const booking of bookings) {
    try {
      await bookingService.cancelBooking(booking, req.user, reason || 'The event was cancelled');
    } catch (error) {
      console.error(`Failed to cancel booking ${booking._id}:`, error.message);
      failures.push({ booking: booking._id, error: error.message });
    }
  }

  // Attendees get tickets refunded in full
  const rsvps = await RSVP.find({
    event: event._id,
    status: { $in: ['going', 'maybe', 'pending_payment'] }
  });
  for (const rsvp of rsvps) {
    try {
      const refunded = rsvp.paymentStatus === 'paid'
        ? await checkoutService.refundTicket(rsvp, 1, 'Event cancelled by organizer')
        : 0;
      rsvp.status = 'cancelled';
      await rsvp.save();

      await Notification.createNotification({
        recipient: rsvp.attendee,
        type: 'event_reminder',
        title: 'Event Cancelled',
        message: `"${event.title}" has been cancelled.${refunded > 0 ? ` Your ₹${refunded} ticket is being refunded.` : ''}`,
        relatedEvent: event._id,
        actionUrl: `/events/${event._id}`
      });
    } catch (error) {
      console.error(`Failed to cancel RSVP ${rsvp._id}:`, error.message);
      failures.push({ rsvp: rsvp._id, error: error.message });
    }
  }

  await clearCache('/api/v1/events');

  res.json(ApiResponse.success(
    { ...event.toJSON(), refundFailures: failures },
    failures.length
      ? 'Event cancelled, but some refunds failed. Our team will follow up.'
      : 'Event cancelled successfully'
  ));
});

// @desc    Complete event
// @route   POST /api/v1/events/:id/complete
// @access  Private
exports.completeEvent = catchAsync(async (req, res, next) => {
  const event = await Event.findById(req.params.id);

  if (!event) {
    return next(new ApiError('Event not found', 404));
  }

  if (event.organizer.toString() !== req.user._id.toString()) {
    return next(new ApiError('Not authorized', 403));
  }

  if (event.status === 'cancelled' || event.status === 'completed') {
    return next(new ApiError(`Event is already ${event.status}`, 400));
  }

  // Completing releases ticket revenue, so only once the event has happened
  const startOfEventDay = new Date(event.date);
  startOfEventDay.setHours(0, 0, 0, 0);
  if (startOfEventDay > new Date()) {
    return next(new ApiError('You can mark the event completed once it has taken place', 400));
  }

  event.status = 'completed';
  event.completedAt = new Date();
  await event.save();

  // Award XP to organizer
  await User.findByIdAndUpdate(req.user._id, {
    $inc: { xpPoints: 100 }
  });

  // Ticket revenue becomes due to the organizer
  await checkoutService.releaseTicketPayouts(event._id);

  await clearCache('/api/v1/events');

  res.json(ApiResponse.success(event, 'Event marked as completed'));
});

// @desc    Get nearby events
// @route   GET /api/v1/events/nearby
// @access  Public
exports.getNearbyEvents = catchAsync(async (req, res, next) => {
  const { lng, lat, maxDistance = 10000, limit = 20 } = req.query;

  if (!lng || !lat) {
    return next(new ApiError('Location coordinates required', 400));
  }

  const events = await Event.find({
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [parseFloat(lng), parseFloat(lat)]
        },
        $maxDistance: parseInt(maxDistance)
      }
    },
    isPublic: true,
    isPublished: true,
    status: { $in: ['active', 'planning'] },
    date: { $gte: new Date() }
  })
    .populate('organizer', 'name profilePhoto')
    .limit(parseInt(limit))
    .lean();

  res.json(ApiResponse.success(events, 'Nearby events retrieved'));
});

// @desc    Get upcoming events
// @route   GET /api/v1/events/upcoming
// @access  Public
exports.getUpcomingEvents = catchAsync(async (req, res, next) => {
  const { city, limit = 10 } = req.query;

  const query = {
    isPublic: true,
    isPublished: true,
    status: { $in: ['active', 'planning'] },
    date: { $gte: new Date() }
  };

  if (city) query.city = cityMatch(city);

  const events = await Event.find(query)
    .populate('organizer', 'name profilePhoto')
    .sort('date')
    .limit(parseInt(limit))
    .lean();

  res.json(ApiResponse.success(events, 'Upcoming events retrieved'));
});

// @desc    Get popular events
// @route   GET /api/v1/events/popular
// @access  Public
exports.getPopularEvents = catchAsync(async (req, res, next) => {
  const { city, limit = 10 } = req.query;

  const query = {
    isPublic: true,
    isPublished: true,
    status: { $in: ['active', 'planning'] },
    date: { $gte: new Date() }
  };

  if (city) query.city = cityMatch(city);

  const events = await Event.find(query)
    .populate('organizer', 'name profilePhoto')
    .sort('-rsvpCount -views')
    .limit(parseInt(limit))
    .lean();

  res.json(ApiResponse.success(events, 'Popular events retrieved'));
});

// @desc    Add co-organizer
// @route   POST /api/v1/events/:id/co-organizers
// @access  Private
exports.addCoOrganizer = catchAsync(async (req, res, next) => {
  const { userId } = req.body;
  const event = await Event.findById(req.params.id);

  if (!event) {
    return next(new ApiError('Event not found', 404));
  }

  if (event.organizer.toString() !== req.user._id.toString()) {
    return next(new ApiError('Not authorized', 403));
  }

  // Check if user exists
  const user = await User.findById(userId);
  if (!user) {
    return next(new ApiError('User not found', 404));
  }

  // Check if already a co-organizer
  if (event.coOrganizers.includes(userId)) {
    return next(new ApiError('User is already a co-organizer', 400));
  }

  event.coOrganizers.push(userId);
  await event.save();

  // TODO: Notify user about being added as co-organizer

  res.json(ApiResponse.success(event, 'Co-organizer added successfully'));
});

// @desc    Remove co-organizer
// @route   DELETE /api/v1/events/:id/co-organizers/:userId
// @access  Private
exports.removeCoOrganizer = catchAsync(async (req, res, next) => {
  const event = await Event.findById(req.params.id);

  if (!event) {
    return next(new ApiError('Event not found', 404));
  }

  if (event.organizer.toString() !== req.user._id.toString()) {
    return next(new ApiError('Not authorized', 403));
  }

  event.coOrganizers = event.coOrganizers.filter(
    id => id.toString() !== req.params.userId
  );
  await event.save();

  res.json(ApiResponse.success(event, 'Co-organizer removed successfully'));
});

// @desc    Get invite link details for an event
// @route   GET /api/v1/events/:id/invite
// @access  Private (organizers)
exports.getInvite = catchAsync(async (req, res, next) => {
  const event = await Event.findById(req.params.id).select('+inviteCode');

  if (!event) {
    return next(new ApiError('Event not found', 404));
  }

  if (!event.isOrganizedBy(req.user) && req.user.role !== 'admin') {
    return next(new ApiError('Not authorized', 403));
  }

  res.json(ApiResponse.success(inviteDetails(event), 'Invite retrieved'));
});

// @desc    Replace an event's invite code, invalidating old invite links
// @route   POST /api/v1/events/:id/invite/regenerate
// @access  Private (owner)
exports.regenerateInvite = catchAsync(async (req, res, next) => {
  const event = await Event.findById(req.params.id).select('+inviteCode');

  if (!event) {
    return next(new ApiError('Event not found', 404));
  }

  if (event.organizer.toString() !== req.user._id.toString()) {
    return next(new ApiError('Not authorized', 403));
  }

  event.inviteCode = require('crypto').randomBytes(9).toString('base64url');
  await event.save();

  res.json(ApiResponse.success(inviteDetails(event), 'Invite link regenerated'));
});

// @desc    Everything needed to plan an event on one screen: the checklist,
//          bookings so far, and vendors to suggest for each open item
// @route   GET /api/v1/events/:id/plan
// @access  Organizers of the event
exports.getEventPlan = catchAsync(async (req, res, next) => {
  const event = await Event.findById(req.params.id);
  if (!event) return next(new ApiError('Event not found', 404));
  if (!event.isOrganizedBy(req.user)) return next(new ApiError('Only organizers can see the plan', 403));

  const [tasks, bookings] = await Promise.all([
    Task.find({ event: event._id, status: { $ne: 'cancelled' } }).sort({ dueDate: 1, createdAt: 1 }).lean(),
    Booking.find({ event: event._id })
      .populate('service', 'serviceName category slug')
      .populate('vendor', 'name profilePhoto')
      .sort('-createdAt')
      .lean()
  ]);

  // Categories already covered by a live booking don't need suggestions
  const live = ['pending', 'confirmed', 'in_progress', 'completed'];
  const booked = new Set(bookings.filter(b => live.includes(b.status) && b.service).map(b => b.service.category));
  const wanted = [...new Set(tasks.filter(t => t.serviceCategory && t.status !== 'done').map(t => t.serviceCategory))]
    .filter(c => !booked.has(c));

  const suggestions = {};
  await Promise.all(wanted.map(async (category) => {
    suggestions[category] = await Service.find({
      category,
      isActive: true,
      provider: { $ne: req.user._id },
      ...(event.city ? { city: cityMatch(event.city) } : {})
    })
      .select('serviceName slug basePrice priceUnit ratingAverage totalRatings isVerified coverImage city provider')
      .populate('provider', 'name profilePhoto')
      .sort({ isVerified: -1, ratingAverage: -1, completedBookings: -1 })
      .limit(3)
      .lean();
  }));

  res.json(ApiResponse.success({ tasks, bookings, suggestions }, 'Event plan retrieved'));
});

const inviteDetails = (event) => ({
  inviteCode: event.inviteCode,
  inviteUrl: `${frontendUrl()}/events/${event._id}?invite=${event.inviteCode}`
});
