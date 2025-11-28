const Service = require('../models/Service');
const User = require('../models/User');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const ApiResponse = require('../utils/apiResponse');
const { clearCache } = require('../middlewares/cache');

// @desc    Get all services with filters
// @route   GET /api/v1/services
// @access  Public
exports.getServices = catchAsync(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    city,
    category,
    availability,
    minPrice,
    maxPrice,
    minRating,
    tags,
    sort = '-ratingAverage',
    search
  } = req.query;

  // Build query
  const query = { isActive: true };

  if (city) query.city = city;
  if (category) query.category = category;
  if (availability) query.availability = availability;
  if (tags) query.tags = { $in: tags.split(',') };
  if (minRating) query.ratingAverage = { $gte: parseFloat(minRating) };

  // Price range
  if (minPrice || maxPrice) {
    query.basePrice = {};
    if (minPrice) query.basePrice.$gte = parseFloat(minPrice);
    if (maxPrice) query.basePrice.$lte = parseFloat(maxPrice);
  }

  // Text search
  if (search) {
    query.$text = { $search: search };
  }

  // Execute query
  const services = await Service.find(query)
    .populate('provider', 'name profilePhoto ratingAverage')
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

  const total = await Service.countDocuments(query);

  res.json(
    ApiResponse.paginated(services, page, limit, total, 'Services retrieved successfully')
  );
});

// @desc    Get single service
// @route   GET /api/v1/services/:id
// @access  Public
exports.getService = catchAsync(async (req, res, next) => {
  const service = await Service.findById(req.params.id)
    .populate('provider', 'name profilePhoto bio ratingAverage totalRatings city socialLinks');

  if (!service) {
    return next(new ApiError('Service not found', 404));
  }

  // Increment views
  service.views += 1;
  await service.save();

  res.json(ApiResponse.success(service, 'Service retrieved successfully'));
});

// @desc    Get service by slug
// @route   GET /api/v1/services/slug/:slug
// @access  Public
exports.getServiceBySlug = catchAsync(async (req, res, next) => {
  const service = await Service.findOne({ slug: req.params.slug })
    .populate('provider', 'name profilePhoto bio ratingAverage totalRatings city socialLinks');

  if (!service) {
    return next(new ApiError('Service not found', 404));
  }

  // Increment views
  service.views += 1;
  await service.save();

  res.json(ApiResponse.success(service, 'Service retrieved successfully'));
});

// @desc    Create service
// @route   POST /api/v1/services
// @access  Private
exports.createService = catchAsync(async (req, res, next) => {
  const serviceData = {
    ...req.body,
    provider: req.user._id
  };

  // Set location if coordinates provided
  if (req.body.coordinates) {
    serviceData.location = {
      type: 'Point',
      coordinates: req.body.coordinates
    };
  }

  const service = await Service.create(serviceData);

  // Update user type if not already helper
  if (req.user.userType === 'attendee') {
    await User.findByIdAndUpdate(req.user._id, { userType: 'helper' });
  }

  // Clear cache
  await clearCache('/api/v1/services');

  res.status(201).json(ApiResponse.success(service, 'Service created successfully'));
});

// @desc    Update service
// @route   PUT /api/v1/services/:id
// @access  Private
exports.updateService = catchAsync(async (req, res, next) => {
  let service = await Service.findById(req.params.id);

  if (!service) {
    return next(new ApiError('Service not found', 404));
  }

  // Check ownership
  if (service.provider.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    return next(new ApiError('Not authorized to update this service', 403));
  }

  // Update coordinates if provided
  if (req.body.coordinates) {
    req.body.location = {
      type: 'Point',
      coordinates: req.body.coordinates
    };
  }

  service = await Service.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true
  });

  // Clear cache
  await clearCache('/api/v1/services');

  res.json(ApiResponse.success(service, 'Service updated successfully'));
});

// @desc    Delete service
// @route   DELETE /api/v1/services/:id
// @access  Private
exports.deleteService = catchAsync(async (req, res, next) => {
  const service = await Service.findById(req.params.id);

  if (!service) {
    return next(new ApiError('Service not found', 404));
  }

  // Check ownership
  if (service.provider.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    return next(new ApiError('Not authorized to delete this service', 403));
  }

  // Soft delete
  service.isActive = false;
  await service.save();

  // Clear cache
  await clearCache('/api/v1/services');

  res.json(ApiResponse.success(null, 'Service deleted successfully'));
});

// @desc    Get my services
// @route   GET /api/v1/services/my-services
// @access  Private
exports.getMyServices = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 20 } = req.query;

  const query = { provider: req.user._id };

  const services = await Service.find(query)
    .sort('-createdAt')
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

  const total = await Service.countDocuments(query);

  res.json(
    ApiResponse.paginated(services, page, limit, total, 'Your services retrieved successfully')
  );
});

// @desc    Update availability
// @route   PUT /api/v1/services/:id/availability
// @access  Private
exports.updateAvailability = catchAsync(async (req, res, next) => {
  const { availability, availableDates, blackoutDates } = req.body;
  const service = await Service.findById(req.params.id);

  if (!service) {
    return next(new ApiError('Service not found', 404));
  }

  if (service.provider.toString() !== req.user._id.toString()) {
    return next(new ApiError('Not authorized', 403));
  }

  if (availability) service.availability = availability;
  if (availableDates) service.availableDates = availableDates;
  if (blackoutDates) service.blackoutDates = blackoutDates;

  await service.save();

  res.json(ApiResponse.success(service, 'Availability updated successfully'));
});

// @desc    Get services by category
// @route   GET /api/v1/services/category/:category
// @access  Public
exports.getServicesByCategory = catchAsync(async (req, res, next) => {
  const { city, page = 1, limit = 20, sort = '-ratingAverage' } = req.query;

  const query = {
    category: req.params.category,
    isActive: true,
    availability: 'available'
  };

  if (city) query.city = city;

  const services = await Service.find(query)
    .populate('provider', 'name profilePhoto ratingAverage')
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

  const total = await Service.countDocuments(query);

  res.json(
    ApiResponse.paginated(services, page, limit, total, 'Services retrieved successfully')
  );
});

// @desc    Get nearby services
// @route   GET /api/v1/services/nearby
// @access  Public
exports.getNearbyServices = catchAsync(async (req, res, next) => {
  const { lng, lat, maxDistance = 10000, category, limit = 20 } = req.query;

  if (!lng || !lat) {
    return next(new ApiError('Location coordinates required', 400));
  }

  const query = {
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [parseFloat(lng), parseFloat(lat)]
        },
        $maxDistance: parseInt(maxDistance)
      }
    },
    isActive: true,
    availability: 'available'
  };

  if (category) query.category = category;

  const services = await Service.find(query)
    .populate('provider', 'name profilePhoto ratingAverage')
    .limit(parseInt(limit))
    .lean();

  res.json(ApiResponse.success(services, 'Nearby services retrieved'));
});

// @desc    Get top rated services
// @route   GET /api/v1/services/top-rated
// @access  Public
exports.getTopRatedServices = catchAsync(async (req, res, next) => {
  const { city, category, limit = 10 } = req.query;

  const query = {
    isActive: true,
    totalRatings: { $gte: 5 } // Minimum 5 ratings
  };

  if (city) query.city = city;
  if (category) query.category = category;

  const services = await Service.find(query)
    .populate('provider', 'name profilePhoto')
    .sort('-ratingAverage')
    .limit(parseInt(limit))
    .lean();

  res.json(ApiResponse.success(services, 'Top rated services retrieved'));
});

// @desc    Verify service (admin only)
// @route   POST /api/v1/services/:id/verify
// @access  Private/Admin
exports.verifyService = catchAsync(async (req, res, next) => {
  const service = await Service.findById(req.params.id);

  if (!service) {
    return next(new ApiError('Service not found', 404));
  }

  service.isVerified = true;
  service.verifiedAt = new Date();
  await service.save();

  // TODO: Notify vendor about verification

  res.json(ApiResponse.success(service, 'Service verified successfully'));
});

// @desc    Get service stats
// @route   GET /api/v1/services/:id/stats
// @access  Private
exports.getServiceStats = catchAsync(async (req, res, next) => {
  const service = await Service.findById(req.params.id);

  if (!service) {
    return next(new ApiError('Service not found', 404));
  }

  if (service.provider.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    return next(new ApiError('Not authorized', 403));
  }

  const stats = {
    totalBookings: service.totalBookings,
    completedBookings: service.completedBookings,
    completionRate: service.completionRate,
    ratingAverage: service.ratingAverage,
    totalRatings: service.totalRatings,
    views: service.views
  };

  res.json(ApiResponse.success(stats, 'Service stats retrieved'));
});

// @desc    Check availability for date
// @route   GET /api/v1/services/:id/check-availability
// @access  Public
exports.checkAvailability = catchAsync(async (req, res, next) => {
  const { date } = req.query;
  const service = await Service.findById(req.params.id);

  if (!service) {
    return next(new ApiError('Service not found', 404));
  }

  if (!date) {
    return next(new ApiError('Date required', 400));
  }

  const checkDate = new Date(date);

  // Check if date is in blackout dates
  const isBlackout = service.blackoutDates.some(
    d => d.toDateString() === checkDate.toDateString()
  );

  // Check if service is available
  const isAvailable = service.availability === 'available' && !isBlackout;

  res.json(
    ApiResponse.success(
      { isAvailable, date: checkDate },
      isAvailable ? 'Service is available on this date' : 'Service is not available on this date'
    )
  );
});
