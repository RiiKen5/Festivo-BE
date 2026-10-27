const crypto = require('crypto');
const request = require('supertest');
const app = require('../../src/app');
const paymentService = require('../../src/services/paymentService');
const Booking = require('../../src/models/Booking');
const Payment = require('../../src/models/Payment');
const RSVP = require('../../src/models/RSVP');
const Event = require('../../src/models/Event');
const Service = require('../../src/models/Service');
const { connect, clear, disconnect, createUser, createEvent, createService, auth } = require('../helpers');

const DAY = 24 * 60 * 60 * 1000;

const sign = (orderId, paymentId) => crypto
  .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
  .update(`${orderId}|${paymentId}`)
  .digest('hex');

let orderSeq = 0;
let refunds;

beforeAll(connect);
afterAll(disconnect);

beforeEach(() => {
  refunds = [];
  jest.spyOn(paymentService, 'createOrder').mockImplementation(async (amount) => {
    orderSeq += 1;
    return { id: `order_${orderSeq}`, amount: amount * 100 };
  });
  jest.spyOn(paymentService, 'refund').mockImplementation(async (paymentId, amount) => {
    refunds.push({ paymentId, amount });
    return { id: `rfnd_${refunds.length}` };
  });
});

afterEach(async () => {
  jest.restoreAllMocks();
  await clear();
});

// Organizer books a vendor, vendor confirms (optionally at a quoted price)
const confirmedBooking = async ({ daysAway = 30, quote } = {}) => {
  const organizer = await createUser();
  const vendor = await createUser();
  const event = await createEvent(organizer.user, { date: new Date(Date.now() + daysAway * DAY) });
  const service = await createService(vendor.user, { basePrice: 10000 });

  const created = await request(app).post('/api/v1/bookings').set(auth(organizer.token))
    .send({ eventId: event._id, serviceId: service._id });
  expect(created.status).toBe(201);

  const confirmed = await request(app).post(`/api/v1/bookings/${created.body.data._id}/confirm`)
    .set(auth(vendor.token)).send(quote !== undefined ? { priceAgreed: quote } : {});
  expect(confirmed.status).toBe(200);

  return { organizer, vendor, event, service, bookingId: created.body.data._id };
};

const payBooking = async (token, bookingId, amount) => {
  const order = await request(app).post(`/api/v1/payments/bookings/${bookingId}/order`)
    .set(auth(token)).send(amount !== undefined ? { amount } : {});
  expect(order.status).toBe(201);
  const { orderId } = order.body.data;
  const paymentId = `pay_${orderId}`;
  const verify = await request(app).post('/api/v1/payments/verify').set(auth(token)).send({
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: sign(orderId, paymentId)
  });
  return { order, verify, orderId, paymentId };
};

describe('booking payments', () => {
  it('runs the full flow: quote, pay online, commission split, payout on completion', async () => {
    const { organizer, vendor, bookingId } = await confirmedBooking({ quote: 12000 });

    const { verify } = await payBooking(organizer.token, bookingId);
    expect(verify.status).toBe(200);

    let booking = await Booking.findById(bookingId);
    expect(booking.priceAgreed).toBe(12000);
    expect(booking.paymentStatus).toBe('paid');
    expect(booking.pricePaid).toBe(12000);

    let payment = await Payment.findOne({ booking: bookingId });
    expect(payment.platformFee).toBe(1000); // 10% of 12,000 capped at ₹1,000
    expect(payment.payeeAmount).toBe(11000);
    expect(payment.payoutStatus).toBe('not_due');

    const earnings = await request(app).get('/api/v1/payments/mine?role=payee').set(auth(vendor.token));
    expect(earnings.body.summary).toEqual({ held: 11000, payoutDue: 0, paidOut: 0 });

    await request(app).post(`/api/v1/bookings/${bookingId}/complete`).set(auth(organizer.token)).expect(200);
    payment = await Payment.findById(payment._id);
    expect(payment.payoutStatus).toBe('pending');
  });

  it('supports an advance payment followed by the balance', async () => {
    const { organizer, bookingId } = await confirmedBooking();

    await payBooking(organizer.token, bookingId, 3000);
    let booking = await Booking.findById(bookingId);
    expect(booking.paymentStatus).toBe('partial');

    const tooMuch = await request(app).post(`/api/v1/payments/bookings/${bookingId}/order`)
      .set(auth(organizer.token)).send({ amount: 8000 });
    expect(tooMuch.status).toBe(400);

    await payBooking(organizer.token, bookingId);
    booking = await Booking.findById(bookingId);
    expect(booking.paymentStatus).toBe('paid');
    expect(booking.pricePaid).toBe(10000);
  });

  it('applies a payment only once even if verify and webhook both arrive', async () => {
    const { organizer, bookingId } = await confirmedBooking();
    const { orderId, paymentId } = await payBooking(organizer.token, bookingId);

    const body = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: paymentId, order_id: orderId } } }
    });
    const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
    const hook = await request(app).post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json').set('X-Razorpay-Signature', signature).send(body);
    expect(hook.status).toBe(200);

    const booking = await Booking.findById(bookingId);
    expect(booking.payments).toHaveLength(1);
    expect(booking.pricePaid).toBe(10000);
  });

  it('webhook alone completes a payment when the browser never verifies', async () => {
    const { organizer, bookingId } = await confirmedBooking();
    const order = await request(app).post(`/api/v1/payments/bookings/${bookingId}/order`).set(auth(organizer.token));
    const { orderId } = order.body.data;

    const body = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_hook', order_id: orderId } } }
    });
    const bad = await request(app).post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json').set('X-Razorpay-Signature', 'forged').send(body);
    expect(bad.status).toBe(400);

    const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
    await request(app).post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json').set('X-Razorpay-Signature', signature).send(body).expect(200);

    expect((await Booking.findById(bookingId)).paymentStatus).toBe('paid');
  });

  it('rejects forged signatures and payments for other users', async () => {
    const { organizer, bookingId } = await confirmedBooking();
    const stranger = await createUser();
    const order = await request(app).post(`/api/v1/payments/bookings/${bookingId}/order`).set(auth(organizer.token));
    const { orderId } = order.body.data;

    const forged = await request(app).post('/api/v1/payments/verify').set(auth(organizer.token)).send({
      razorpay_order_id: orderId, razorpay_payment_id: 'pay_x', razorpay_signature: 'deadbeef'
    });
    expect(forged.status).toBe(400);

    const notMine = await request(app).post('/api/v1/payments/verify').set(auth(stranger.token)).send({
      razorpay_order_id: orderId, razorpay_payment_id: 'pay_x', razorpay_signature: sign(orderId, 'pay_x')
    });
    expect(notMine.status).toBe(404);
    expect((await Booking.findById(bookingId)).paymentStatus).toBe('unpaid');
  });

  it('cannot be paid before the vendor confirms, and organizers cannot self-report payment', async () => {
    const organizer = await createUser();
    const vendor = await createUser();
    const event = await createEvent(organizer.user);
    const service = await createService(vendor.user);
    const created = await request(app).post('/api/v1/bookings').set(auth(organizer.token))
      .send({ eventId: event._id, serviceId: service._id });

    const early = await request(app).post(`/api/v1/payments/bookings/${created.body.data._id}/order`).set(auth(organizer.token));
    expect(early.status).toBe(400);

    const selfReport = await request(app).post(`/api/v1/bookings/${created.body.data._id}/payment`)
      .set(auth(organizer.token)).send({ amount: 2000, paymentMethod: 'cash' });
    expect(selfReport.status).toBe(404);
  });

  it('returns 503 when Razorpay is not configured', async () => {
    const { organizer, bookingId } = await confirmedBooking();
    const saved = process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_ID;
    try {
      const res = await request(app).post(`/api/v1/payments/bookings/${bookingId}/order`).set(auth(organizer.token));
      expect(res.status).toBe(503);
    } finally {
      process.env.RAZORPAY_KEY_ID = saved;
    }
  });
});

describe('booking cancellation refunds', () => {
  it('refunds in full when the vendor cancels', async () => {
    const { organizer, vendor, bookingId } = await confirmedBooking({ daysAway: 1 });
    await payBooking(organizer.token, bookingId);

    const res = await request(app).post(`/api/v1/bookings/${bookingId}/cancel`).set(auth(vendor.token)).send({ reason: 'Sick' });
    expect(res.status).toBe(200);
    expect(refunds).toEqual([{ paymentId: expect.any(String), amount: 10000 }]);

    const booking = await Booking.findById(bookingId);
    expect(booking.paymentStatus).toBe('refunded');
    expect((await Payment.findOne({ booking: bookingId })).payoutStatus).toBe('not_applicable');
  });

  it('refunds half when the organizer cancels 2-7 days out, and the vendor keeps the rest', async () => {
    const { organizer, bookingId } = await confirmedBooking({ daysAway: 4 });
    await payBooking(organizer.token, bookingId);

    await request(app).post(`/api/v1/bookings/${bookingId}/cancel`).set(auth(organizer.token)).expect(200);
    expect(refunds[0].amount).toBe(5000);

    const payment = await Payment.findOne({ booking: bookingId });
    expect(payment.status).toBe('partially_refunded');
    expect(payment.platformFee).toBe(500);
    expect(payment.payeeAmount).toBe(4500);
    expect(payment.payoutStatus).toBe('pending');
  });

  it('refunds nothing when the organizer cancels within 48 hours', async () => {
    const { organizer, bookingId } = await confirmedBooking({ daysAway: 1 });
    await payBooking(organizer.token, bookingId);
    await request(app).post(`/api/v1/bookings/${bookingId}/cancel`).set(auth(organizer.token)).expect(200);
    expect(refunds).toHaveLength(0);
  });
});

describe('booking availability', () => {
  it('rejects bookings on blacked-out dates and for your own service', async () => {
    const organizer = await createUser();
    const vendor = await createUser();
    const event = await createEvent(organizer.user);
    const service = await createService(vendor.user, { blackoutDates: [event.date] });

    const blocked = await request(app).post('/api/v1/bookings').set(auth(organizer.token))
      .send({ eventId: event._id, serviceId: service._id });
    expect(blocked.status).toBe(409);

    const own = await createService(organizer.user);
    const self = await request(app).post('/api/v1/bookings').set(auth(organizer.token))
      .send({ eventId: event._id, serviceId: own._id });
    expect(self.status).toBe(400);
  });

  it('vendors cannot verify or rate their own service', async () => {
    const vendor = await createUser();
    const service = await createService(vendor.user);
    await request(app).put(`/api/v1/services/${service._id}`).set(auth(vendor.token))
      .send({ isVerified: true, ratingAverage: 5, basePrice: 2500 }).expect(200);
    const stored = await Service.findById(service._id);
    expect(stored.isVerified).toBe(false);
    expect(stored.ratingAverage).toBe(0);
    expect(stored.basePrice).toBe(2500);
  });
});

describe('paid event tickets', () => {
  const paidEvent = async (overrides = {}) => {
    const organizer = await createUser();
    const event = await createEvent(organizer.user, {
      isPublic: true, isPublished: true, status: 'active', entryFee: 500, isPaid: true, ...overrides
    });
    return { organizer, event };
  };

  it('holds the seat until payment, then confirms it', async () => {
    const { event } = await paidEvent();
    const attendee = await createUser();

    const res = await request(app).post('/api/v1/rsvps').set(auth(attendee.token))
      .send({ eventId: event._id, guestsCount: 1 });
    expect(res.status).toBe(201);
    expect(res.body.data.rsvp.status).toBe('pending_payment');
    expect(res.body.data.checkout.amount).toBe(1000);

    expect((await Event.findById(event._id)).currentAttendees).toBe(0);

    const { orderId } = res.body.data.checkout;
    await request(app).post('/api/v1/payments/verify').set(auth(attendee.token)).send({
      razorpay_order_id: orderId, razorpay_payment_id: 'pay_t', razorpay_signature: sign(orderId, 'pay_t')
    }).expect(200);

    const rsvp = await RSVP.findById(res.body.data.rsvp._id);
    expect(rsvp.status).toBe('going');
    expect(rsvp.paymentStatus).toBe('paid');
    expect((await Event.findById(event._id)).currentAttendees).toBe(2);

    const payment = await Payment.findOne({ rsvp: rsvp._id });
    expect(payment.platformFee).toBe(50); // 5%
  });

  it('cannot check in an unpaid ticket', async () => {
    const { organizer, event } = await paidEvent();
    const attendee = await createUser();
    const res = await request(app).post('/api/v1/rsvps').set(auth(attendee.token)).send({ eventId: event._id });

    const checkIn = await request(app).post(`/api/v1/rsvps/${res.body.data.rsvp._id}/check-in`).set(auth(organizer.token));
    expect(checkIn.status).toBe(400);
  });

  it('refunds every ticket and notifies vendors when the organizer cancels the event', async () => {
    const { organizer, event } = await paidEvent();
    const attendee = await createUser();
    const res = await request(app).post('/api/v1/rsvps').set(auth(attendee.token)).send({ eventId: event._id });
    const { orderId } = res.body.data.checkout;
    await request(app).post('/api/v1/payments/verify').set(auth(attendee.token)).send({
      razorpay_order_id: orderId, razorpay_payment_id: 'pay_c', razorpay_signature: sign(orderId, 'pay_c')
    });

    const vendor = await createUser();
    const service = await createService(vendor.user);
    await request(app).post('/api/v1/bookings').set(auth(organizer.token)).send({ eventId: event._id, serviceId: service._id });

    const cancel = await request(app).post(`/api/v1/events/${event._id}/cancel`).set(auth(organizer.token));
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.refundFailures).toEqual([]);
    expect(refunds).toEqual([{ paymentId: 'pay_c', amount: 500 }]);

    expect((await RSVP.findById(res.body.data.rsvp._id)).status).toBe('cancelled');
    expect(await Booking.countDocuments({ event: event._id, status: 'cancelled' })).toBe(1);
  });

  it('releases ticket revenue to the organizer when the event completes', async () => {
    const { organizer, event } = await paidEvent();
    const attendee = await createUser();
    const res = await request(app).post('/api/v1/rsvps').set(auth(attendee.token)).send({ eventId: event._id });
    const { orderId } = res.body.data.checkout;
    await request(app).post('/api/v1/payments/verify').set(auth(attendee.token)).send({
      razorpay_order_id: orderId, razorpay_payment_id: 'pay_d', razorpay_signature: sign(orderId, 'pay_d')
    });

    // The event takes place, then the organizer completes it
    await Event.updateOne({ _id: event._id }, { date: new Date(Date.now() - DAY) });
    await request(app).post(`/api/v1/events/${event._id}/complete`).set(auth(organizer.token)).expect(200);
    expect((await Payment.findOne({ rsvp: res.body.data.rsvp._id })).payoutStatus).toBe('pending');
  });
});

describe('admin', () => {
  it('sees revenue and settles payouts; regular users are refused', async () => {
    const { organizer, vendor, bookingId } = await confirmedBooking();
    await payBooking(organizer.token, bookingId);
    await request(app).post(`/api/v1/bookings/${bookingId}/complete`).set(auth(organizer.token));

    await request(app).put('/api/v1/users/me/payout-details').set(auth(vendor.token))
      .send({ method: 'upi', upiId: 'vendor@okaxis' }).expect(200);

    const admin = await createUser({ role: 'admin' });
    await request(app).get('/api/v1/admin/stats').set(auth(organizer.token)).expect(403);

    const stats = await request(app).get('/api/v1/admin/stats').set(auth(admin.token));
    expect(stats.status).toBe(200);
    expect(stats.body.data.money.allTime).toEqual({ collected: 10000, refunded: 0, platformRevenue: 1000 });
    expect(stats.body.data.payoutsDue).toEqual({ amount: 9000, count: 1 });

    const payouts = await request(app).get('/api/v1/admin/payouts').set(auth(admin.token));
    expect(payouts.body.data).toHaveLength(1);
    expect(payouts.body.data[0].payee.payoutDetails.upiId).toBe('vendor@okaxis');

    const id = payouts.body.data[0]._id;
    await request(app).post(`/api/v1/admin/payouts/${id}/mark-paid`).set(auth(admin.token)).send({}).expect(400);
    await request(app).post(`/api/v1/admin/payouts/${id}/mark-paid`).set(auth(admin.token))
      .send({ reference: 'UTR123' }).expect(200);

    const earnings = await request(app).get('/api/v1/payments/mine?role=payee').set(auth(vendor.token));
    expect(earnings.body.summary).toEqual({ held: 0, payoutDue: 0, paidOut: 9000 });
  });

  it('validates payout details', async () => {
    const vendor = await createUser();
    await request(app).put('/api/v1/users/me/payout-details').set(auth(vendor.token))
      .send({ method: 'bank', accountHolderName: 'A', accountNumber: '12', ifsc: 'BAD' }).expect(400);
  });
});
