const Booking = require('../models/Booking');
const User = require('../models/User');

// Bookings are for whole days in India; compare dates as IST calendar days
const dayKey = (date) => new Date(date).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const dayStart = (key) => new Date(`${key}T00:00:00+05:30`);
const isDayKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(dayStart(v));

// Vendors who can only be at one event at a time default to one booking a
// day; cakes and food can take many. 0 means no limit.
const DEFAULT_DAILY_CAPACITY = { decor: 1, photography: 1, music: 1, entertainment: 1, venue: 1, food: 0, cleanup: 0, other: 0 };
const ACCEPTED = ['confirmed', 'in_progress', 'completed'];

const capacityOf = (service) =>
  Number.isInteger(service.dailyCapacity) ? service.dailyCapacity : (DEFAULT_DAILY_CAPACITY[service.category] ?? 1);

const acceptedCount = (service, key, excludeBookingId) => Booking.countDocuments({
  service: service._id,
  status: { $in: ACCEPTED },
  eventDate: { $gte: dayStart(key), $lt: new Date(dayStart(key).getTime() + 864e5) },
  ...(excludeBookingId ? { _id: { $ne: excludeBookingId } } : {})
});

/**
 * Whether a service can take another booking on a date.
 * @returns {{available: boolean, reason?: 'paused'|'blocked'|'full', count: number, capacity: number}}
 */
exports.check = async (service, date, { excludeBookingId } = {}) => {
  const key = dayKey(date);
  const capacity = capacityOf(service);
  if (service.availability !== 'available') return { available: false, reason: 'paused', count: 0, capacity };
  const vendor = await User.findById(service.provider._id || service.provider).select('blockedDays').lean();
  // Per-service blackout dates are the older way of blocking a day
  const blockedOnService = typeof service.isBlackedOut === 'function' && service.isBlackedOut(date);
  if (blockedOnService || (vendor?.blockedDays || []).includes(key)) return { available: false, reason: 'blocked', count: 0, capacity };
  const count = capacity ? await acceptedCount(service, key, excludeBookingId) : 0;
  if (capacity && count >= capacity) return { available: false, reason: 'full', count, capacity };
  return { available: true, count, capacity };
};

/** Days in a range a service can't be booked, for date pickers (no booking details). */
exports.unavailableDays = async (service, fromKey, toKey) => {
  const vendor = await User.findById(service.provider._id || service.provider).select('blockedDays').lean();
  const blocked = (vendor?.blockedDays || []).filter(d => d >= fromKey && d <= toKey);
  const capacity = capacityOf(service);
  let full = [];
  if (capacity) {
    const rows = await Booking.aggregate([
      { $match: { service: service._id, status: { $in: ACCEPTED }, eventDate: { $gte: dayStart(fromKey), $lt: new Date(dayStart(toKey).getTime() + 864e5) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$eventDate', timezone: 'Asia/Kolkata' } }, n: { $sum: 1 } } }
    ]);
    full = rows.filter(r => r.n >= capacity).map(r => r._id);
  }
  return { blocked, full: full.filter(d => !blocked.includes(d)).sort() };
};

/** A vendor's own month: blocked days and how many bookings fall on each day. */
exports.vendorCalendar = async (vendorId, fromKey, toKey) => {
  const vendor = await User.findById(vendorId).select('blockedDays').lean();
  const bookings = await Booking.find({
    vendor: vendorId,
    status: { $in: ['pending', ...ACCEPTED] },
    eventDate: { $gte: dayStart(fromKey), $lt: new Date(dayStart(toKey).getTime() + 864e5) }
  }).populate('service', 'serviceName').populate('event', 'title').select('eventDate status service event').lean();

  const days = {};
  for (const b of bookings) {
    const key = dayKey(b.eventDate);
    (days[key] ||= []).push({ _id: b._id, status: b.status, service: b.service?.serviceName, event: b.event?.title });
  }
  return { blocked: (vendor?.blockedDays || []).filter(d => d >= fromKey && d <= toKey).sort(), days };
};

exports.dayKey = dayKey;
exports.isDayKey = isDayKey;
exports.capacityOf = capacityOf;
exports.DEFAULT_DAILY_CAPACITY = DEFAULT_DAILY_CAPACITY;
