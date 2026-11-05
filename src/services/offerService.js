const Offer = require('../models/Offer');
const Event = require('../models/Event');
const Service = require('../models/Service');
const Booking = require('../models/Booking');
const User = require('../models/User');
const Notification = require('../models/Notification');
const availability = require('./availabilityService');
const chatService = require('./chatService');
const policies = require('../config/policies');
const ApiError = require('../utils/apiError');

const CATEGORIES = ['food', 'decor', 'photography', 'music', 'cleanup', 'entertainment', 'venue', 'other'];
// Offers one vendor can send in 24 hours, so organizers aren't flooded
const DAILY_OFFER_LIMIT = 10;
const DAY = 24 * 60 * 60 * 1000;

const prettyDay = (date) => new Date(date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const startOfToday = () => new Date(`${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}T00:00:00+05:30`);
const isUpcoming = (event) => !['cancelled', 'completed'].includes(event.status) && new Date(event.date) >= startOfToday();
const isOrganizer = (event, user) => event.organizer.toString() === user._id.toString();

/**
 * Organizer opens or closes their event to vendor offers
 * @param {object} settings - { open, needs: [category], note }
 */
exports.updateSettings = async (event, user, { open, needs, note }) => {
  if (!isOrganizer(event, user)) {
    throw new ApiError('Only the organizer can change this', 403);
  }
  if (open && !isUpcoming(event)) {
    throw new ApiError('Only upcoming events can get offers', 400);
  }
  const wanted = Array.isArray(needs) ? [...new Set(needs)] : [];
  if (wanted.some(n => !CATEGORIES.includes(n))) {
    throw new ApiError('Unknown service type', 400);
  }
  event.vendorOffers = {
    open: !!open,
    needs: wanted,
    note: typeof note === 'string' ? note.trim().slice(0, 300) : undefined
  };
  await event.save();
  return event.vendorOffers;
};

/**
 * Events open to offers that match the vendor's listings: same city, and
 * asking for one of their service types (or for anything). Only what a
 * vendor needs to decide is returned; never the organizer or address.
 */
exports.leads = async (vendor) => {
  const services = await Service.find({ provider: vendor._id, isActive: true }).select('serviceName category city basePrice priceUnit');
  if (!services.length) return { services: [], leads: [] };

  const cities = [...new Set(services.map(s => s.city))];
  const categories = [...new Set(services.map(s => s.category))];
  const events = await Event.find({
    'vendorOffers.open': true,
    status: { $nin: ['cancelled', 'completed'] },
    date: { $gte: startOfToday() },
    organizer: { $ne: vendor._id },
    city: { $in: cities },
    $or: [{ 'vendorOffers.needs': { $size: 0 } }, { 'vendorOffers.needs': { $in: categories } }]
  }).sort('date').limit(50).select('title isPublic eventType date time city expectedGuests vendorOffers');

  const sent = await Offer.find({ vendor: vendor._id, event: { $in: events.map(e => e._id) } }).select('event service status price');

  const leads = events.map(e => ({
    _id: e._id,
    // Private events don't show their title, which can name the guest of honour
    title: e.isPublic ? e.title : undefined,
    eventType: e.eventType,
    date: e.date,
    time: e.time,
    city: e.city,
    expectedGuests: e.expectedGuests,
    needs: e.vendorOffers.needs,
    note: e.vendorOffers.note,
    myOffers: sent.filter(o => o.event.equals(e._id)).map(o => ({ _id: o._id, service: o.service, status: o.status, price: o.price }))
  }));
  return { services, leads };
};

/**
 * Vendor offers one of their services for an event
 */
exports.create = async (vendor, { eventId, serviceId, price, message }) => {
  const text = typeof message === 'string' ? message.trim() : '';
  if (text.length < 10 || text.length > 500) {
    throw new ApiError('Write a short message (10 to 500 characters) about what you\'ll do', 400);
  }
  const amount = Number(price);
  if (!Number.isFinite(amount) || amount < 1) {
    throw new ApiError('Enter your price', 400);
  }

  const [event, service] = await Promise.all([Event.findById(eventId), Service.findById(serviceId)]);
  if (!service || !service.provider.equals(vendor._id) || !service.isActive) {
    throw new ApiError('Choose one of your listed services', 400);
  }
  if (!event || !event.vendorOffers?.open || !isUpcoming(event)) {
    throw new ApiError('This event is no longer taking offers', 400);
  }
  if (event.organizer.equals(vendor._id)) {
    throw new ApiError('This is your own event', 400);
  }
  const needs = event.vendorOffers.needs || [];
  if (needs.length && !needs.includes(service.category)) {
    throw new ApiError('The organizer isn\'t looking for this kind of service', 400);
  }

  if (await Offer.exists({ event: event._id, service: service._id, status: { $in: ['pending', 'accepted'] } })) {
    throw new ApiError('You already offered this service for this event', 400);
  }
  if (await Booking.exists({ event: event._id, service: service._id, status: { $nin: ['cancelled', 'refunded'] } })) {
    throw new ApiError('The organizer already has a booking with this service', 400);
  }
  const recent = await Offer.countDocuments({ vendor: vendor._id, createdAt: { $gte: new Date(Date.now() - DAY) } });
  if (recent >= DAILY_OFFER_LIMIT) {
    throw new ApiError(`You can send ${DAILY_OFFER_LIMIT} offers a day. Try again tomorrow.`, 429);
  }
  const open = await availability.check(service, event.date);
  if (!open.available) {
    throw new ApiError(`You're not available on ${prettyDay(event.date)} (check your calendar)`, 409);
  }

  const offer = await Offer.create({
    event: event._id, service: service._id, vendor: vendor._id, organizer: event.organizer, price: amount, message: text
  });
  await Notification.createNotification({
    recipient: event.organizer,
    type: 'booking',
    title: 'New Offer',
    message: `${service.serviceName} offered to do your ${event.title} on ${prettyDay(event.date)} for ₹${amount.toLocaleString('en-IN')}.`,
    relatedEvent: event._id,
    actionUrl: `/events/${event.slug || event._id}?tab=offers`
  });
  return offer;
};

// Offers on an event, for its organizer
exports.forEvent = async (event, user) => {
  if (!isOrganizer(event, user)) {
    throw new ApiError('Only the organizer can see offers', 403);
  }
  return Offer.find({ event: event._id, status: { $ne: 'withdrawn' } })
    .sort('-createdAt')
    .populate('service', 'serviceName slug category coverImage ratingAverage totalRatings isVerified noShowCount')
    .populate('vendor', 'name profilePhoto');
};

// Offers a vendor sent, newest first
exports.mine = async (vendor) => Offer.find({ vendor: vendor._id })
  .sort('-createdAt')
  .limit(100)
  .populate('service', 'serviceName')
  .populate('event', 'eventType date city');

/**
 * Organizer accepts: a confirmed booking at the offered price. Fees follow
 * the usual rules; a vendor who found the event on Festivo is a new customer.
 */
exports.accept = async (offer, organizer) => {
  if (!offer.organizer.equals(organizer._id)) {
    throw new ApiError('Only the organizer can accept this offer', 403);
  }
  if (offer.status !== 'pending') {
    throw new ApiError('This offer was already answered or withdrawn', 400);
  }
  const [event, service] = await Promise.all([Event.findById(offer.event), Service.findById(offer.service)]);
  if (!event || !isUpcoming(event)) {
    throw new ApiError('This event has passed or was cancelled', 400);
  }
  if (!service || !service.isActive) {
    throw new ApiError('This service is no longer listed', 400);
  }
  if (await Booking.exists({ event: event._id, service: service._id, status: { $nin: ['cancelled', 'refunded'] } })) {
    throw new ApiError('You already have a booking with this service for this event', 400);
  }
  const open = await availability.check(service, event.date);
  if (!open.available) {
    throw new ApiError(`${service.serviceName} is no longer free on ${prettyDay(event.date)}`, 409);
  }

  const earlier = await Booking.findOne({ organizer: organizer._id, vendor: offer.vendor }).sort('createdAt').select('source');
  const source = earlier ? earlier.source : 'marketplace';
  const vendor = await User.findById(offer.vendor).select('foundingVendor');
  const foundingTerms = !!(vendor && vendor.foundingVendor && policies.foundingOpen());

  const booking = await Booking.create({
    event: event._id,
    service: service._id,
    organizer: organizer._id,
    vendor: offer.vendor,
    eventDate: event.date,
    priceAgreed: offer.price,
    status: 'confirmed',
    source,
    foundingTerms,
    feePercent: policies.bookingFeePercent({ source, founding: foundingTerms }),
    notes: `From the vendor's offer: ${offer.message}`
  });

  offer.status = 'accepted';
  offer.booking = booking._id;
  offer.respondedAt = new Date();
  await offer.save();

  await Notification.createNotification({
    recipient: offer.vendor,
    type: 'booking',
    title: 'Offer Accepted',
    message: `Your offer of ${service.serviceName} for ${prettyDay(event.date)} at ₹${offer.price.toLocaleString('en-IN')} was accepted. It's now a confirmed booking.`,
    relatedBooking: booking._id,
    actionUrl: `/bookings/${booking._id}`
  });
  await chatService.postBookingUpdate(booking, organizer._id, `Accepted your offer: ${service.serviceName} at ₹${offer.price}.`);
  return { offer, booking };
};

exports.decline = async (offer, organizer) => {
  if (!offer.organizer.equals(organizer._id)) {
    throw new ApiError('Only the organizer can decline this offer', 403);
  }
  if (offer.status !== 'pending') {
    throw new ApiError('This offer was already answered or withdrawn', 400);
  }
  offer.status = 'declined';
  offer.respondedAt = new Date();
  await offer.save();
  const service = await Service.findById(offer.service).select('serviceName');
  await Notification.createNotification({
    recipient: offer.vendor,
    type: 'booking',
    title: 'Offer Declined',
    message: `The organizer passed on your offer of ${service ? service.serviceName : 'your service'}.`,
    actionUrl: '/dashboard/find-events'
  });
  return offer;
};

exports.withdraw = async (offer, vendor) => {
  if (!offer.vendor.equals(vendor._id)) {
    throw new ApiError('You can only withdraw your own offers', 403);
  }
  if (offer.status !== 'pending') {
    throw new ApiError('Only offers waiting for an answer can be withdrawn', 400);
  }
  offer.status = 'withdrawn';
  await offer.save();
  return offer;
};
