const Message = require('../models/Message');
const User = require('../models/User');
const Notification = require('../models/Notification');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const ApiResponse = require('../utils/apiResponse');

// @desc    Get conversation with a user
// @route   GET /api/v1/messages/conversation/:userId
// @access  Private
exports.getConversation = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 50 } = req.query;
  const otherUserId = req.params.userId;

  // Check if other user exists
  const otherUser = await User.findById(otherUserId).select('name profilePhoto');
  if (!otherUser) {
    return next(new ApiError('User not found', 404));
  }

  const skip = (page - 1) * limit;
  const messages = await Message.getConversation(req.user._id, otherUserId, limit, skip);

  // Mark messages as read
  await Message.markAsRead(otherUserId, req.user._id);

  // Get total count
  const total = await Message.countDocuments({
    $or: [
      { sender: req.user._id, receiver: otherUserId },
      { sender: otherUserId, receiver: req.user._id }
    ],
    isDeleted: false
  });

  res.json(
    ApiResponse.paginated(
      { messages: messages.reverse(), otherUser },
      page,
      limit,
      total,
      'Conversation retrieved'
    )
  );
});

// @desc    Send message
// @route   POST /api/v1/messages
// @access  Private
exports.sendMessage = catchAsync(async (req, res, next) => {
  const { receiverId, messageText, relatedEventId, relatedBookingId, messageType = 'text' } = req.body;

  // Check if receiver exists
  const receiver = await User.findById(receiverId);
  if (!receiver) {
    return next(new ApiError('Receiver not found', 404));
  }

  // Can't message yourself
  if (receiverId === req.user._id.toString()) {
    return next(new ApiError('Cannot send message to yourself', 400));
  }

  const messageData = {
    sender: req.user._id,
    receiver: receiverId,
    messageText,
    messageType
  };

  if (relatedEventId) messageData.relatedEvent = relatedEventId;
  if (relatedBookingId) messageData.relatedBooking = relatedBookingId;

  const message = await Message.create(messageData);

  await message.populate([
    { path: 'sender', select: 'name profilePhoto' },
    { path: 'receiver', select: 'name profilePhoto' }
  ]);

  // Send notification
  await Notification.createNotification({
    recipient: receiverId,
    type: 'message',
    title: 'New Message',
    message: `${req.user.name}: ${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}`,
    relatedUser: req.user._id,
    actionUrl: `/messages/${req.user._id}`
  });

  // Emit socket event for real-time
  try {
    const socketModule = require('../socket');
    const io = socketModule.getIO();
    if (io) {
      io.to(receiverId).emit('new_message', message);
    }
  } catch (error) {
    // Socket not initialized
  }

  res.status(201).json(ApiResponse.success(message, 'Message sent successfully'));
});

// @desc    Get recent conversations
// @route   GET /api/v1/messages/conversations
// @access  Private
exports.getConversations = catchAsync(async (req, res, next) => {
  const { limit = 20 } = req.query;

  const conversations = await Message.getRecentConversations(req.user._id, parseInt(limit));

  res.json(ApiResponse.success(conversations, 'Conversations retrieved'));
});

// @desc    Mark messages as read
// @route   PUT /api/v1/messages/read/:userId
// @access  Private
exports.markAsRead = catchAsync(async (req, res, next) => {
  await Message.markAsRead(req.params.userId, req.user._id);

  res.json(ApiResponse.success(null, 'Messages marked as read'));
});

// @desc    Get unread count
// @route   GET /api/v1/messages/unread-count
// @access  Private
exports.getUnreadCount = catchAsync(async (req, res, next) => {
  const count = await Message.getUnreadCount(req.user._id);

  res.json(ApiResponse.success({ unreadCount: count }, 'Unread count retrieved'));
});

// @desc    Delete message
// @route   DELETE /api/v1/messages/:id
// @access  Private
exports.deleteMessage = catchAsync(async (req, res, next) => {
  const message = await Message.findById(req.params.id);

  if (!message) {
    return next(new ApiError('Message not found', 404));
  }

  // Check if user is sender or receiver
  if (
    message.sender.toString() !== req.user._id.toString() &&
    message.receiver.toString() !== req.user._id.toString()
  ) {
    return next(new ApiError('Not authorized', 403));
  }

  // Soft delete - add user to deletedBy array
  if (!message.deletedBy.includes(req.user._id)) {
    message.deletedBy.push(req.user._id);
  }

  // If both users deleted, mark as deleted
  if (message.deletedBy.length >= 2) {
    message.isDeleted = true;
  }

  await message.save();

  res.json(ApiResponse.success(null, 'Message deleted'));
});

// @desc    Search messages
// @route   GET /api/v1/messages/search
// @access  Private
exports.searchMessages = catchAsync(async (req, res, next) => {
  const { q, userId, limit = 20 } = req.query;

  if (!q) {
    return next(new ApiError('Search query required', 400));
  }

  const query = {
    $or: [
      { sender: req.user._id },
      { receiver: req.user._id }
    ],
    messageText: { $regex: q, $options: 'i' },
    isDeleted: false
  };

  // If searching within specific conversation
  if (userId) {
    query.$or = [
      { sender: req.user._id, receiver: userId },
      { sender: userId, receiver: req.user._id }
    ];
  }

  const messages = await Message.find(query)
    .populate('sender', 'name profilePhoto')
    .populate('receiver', 'name profilePhoto')
    .sort('-createdAt')
    .limit(parseInt(limit))
    .lean();

  res.json(ApiResponse.success(messages, 'Messages found'));
});

// @desc    Get messages for booking
// @route   GET /api/v1/messages/booking/:bookingId
// @access  Private
exports.getBookingMessages = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 50 } = req.query;

  const messages = await Message.find({
    relatedBooking: req.params.bookingId,
    isDeleted: false
  })
    .populate('sender', 'name profilePhoto')
    .populate('receiver', 'name profilePhoto')
    .sort('-createdAt')
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

  const total = await Message.countDocuments({
    relatedBooking: req.params.bookingId,
    isDeleted: false
  });

  res.json(
    ApiResponse.paginated(messages.reverse(), page, limit, total, 'Booking messages retrieved')
  );
});

// @desc    Send message with attachment
// @route   POST /api/v1/messages/with-attachment
// @access  Private
exports.sendMessageWithAttachment = catchAsync(async (req, res, next) => {
  const { receiverId, messageText, relatedEventId, relatedBookingId } = req.body;

  if (!req.files || req.files.length === 0) {
    return next(new ApiError('No files uploaded', 400));
  }

  // Check if receiver exists
  const receiver = await User.findById(receiverId);
  if (!receiver) {
    return next(new ApiError('Receiver not found', 404));
  }

  const attachments = req.files.map(file => file.location || file.path);
  const messageType = req.files[0].mimetype.startsWith('image/') ? 'image' : 'file';

  const message = await Message.create({
    sender: req.user._id,
    receiver: receiverId,
    messageText: messageText || '',
    messageType,
    attachments,
    relatedEvent: relatedEventId,
    relatedBooking: relatedBookingId
  });

  await message.populate([
    { path: 'sender', select: 'name profilePhoto' },
    { path: 'receiver', select: 'name profilePhoto' }
  ]);

  // Send notification
  await Notification.createNotification({
    recipient: receiverId,
    type: 'message',
    title: 'New Message',
    message: `${req.user.name} sent you ${messageType === 'image' ? 'an image' : 'a file'}`,
    relatedUser: req.user._id,
    actionUrl: `/messages/${req.user._id}`
  });

  res.status(201).json(ApiResponse.success(message, 'Message sent successfully'));
});
