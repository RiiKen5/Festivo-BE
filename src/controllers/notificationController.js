const Notification = require('../models/Notification');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const ApiResponse = require('../utils/apiResponse');

// @desc    Get user notifications
// @route   GET /api/v1/notifications
// @access  Private
exports.getNotifications = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 20, type, isRead } = req.query;

  const query = { recipient: req.user._id };
  if (type) query.type = type;
  if (isRead !== undefined) query.isRead = isRead === 'true';

  const notifications = await Notification.getUserNotifications(
    req.user._id,
    parseInt(page),
    parseInt(limit)
  );

  const total = await Notification.countDocuments(query);

  res.json(
    ApiResponse.paginated(notifications, page, limit, total, 'Notifications retrieved')
  );
});

// @desc    Get unread count
// @route   GET /api/v1/notifications/unread-count
// @access  Private
exports.getUnreadCount = catchAsync(async (req, res, next) => {
  const count = await Notification.getUnreadCount(req.user._id);

  res.json(ApiResponse.success({ unreadCount: count }, 'Unread count retrieved'));
});

// @desc    Mark notification as read
// @route   PUT /api/v1/notifications/:id/read
// @access  Private
exports.markAsRead = catchAsync(async (req, res, next) => {
  const notification = await Notification.findById(req.params.id);

  if (!notification) {
    return next(new ApiError('Notification not found', 404));
  }

  if (notification.recipient.toString() !== req.user._id.toString()) {
    return next(new ApiError('Not authorized', 403));
  }

  notification.isRead = true;
  notification.readAt = new Date();
  await notification.save();

  res.json(ApiResponse.success(notification, 'Notification marked as read'));
});

// @desc    Mark all notifications as read
// @route   PUT /api/v1/notifications/read-all
// @access  Private
exports.markAllAsRead = catchAsync(async (req, res, next) => {
  await Notification.markAllAsRead(req.user._id);

  res.json(ApiResponse.success(null, 'All notifications marked as read'));
});

// @desc    Delete notification
// @route   DELETE /api/v1/notifications/:id
// @access  Private
exports.deleteNotification = catchAsync(async (req, res, next) => {
  const notification = await Notification.findById(req.params.id);

  if (!notification) {
    return next(new ApiError('Notification not found', 404));
  }

  if (notification.recipient.toString() !== req.user._id.toString()) {
    return next(new ApiError('Not authorized', 403));
  }

  await Notification.findByIdAndDelete(req.params.id);

  res.json(ApiResponse.success(null, 'Notification deleted'));
});

// @desc    Delete all read notifications
// @route   DELETE /api/v1/notifications/clear-read
// @access  Private
exports.clearReadNotifications = catchAsync(async (req, res, next) => {
  await Notification.deleteMany({
    recipient: req.user._id,
    isRead: true
  });

  res.json(ApiResponse.success(null, 'Read notifications cleared'));
});

// @desc    Update notification preferences
// @route   PUT /api/v1/notifications/preferences
// @access  Private
exports.updatePreferences = catchAsync(async (req, res, next) => {
  const { email, sms, push } = req.body;

  const User = require('../models/User');
  const user = await User.findByIdAndUpdate(
    req.user._id,
    {
      notifications: { email, sms, push }
    },
    { new: true }
  );

  res.json(ApiResponse.success(user.notifications, 'Notification preferences updated'));
});

// @desc    Get notification preferences
// @route   GET /api/v1/notifications/preferences
// @access  Private
exports.getPreferences = catchAsync(async (req, res, next) => {
  const User = require('../models/User');
  const user = await User.findById(req.user._id).select('notifications');

  res.json(ApiResponse.success(user.notifications, 'Notification preferences retrieved'));
});
