const Booking = require('../models/Booking');
const Event = require('../models/Event');
const Notification = require('../models/Notification');
const checkoutService = require('../services/checkoutService');

const DAY = 24 * 60 * 60 * 1000;

// Organizers sometimes forget to mark things complete, which would leave
// vendors and ticket revenue unpaid forever. Close them out automatically.
const BOOKING_GRACE_DAYS = 3; // time for the organizer to raise a problem
const EVENT_GRACE_DAYS = 1;

const completeOverdueBookings = async (now = new Date()) => {
  const bookings = await Booking.find({
    status: { $in: ['confirmed', 'in_progress'] },
    eventDate: { $lt: new Date(now - BOOKING_GRACE_DAYS * DAY) }
  });

  for (const booking of bookings) {
    booking.status = 'completed';
    booking.completedAt = now;
    await booking.save();
    await checkoutService.releaseBookingPayouts(booking._id);

    const message = 'This booking was automatically marked complete after the event date.';
    for (const recipient of [booking.organizer, booking.vendor]) {
      await Notification.createNotification({
        recipient,
        type: 'booking',
        title: 'Booking Completed',
        message,
        relatedBooking: booking._id,
        actionUrl: `/bookings/${booking._id}`
      });
    }
  }
  return bookings.length;
};

const completePastEvents = async (now = new Date()) => {
  const events = await Event.find({
    status: { $in: ['draft', 'planning', 'active'] },
    date: { $lt: new Date(now - EVENT_GRACE_DAYS * DAY) }
  });

  for (const event of events) {
    event.status = 'completed';
    event.completedAt = now;
    await event.save();
    await checkoutService.releaseTicketPayouts(event._id);
  }
  return events.length;
};

const run = async () => {
  try {
    const [bookings, events] = await Promise.all([completeOverdueBookings(), completePastEvents()]);
    if (bookings || events) {
      console.log(`[auto-complete] ${bookings} booking(s), ${events} event(s) completed`);
    }
  } catch (error) {
    console.error('[auto-complete] failed:', error.message);
  }
};

// Runs shortly after boot, then hourly
const start = () => {
  setTimeout(run, 30 * 1000).unref();
  return setInterval(run, 60 * 60 * 1000).unref();
};

module.exports = { start, completeOverdueBookings, completePastEvents };
