const Message = require('../models/Message');
const { emitToUser } = require('../socket');

const POPULATE = [
  { path: 'sender', select: 'name profilePhoto' },
  { path: 'receiver', select: 'name profilePhoto' }
];

/** Send a saved message to both participants' open tabs. */
exports.broadcast = (message) => {
  const plain = message.toJSON ? message.toJSON() : message;
  const ids = [message.sender._id || message.sender, message.receiver._id || message.receiver];
  for (const id of ids) emitToUser(id, 'new_message', plain);
};

/** Tell a sender that their messages to the reader have been read. */
exports.notifyRead = (senderId, readerId) => {
  emitToUser(senderId, 'messages_read', { readerId: readerId.toString(), at: new Date().toISOString() });
};

/**
 * Post a booking update into the chat between organizer and vendor, so the
 * conversation doubles as the booking's timeline. Never fails the caller.
 * @param {object} booking - Booking document (organizer and vendor as ids or docs)
 * @param {string|object} fromUserId - Who caused the update
 * @param {string} text - One-line summary shown on the card
 */
exports.postBookingUpdate = async (booking, fromUserId, text) => {
  try {
    const organizer = (booking.organizer._id || booking.organizer).toString();
    const vendor = (booking.vendor._id || booking.vendor).toString();
    const from = fromUserId.toString();
    const message = await Message.create({
      sender: from,
      receiver: from === vendor ? organizer : vendor,
      messageText: text,
      messageType: 'booking',
      relatedBooking: booking._id,
      relatedEvent: booking.event && (booking.event._id || booking.event)
    });
    await message.populate(POPULATE);
    exports.broadcast(message);
    return message;
  } catch (error) {
    console.error('Could not post booking update to chat:', error.message);
    return null;
  }
};

exports.POPULATE = POPULATE;
