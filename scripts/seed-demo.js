/* eslint-disable no-console */
// Demo data for trying Festivo end to end: every role, every booking and
// payment state, events of every kind, reviews, messages, notifications.
//
//   node scripts/seed-demo.js            # (re)create demo data
//   node scripts/seed-demo.js --remove   # delete all demo data
//
// Uses MONGODB_URI from the environment (or .env). Only touches accounts
// ending in @festivo.demo and records linked to them; real data is never
// modified. Re-running resets the demo set.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const {
  User, Event, Service, Booking, Task, RSVP, Message, Review, Notification, Payment, Image
} = require('../src/models');

const DOMAIN = '@festivo.demo';
const PASSWORD = 'Festivo@2026';
const DAY = 24 * 60 * 60 * 1000;
const at = (days, hour = 19) => {
  const d = new Date(Date.now() + days * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
};
let orderSeq = 0;
const orderId = () => `order_demo_${Date.now()}_${++orderSeq}`;

async function removeDemo() {
  const users = await User.find({ email: new RegExp(`${DOMAIN.replace('.', '\\.')}$`, 'i') }).select('_id');
  const ids = users.map(u => u._id);
  if (!ids.length) return 0;
  const events = await Event.find({ organizer: { $in: ids } }).select('_id');
  const eventIds = events.map(e => e._id);
  const services = await Service.find({ provider: { $in: ids } }).select('_id');
  const serviceIds = services.map(s => s._id);
  await Promise.all([
    Booking.deleteMany({ $or: [{ organizer: { $in: ids } }, { vendor: { $in: ids } }, { event: { $in: eventIds } }] }),
    Payment.deleteMany({ $or: [{ payer: { $in: ids } }, { payee: { $in: ids } }, { event: { $in: eventIds } }] }),
    Review.deleteMany({ $or: [{ reviewer: { $in: ids } }, { vendor: { $in: ids } }, { service: { $in: serviceIds } }] }),
    RSVP.deleteMany({ $or: [{ attendee: { $in: ids } }, { event: { $in: eventIds } }] }),
    Task.deleteMany({ $or: [{ event: { $in: eventIds } }, { createdBy: { $in: ids } }] }),
    Message.deleteMany({ $or: [{ sender: { $in: ids } }, { receiver: { $in: ids } }] }),
    Notification.deleteMany({ recipient: { $in: ids } }),
    Image.deleteMany({ owner: { $in: ids } })
  ]);
  await Event.deleteMany({ _id: { $in: eventIds } });
  await Service.deleteMany({ _id: { $in: serviceIds } });
  await User.deleteMany({ _id: { $in: ids } });
  return ids.length;
}

async function seedDemo() {
  // ---------- People ----------
  const person = (key, name, extra = {}) => User.create({
    email: `${key}${DOMAIN}`, password: PASSWORD, name, city: 'Pune',
    emailVerified: true, phoneVerified: !!extra.phone, ...extra
  });
  const admin = await person('admin', 'Festivo Admin', { role: 'admin', userType: 'all' });
  const rohit = await person('organizer', 'Rohit Sharma', { userType: 'organizer', phone: '9000000001', bio: 'Planning my 30th and a few community meetups.' });
  const priya = await person('vendor', 'Priya Desai', {
    userType: 'helper', phone: '9000000002', bio: 'Home baker, custom theme cakes since 2019.',
    payoutDetails: { method: 'upi', upiId: 'priya.desai@okaxis', updatedAt: new Date() }
  });
  const arjun = await person('photographer', 'Arjun Mehta', {
    userType: 'helper', phone: '9000000003',
    payoutDetails: { method: 'bank', accountHolderName: 'Arjun Mehta', accountNumber: '50100234567890', ifsc: 'HDFC0001234', updatedAt: new Date() }
  });
  const meera = await person('decorator', 'Meera Kulkarni', { userType: 'helper', phone: '9000000004' });
  const kabir = await person('dj', 'Kabir Singh', {
    userType: 'helper', phone: '9000000005',
    payoutDetails: { method: 'upi', upiId: 'kabir.dj@ybl', updatedAt: new Date() }
  });
  const neha = await person('both', 'Neha Joshi', { userType: 'all', phone: '9000000006', bio: 'I run a rooftop venue and host events there.' });
  const asha = await person('attendee', 'Asha Nair', { userType: 'attendee' });
  const vikram = await person('guest', 'Vikram Rao', { userType: 'attendee' });

  // ---------- Vendor listings ----------
  const svc = (provider, data) => Service.create({ provider: provider._id, city: 'Pune', priceUnit: 'per_event', ...data });
  const cakes = await svc(priya, {
    serviceName: "Priya's Designer Cakes", category: 'food', basePrice: 1800, isVerified: true, verifiedAt: new Date(),
    description: 'Custom theme cakes for birthdays, anniversaries and baby showers. Eggless options, fondant or fresh cream, delivered across Pune.',
    serviceAreas: ['Koregaon Park', 'Kalyani Nagar', 'Viman Nagar', 'Baner'], tags: ['cake', 'birthday', 'eggless'], businessName: 'Priya Bakes'
  });
  const photo = await svc(arjun, {
    serviceName: 'Arjun Mehta Photography', category: 'photography', basePrice: 5000, isVerified: true, verifiedAt: new Date(),
    description: 'Candid event photography. 3 hours of coverage and 300+ edited photos delivered within 5 days.',
    serviceAreas: ['Pune'], tags: ['candid', 'birthday', 'corporate']
  });
  const decor = await svc(meera, {
    serviceName: 'Balloon & Floral Decor by Meera', category: 'decor', basePrice: 3500,
    description: 'Balloon arches, floral backdrops and table styling for home parties. Setup and cleanup included.',
    serviceAreas: ['Aundh', 'Baner', 'Wakad'], tags: ['balloons', 'backdrop']
  });
  const dj = await svc(kabir, {
    serviceName: 'DJ Kabir — Bollywood & House', category: 'music', basePrice: 1500, priceUnit: 'per_hour', isVerified: true, verifiedAt: new Date(),
    description: 'Sound system and lights included. Bollywood, retro and house sets for house parties and sangeets.',
    tags: ['dj', 'sangeet', 'party']
  });
  const venue = await svc(neha, {
    serviceName: 'Skyline Rooftop Venue', category: 'venue', basePrice: 12000, priceUnit: 'per_day',
    description: 'Open-air rooftop in Kalyani Nagar for up to 80 guests, with a covered bar area and city views.',
    tags: ['rooftop', 'venue'], businessName: 'Skyline Spaces'
  });
  await svc(priya, {
    serviceName: 'Party Snack Platters', category: 'food', basePrice: 250, priceUnit: 'per_person',
    description: 'Finger food platters for 10–60 guests: mini sandwiches, kebabs, chaat cups and desserts.',
    tags: ['catering', 'snacks']
  });

  // ---------- Events ----------
  const ev = (organizer, data) => Event.create({
    organizer: organizer._id, city: 'Pune', time: '19:00', expectedGuests: 30, ...data
  });
  const birthday = await ev(rohit, {
    title: "Rohit's 30th Birthday", eventType: 'birthday', date: at(20), status: 'planning', isPublic: false, isPublished: true,
    description: 'Dinner and dancing with close friends and family. Smart casuals!', locationName: 'Skyline Rooftop', address: 'Lane 7, Kalyani Nagar', budget: 40000, expectedGuests: 35
  });
  const mixer = await ev(rohit, {
    title: 'Pune Startup Mixer', eventType: 'meetup', date: at(10, 18), time: '18:30', status: 'active', isPublic: true, isPublished: true, publishedAt: new Date(),
    description: 'Monthly meetup for founders, designers and engineers. Short demos, then open networking.', locationName: 'The Hive Coworking', address: 'Baner Road, Baner', maxAttendees: 60, tags: ['startups', 'networking']
  });
  const rooftop = await ev(neha, {
    title: 'Sunset Rooftop Party', eventType: 'house_party', date: at(12), status: 'active', isPublic: true, isPublished: true, publishedAt: new Date(),
    entryFee: 499, isPaid: true, maxAttendees: 80,
    description: 'Music, food and the best sunset in town. Ticket includes two drinks.', locationName: 'Skyline Rooftop Venue', address: 'Lane 7, Kalyani Nagar'
  });
  const diwali = await ev(neha, {
    title: 'Diwali Community Get-together', eventType: 'other', date: at(30, 17), time: '17:00', status: 'active', isPublic: true, isPublished: true, publishedAt: new Date(),
    description: 'Rangoli, snacks and lanterns for the whole society. Kids welcome.', locationName: 'Green Valley Society Lawn', address: 'Wakad', expectedGuests: 120
  });
  const anniversary = await ev(rohit, {
    title: "Parents' 35th Anniversary Dinner", eventType: 'other', date: at(-10), status: 'completed', completedAt: at(-9), isPublic: false, isPublished: true,
    description: 'Surprise dinner for Mom and Dad.', locationName: 'Home', address: 'Koregaon Park', expectedGuests: 25
  });
  const bbq = await ev(rohit, {
    title: 'Monsoon BBQ', eventType: 'house_party', date: at(5), status: 'cancelled', isPublic: true, isPublished: false,
    description: 'Cancelled because of heavy rain warnings.', locationName: 'Terrace', address: 'Aundh'
  });
  await ev(rohit, {
    title: 'Office Farewell for Sana', eventType: 'farewell', date: at(25, 16), time: '16:00', status: 'draft', isPublic: false, isPublished: false,
    description: 'Draft: cake, card and a short speech.', locationName: 'Office cafeteria', address: 'Hinjewadi Phase 1'
  });

  // ---------- Planning checklist ----------
  const tasks = [
    ['Book the venue', 'venue', 'done'], ['Order the cake', 'catering', 'in_progress'], ['Balloon decor', 'decoration', 'pending'],
    ['Send invites on WhatsApp', 'guest_management', 'done'], ['Book a photographer', 'photography', 'pending']
  ];
  for (const [taskName, category, status] of tasks) {
    await Task.create({ event: birthday._id, createdBy: rohit._id, taskName, category, status, priority: 'medium', dueDate: at(15) });
  }

  // ---------- Bookings in every state ----------
  const pay = async (booking, amount, payoutStatus = 'not_due', extra = {}) => {
    const p = new Payment({
      kind: 'booking', booking: booking._id, event: booking.event, payer: booking.organizer, payee: booking.vendor,
      amount, feePercent: 15, razorpayOrderId: orderId(), razorpayPaymentId: `pay_demo_${orderSeq}`,
      status: 'paid', paidAt: new Date(Date.now() - 2 * DAY), payoutStatus, ...extra
    });
    p.recalculateSplit();
    if (payoutStatus !== 'not_applicable') p.payoutStatus = payoutStatus;
    await p.save();
    booking.payments.push({ amount, paymentMethod: 'razorpay', transactionId: p.razorpayPaymentId, notes: 'Paid online through Festivo', paidAt: p.paidAt });
    return p;
  };
  const totals = (b) => {
    const paid = b.payments.reduce((s, x) => s + x.amount, 0);
    b.totalPaid = paid; b.pricePaid = paid - (b.refundedAmount || 0);
    b.paymentStatus = b.refundedAmount && b.pricePaid <= 0 ? 'refunded' : b.pricePaid >= b.priceAgreed ? 'paid' : b.pricePaid > 0 ? 'partial' : 'unpaid';
  };
  const book = (organizer, service, event, data) => Booking.create({
    organizer: organizer._id, vendor: service.provider, service: service._id, event: event._id, eventDate: event.date, ...data
  });

  // 1. New request waiting for the vendor's quote
  await book(rohit, decor, birthday, { priceAgreed: 3500, status: 'pending', requirements: 'Pastel balloon arch at the entrance and a "30" backdrop.' });
  // 2. Confirmed at a quote, organizer still needs to pay
  await book(rohit, cakes, birthday, { priceAgreed: 2200, status: 'confirmed', requirements: 'Chocolate truffle, 2 kg, eggless, "Happy 30th Rohit".' });
  // 3. Confirmed with a 30% advance paid online
  const photoBooking = await book(rohit, photo, mixer, { priceAgreed: 5000, status: 'confirmed', requirements: 'Candids of the demos and group photo at 8 pm.' });
  await pay(photoBooking, 1500); totals(photoBooking); await photoBooking.save();
  // 4. Completed, paid, payout due (admin queue)
  const djBooking = await book(rohit, dj, anniversary, { priceAgreed: 4500, status: 'completed', completedAt: at(-9) });
  await pay(djBooking, 4500, 'pending'); totals(djBooking); await djBooking.save();
  // 5. Completed, paid, payout already sent
  const cakeDone = await book(rohit, cakes, anniversary, { priceAgreed: 2000, status: 'completed', completedAt: at(-9) });
  await pay(cakeDone, 2000, 'paid', { payoutReference: 'UTR4521987730', paidOutAt: at(-7), paidOutBy: admin._id }); totals(cakeDone); await cakeDone.save();
  // 6. Cancelled by the vendor, refunded in full
  const venueBooking = await book(rohit, venue, bbq, {
    priceAgreed: 12000, status: 'cancelled', cancelledBy: neha._id, cancelledAt: at(-1), cancellationReason: 'Venue under maintenance that weekend'
  });
  const refunded = await pay(venueBooking, 12000, 'not_applicable', { status: 'refunded', refundedAmount: 12000, refunds: [{ razorpayRefundId: 'rfnd_demo_1', amount: 12000, reason: 'Booking cancelled by vendor' }] });
  refunded.recalculateSplit(); await refunded.save();
  venueBooking.refundedAmount = 12000; totals(venueBooking); await venueBooking.save();
  // 7. Neha (organizer + vendor) books a photographer for her event
  await book(neha, photo, diwali, { priceAgreed: 6000, status: 'pending', requirements: 'Family portraits near the rangoli, 5–7 pm.' });

  // ---------- Reviews ----------
  await Review.create({
    booking: djBooking._id, service: dj._id, vendor: kabir._id, reviewer: rohit._id, event: anniversary._id, rating: 5,
    reviewText: 'Kabir read the room perfectly. Retro songs for my parents, then Bollywood for everyone else. Highly recommend.',
    ratings: { quality: 5, punctuality: 5, professionalism: 5, valueForMoney: 4 }
  });
  await Review.create({
    booking: cakeDone._id, service: cakes._id, vendor: priya._id, reviewer: rohit._id, event: anniversary._id, rating: 4,
    reviewText: 'Beautiful cake and it tasted great. Delivery was 20 minutes late but Priya kept me updated.',
    ratings: { quality: 5, punctuality: 3, professionalism: 4, valueForMoney: 4 },
    vendorResponse: 'Thank you Rohit! Sorry about the traffic, I will plan extra buffer next time.', respondedAt: at(-6)
  });

  // ---------- RSVPs and tickets ----------
  const rsvp = (attendee, event, data = {}) => RSVP.create({ attendee: attendee._id, event: event._id, status: 'going', ...data });
  await rsvp(asha, birthday, { guestsCount: 1 });
  await rsvp(vikram, birthday, { status: 'maybe' });
  await rsvp(asha, mixer);
  await rsvp(vikram, mixer, { guestsCount: 1 });
  await rsvp(priya, mixer);
  const ashaTicket = await rsvp(asha, rooftop, { guestsCount: 1, paymentStatus: 'paid', amountPaid: 998, razorpayPaymentId: 'pay_demo_ticket' });
  const ticketPayment = new Payment({
    kind: 'ticket', rsvp: ashaTicket._id, event: rooftop._id, payer: asha._id, payee: neha._id, amount: 998, feePercent: 5,
    razorpayOrderId: orderId(), razorpayPaymentId: 'pay_demo_ticket', status: 'paid', paidAt: at(-1)
  });
  ticketPayment.recalculateSplit(); await ticketPayment.save();
  await rsvp(vikram, rooftop, { status: 'pending_payment' });
  await rsvp(asha, anniversary, { checkedIn: true, checkedInAt: at(-10), attended: true });
  await rsvp(asha, diwali);

  // ---------- Messages ----------
  const msg = (from, to, messageText, minutesAgo, isRead = true) => Message.create({
    sender: from._id, receiver: to._id, messageText, isRead, createdAt: new Date(Date.now() - minutesAgo * 60000)
  });
  await msg(rohit, priya, 'Hi Priya! Can you do an eggless chocolate truffle for 35 people?', 300);
  await msg(priya, rohit, 'Yes, 2 kg works for 35. I can add a fondant "30" topper for ₹200 extra.', 280);
  await msg(rohit, priya, 'Perfect, please include the topper.', 270);
  await msg(priya, rohit, 'Done! I have confirmed the booking at ₹2,200. You can pay from the booking page.', 260, false);
  await msg(rohit, meera, 'Hi Meera, sent you a request for balloon decor on the 30th birthday.', 120);
  await msg(meera, rohit, 'Got it! Do you have a colour theme in mind?', 90, false);
  await msg(asha, neha, 'Is there parking at the rooftop venue?', 60);
  await msg(neha, asha, 'Yes, the building has visitor parking. Show your ticket at the gate.', 45, false);

  // ---------- Notifications ----------
  const note = (user, type, title, message, actionUrl, isRead = false) =>
    Notification.create({ recipient: user._id, type, title, message, actionUrl, isRead });
  await note(rohit, 'booking', 'Booking confirmed', 'Priya confirmed your cake booking at ₹2,200. You can now pay securely.', '/bookings');
  await note(rohit, 'message', 'New message from Meera', 'Do you have a colour theme in mind?', `/messages/${meera._id}`);
  await note(rohit, 'rsvp', 'New RSVP', 'Asha Nair is coming to Pune Startup Mixer', `/events/${mixer._id}`, true);
  await note(priya, 'payment', 'Payout sent', '₹1,700 has been sent to your UPI (ref UTR4521987730)', '/dashboard/earnings');
  await note(priya, 'review', 'New review', 'Rohit Sharma left a 4-star review for your cakes', `/services/${cakes._id}`);
  await note(meera, 'booking', 'New booking request', 'Rohit Sharma wants balloon decor for a birthday. Send your quote.', '/bookings');
  await note(arjun, 'payment', 'Advance received', '₹1,500 advance was paid online. Festivo holds it until the event is done.', '/bookings');
  await note(kabir, 'review', 'New 5-star review', 'Rohit Sharma left you a 5-star review', `/services/${dj._id}`);
  await note(asha, 'rsvp', 'Ticket confirmed', 'Your ticket for Sunset Rooftop Party is confirmed. Check-in code is on the event page.', `/events/${rooftop._id}`);
  await note(vikram, 'rsvp', 'Complete your ticket', 'Your ticket for Sunset Rooftop Party is reserved. Pay to confirm it.', `/events/${rooftop._id}`);
  await note(neha, 'rsvp', 'Ticket sold', 'A ticket for Sunset Rooftop Party was purchased (₹998)', `/events/${rooftop._id}`);
  await note(admin, 'system', 'Vendor awaiting verification', 'Balloon & Floral Decor by Meera is waiting for review', '/admin');

  // Organizer stats used on profiles
  await User.updateOne({ _id: rohit._id }, { eventsOrganized: 5 });
  await User.updateOne({ _id: neha._id }, { eventsOrganized: 2 });
}

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const host = mongoose.connection.host;
  const removed = await removeDemo();
  if (removed) console.log(`Removed existing demo data (${removed} demo accounts) from ${host}`);
  if (process.argv.includes('--remove')) {
    console.log('Demo data removed.');
  } else {
    await seedDemo();
    console.log(`Demo data created on ${host}. Password for every demo account: ${PASSWORD}`);
  }
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error('Seeding failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
