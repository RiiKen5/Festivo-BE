const Event = require('../models/Event');
const User = require('../models/User');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const ApiResponse = require('../utils/apiResponse');
const { clearCache } = require('../middlewares/cache');

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
    sort = '-date',
    search
  } = req.query;

  // Build query
  const query = { isPublished: true, status: { $ne: 'cancelled' } };

  if (city) query.city = city;
  if (eventType) query.eventType = eventType;
  if (vibeScore) query.vibeScore = vibeScore;
  if (isPaid !== undefined) query.isPaid = isPaid === 'true';
  if (tags) query.tags = { $in: tags.split(',') };

  if (dateFrom || dateTo) {
    query.date = {};
    if (dateFrom) query.date.$gte = new Date(dateFrom);
    if (dateTo) query.date.$lte = new Date(dateTo);
  }

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
    .populate('organizer', 'name profilePhoto bio ratingAverage totalRatings')
    .populate('coOrganizers', 'name profilePhoto');

  if (!event) {
    return next(new ApiError('Event not found', 404));
  }

  // Increment views
  event.views += 1;
  await event.save();

  res.json(ApiResponse.success(event, 'Event retrieved successfully'));
});

// @desc    Get event by slug
// @route   GET /api/v1/events/slug/:slug
// @access  Public
exports.getEventBySlug = catchAsync(async (req, res, next) => {
  const event = await Event.findOne({ slug: req.params.slug })
    .populate('organizer', 'name profilePhoto bio ratingAverage totalRatings')
    .populate('coOrganizers', 'name profilePhoto');

  if (!event) {
    return next(new ApiError('Event not found', 404));
  }

  // Increment views
  event.views += 1;
  await event.save();

  res.json(ApiResponse.success(event, 'Event retrieved successfully'));
});

// @desc    Create event
// @route   POST /api/v1/events
// @access  Private
exports.createEvent = catchAsync(async (req, res, next) => {
  const eventData = {
    ...req.body,
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

  event = await Event.findByIdAndUpdate(req.params.id, req.body, {
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

  event.status = 'cancelled';
  event.isPublished = false;
  await event.save();

  // TODO: Notify all RSVPs and bookings about cancellation

  await clearCache('/api/v1/events');

  res.json(ApiResponse.success(event, 'Event cancelled successfully'));
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

  event.status = 'completed';
  event.completedAt = new Date();
  await event.save();

  // Award XP to organizer
  await User.findByIdAndUpdate(req.user._id, {
    $inc: { xpPoints: 100 }
  });

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
    isPublished: true,
    status: { $in: ['active', 'planning'] },
    date: { $gte: new Date() }
  };

  if (city) query.city = city;

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
    isPublished: true,
    status: { $in: ['active', 'planning'] },
    date: { $gte: new Date() }
  };

  if (city) query.city = city;

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
