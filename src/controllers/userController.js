const User = require('../models/User');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const ApiResponse = require('../utils/apiResponse');

// @desc    Get all users (admin only)
// @route   GET /api/v1/users
// @access  Private/Admin
exports.getUsers = catchAsync(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    city,
    userType,
    isVerified,
    isBanned,
    search,
    sort = '-createdAt'
  } = req.query;

  // Build query
  const query = {};

  if (city) query.city = city;
  if (userType) query.userType = userType;
  if (isVerified !== undefined) query.isVerified = isVerified === 'true';
  if (isBanned !== undefined) query.isBanned = isBanned === 'true';

  // Search by name or email
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];
  }

  const users = await User.find(query)
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

  const total = await User.countDocuments(query);

  res.json(
    ApiResponse.paginated(users, page, limit, total, 'Users retrieved successfully')
  );
});

// @desc    Get single user
// @route   GET /api/v1/users/:id
// @access  Public
exports.getUser = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.params.id)
    .select('-password -refreshTokens -passwordResetToken -passwordResetExpires');

  if (!user) {
    return next(new ApiError('User not found', 404));
  }

  res.json(ApiResponse.success(user, 'User retrieved successfully'));
});

// @desc    Get user public profile
// @route   GET /api/v1/users/:id/profile
// @access  Public
exports.getUserProfile = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.params.id)
    .select('name profilePhoto bio city userType ratingAverage totalRatings eventsOrganized eventsAttended level badges socialLinks createdAt');

  if (!user) {
    return next(new ApiError('User not found', 404));
  }

  res.json(ApiResponse.success(user, 'User profile retrieved successfully'));
});

// @desc    Update user (admin only)
// @route   PUT /api/v1/users/:id
// @access  Private/Admin
exports.updateUser = catchAsync(async (req, res, next) => {
  const allowedFields = ['name', 'email', 'phone', 'city', 'userType', 'isActive', 'isVerified', 'isBanned', 'role'];
  const updates = {};

  allowedFields.forEach(field => {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  });

  const user = await User.findByIdAndUpdate(req.params.id, updates, {
    new: true,
    runValidators: true
  });

  if (!user) {
    return next(new ApiError('User not found', 404));
  }

  res.json(ApiResponse.success(user, 'User updated successfully'));
});

// @desc    Delete user (admin only)
// @route   DELETE /api/v1/users/:id
// @access  Private/Admin
exports.deleteUser = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new ApiError('User not found', 404));
  }

  // Soft delete - set isActive to false
  user.isActive = false;
  await user.save();

  res.json(ApiResponse.success(null, 'User deleted successfully'));
});

// @desc    Ban user (admin only)
// @route   POST /api/v1/users/:id/ban
// @access  Private/Admin
exports.banUser = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.params.id).select('+refreshTokens');

  if (!user) {
    return next(new ApiError('User not found', 404));
  }

  user.isBanned = true;
  user.refreshTokens = []; // Invalidate all sessions
  await user.save();

  res.json(ApiResponse.success(null, 'User banned successfully'));
});

// @desc    Unban user (admin only)
// @route   POST /api/v1/users/:id/unban
// @access  Private/Admin
exports.unbanUser = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new ApiError('User not found', 404));
  }

  user.isBanned = false;
  await user.save();

  res.json(ApiResponse.success(null, 'User unbanned successfully'));
});

// @desc    Verify user (admin only)
// @route   POST /api/v1/users/:id/verify
// @access  Private/Admin
exports.verifyUser = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new ApiError('User not found', 404));
  }

  user.isVerified = true;
  await user.save();

  res.json(ApiResponse.success(user, 'User verified successfully'));
});

// @desc    Get user stats
// @route   GET /api/v1/users/:id/stats
// @access  Public
exports.getUserStats = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new ApiError('User not found', 404));
  }

  const stats = {
    eventsOrganized: user.eventsOrganized,
    eventsAttended: user.eventsAttended,
    ratingAverage: user.ratingAverage,
    totalRatings: user.totalRatings,
    xpPoints: user.xpPoints,
    level: user.level,
    badges: user.badges
  };

  res.json(ApiResponse.success(stats, 'User stats retrieved successfully'));
});

// @desc    Search users
// @route   GET /api/v1/users/search
// @access  Private
exports.searchUsers = catchAsync(async (req, res, next) => {
  const { q, city, userType, limit = 10 } = req.query;

  if (!q) {
    return next(new ApiError('Search query required', 400));
  }

  const query = {
    isActive: true,
    isBanned: false,
    $or: [
      { name: { $regex: q, $options: 'i' } },
      { email: { $regex: q, $options: 'i' } }
    ]
  };

  if (city) query.city = city;
  if (userType) query.userType = userType;

  const users = await User.find(query)
    .select('name email profilePhoto city userType ratingAverage')
    .limit(limit * 1)
    .lean();

  res.json(ApiResponse.success(users, 'Users found'));
});

// @desc    Get nearby users
// @route   GET /api/v1/users/nearby
// @access  Private
exports.getNearbyUsers = catchAsync(async (req, res, next) => {
  const { lng, lat, maxDistance = 10000, limit = 20 } = req.query;

  if (!lng || !lat) {
    return next(new ApiError('Location coordinates required', 400));
  }

  const users = await User.find({
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
    isBanned: false,
    _id: { $ne: req.user._id }
  })
    .select('name profilePhoto city userType ratingAverage')
    .limit(parseInt(limit))
    .lean();

  res.json(ApiResponse.success(users, 'Nearby users retrieved'));
});

// @desc    Get vendors by category
// @route   GET /api/v1/users/vendors
// @access  Public
exports.getVendors = catchAsync(async (req, res, next) => {
  const { city, page = 1, limit = 20, sort = '-ratingAverage' } = req.query;

  const query = {
    userType: { $in: ['helper', 'all'] },
    isActive: true,
    isBanned: false
  };

  if (city) query.city = city;

  const vendors = await User.find(query)
    .select('name profilePhoto bio city ratingAverage totalRatings level')
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

  const total = await User.countDocuments(query);

  res.json(
    ApiResponse.paginated(vendors, page, limit, total, 'Vendors retrieved successfully')
  );
});
