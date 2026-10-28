const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  // Recipient
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // Notification Details
  type: {
    type: String,
    enum: ['booking', 'message', 'review', 'event_reminder', 'payment', 'system', 'rsvp', 'task_assigned'],
    required: true
  },
  title: {
    type: String,
    required: [true, 'Title is required'],
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  message: {
    type: String,
    required: [true, 'Message is required'],
    maxlength: [500, 'Message cannot exceed 500 characters']
  },

  // Action
  actionUrl: String,
  actionText: String,

  // Related Entities
  relatedEvent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event'
  },
  relatedBooking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking'
  },
  relatedUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Status
  isRead: {
    type: Boolean,
    default: false,
    index: true
  },
  readAt: Date,

  // Delivery
  channels: {
    push: { type: Boolean, default: true },
    email: { type: Boolean, default: false },
    sms: { type: Boolean, default: false }
  },
  sentVia: [String],

  // Priority
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },

  // Expiry
  expiresAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index
notificationSchema.index({ type: 1 });
notificationSchema.index({ priority: 1 });

// Auto-set expiry (30 days by default)
notificationSchema.pre('save', function(next) {
  if (this.isNew && !this.expiresAt) {
    this.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }
  next();
});

// Auto-set readAt
notificationSchema.pre('save', function(next) {
  if (this.isModified('isRead') && this.isRead && !this.readAt) {
    this.readAt = new Date();
  }
  next();
});

// Static method to create notification with socket emit
// Notifications important enough to also email, so people who aren't on
// Festivo at the moment still find out (a vendor missing a booking request
// loses the customer)
const EMAILED_TITLES = new Set([
  'New Booking Request', 'Booking Confirmed', 'Booking Cancelled', 'Payment Received',
  'Advance on its way', 'Advance Sent', 'Payout Sent', 'Service Verified',
  'Problem Reported', 'Vendor Replied', 'Problem Resolved', 'Event Cancelled', "You're a founding vendor"
]);

// Sent in the background: a slow or failing mail server never holds up the request
const emailInBackground = (notification) => {
  setImmediate(async () => {
    try {
      const User = mongoose.model('User');
      const user = await User.findById(notification.recipient).select('email name notifications isActive');
      // Respect the email setting on the profile; deleted accounts get nothing
      if (!user || !user.email || !user.isActive || (user.notifications && user.notifications.email === false)) return;
      const sent = await require('../services/emailService').sendNotificationEmail(user, notification);
      if (sent) await notification.constructor.updateOne({ _id: notification._id }, { $addToSet: { sentVia: 'email' } });
    } catch (error) {
      console.error(`Could not email notification ${notification._id}:`, error.message);
    }
  });
};

notificationSchema.statics.createNotification = async function(data) {
  const notification = await this.create(data);

  if (EMAILED_TITLES.has(notification.title)) emailInBackground(notification);

  // Try to emit socket event for real-time notification
  try {
    const socketModule = require('../socket');
    const io = socketModule.getIO();
    if (io) {
      io.to(data.recipient.toString()).emit('new_notification', notification);
    }
  } catch (error) {
    // Socket not initialized, skip
  }

  return notification;
};

// Static method to mark all as read
notificationSchema.statics.markAllAsRead = function(userId) {
  return this.updateMany(
    { recipient: userId, isRead: false },
    { isRead: true, readAt: new Date() }
  );
};

// Static method to get unread count
notificationSchema.statics.getUnreadCount = function(userId) {
  return this.countDocuments({
    recipient: userId,
    isRead: false
  });
};

// Static method to get user notifications
notificationSchema.statics.getUserNotifications = function(userId, page = 1, limit = 20) {
  return this.find({ recipient: userId })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('relatedUser', 'name profilePhoto')
    .populate('relatedEvent', 'title')
    .lean();
};

// Static method to delete old read notifications
notificationSchema.statics.cleanupOldNotifications = function(daysOld = 30) {
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  return this.deleteMany({
    isRead: true,
    createdAt: { $lt: cutoffDate }
  });
};

module.exports = mongoose.model('Notification', notificationSchema);
