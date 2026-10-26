const crypto = require('crypto');
const request = require('supertest');
const app = require('../../src/app');
const paymentService = require('../../src/services/paymentService');
const disputeService = require('../../src/services/disputeService');
const Booking = require('../../src/models/Booking');
const Payment = require('../../src/models/Payment');
const Service = require('../../src/models/Service');
const User = require('../../src/models/User');
const RSVP = require('../../src/models/RSVP');
const Event = require('../../src/models/Event');
const { completeOverdueBookings } = require('../../src/jobs/autoComplete');
const { connect, clear, disconnect, createUser, createEvent, createService, auth } = require('../helpers');

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const sign = (orderId, paymentId) => crypto
  .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
  .update(`${orderId}|${paymentId}`)
  .digest('hex');

let orderSeq = 0;
let refunds;

beforeAll(async () => { await connect(); await RSVP.createIndexes(); });
afterAll(disconnect);

beforeEach(() => {
  refunds = [];
  jest.spyOn(paymentService, 'createOrder').mockImplementation(async (amount) => {
    orderSeq += 1;
    return { id: `dorder_${orderSeq}`, amount: amount * 100 };
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

// A confirmed and fully paid ₹10,000 booking whose event is `daysAway` from now
const paidBooking = async ({ daysAway = 0 } = {}) => {
  const organizer = await createUser();
  const vendor = await createUser();
  const event = await createEvent(organizer.user, { date: new Date(Date.now() + 10 * DAY) });
  const service = await createService(vendor.user, { basePrice: 10000 });

  const created = await request(app).post('/api/v1/bookings').set(auth(organizer.token))
    .send({ eventId: event._id, serviceId: service._id });
  const bookingId = created.body.data._id;
  await request(app).post(`/api/v1/bookings/${bookingId}/confirm`).set(auth(vendor.token)).expect(200);

  const order = await request(app).post(`/api/v1/payments/bookings/${bookingId}/order`).set(auth(organizer.token)).send({});
  const { orderId } = order.body.data;
  await request(app).post('/api/v1/payments/verify').set(auth(organizer.token)).send({
    razorpay_order_id: orderId, razorpay_payment_id: `pay_${orderId}`, razorpay_signature: sign(orderId, `pay_${orderId}`)
  }).expect(200);

  // Move the event day relative to now
  await Booking.updateOne({ _id: bookingId }, { eventDate: new Date(Date.now() + daysAway * DAY) });
  return { organizer, vendor, service, bookingId };
};

const report = (token, id, body) => request(app).post(`/api/v1/bookings/${id}/report-problem`).set(auth(token)).send(body);

describe('arrival code', () => {
  it('only the organizer sees the code; the vendor enters it on the day to check in', async () => {
    const { organizer, vendor, bookingId } = await paidBooking({ daysAway: 0 });

    const asOrganizer = await request(app).get(`/api/v1/bookings/${bookingId}`).set(auth(organizer.token));
    const code = asOrganizer.body.data.arrivalCode;
    expect(code).toMatch(/^\d{4}$/);

    const asVendor = await request(app).get(`/api/v1/bookings/${bookingId}`).set(auth(vendor.token));
    expect(asVendor.body.data.arrivalCode).toBeUndefined();

    const wrong = code === '0000' ? '1111' : '0000';
    await request(app).post(`/api/v1/bookings/${bookingId}/arrive`).set(auth(vendor.token)).send({ code: wrong }).expect(400);
    await request(app).post(`/api/v1/bookings/${bookingId}/arrive`).set(auth(organizer.token)).send({ code }).expect(403);

    const ok = await request(app).post(`/api/v1/bookings/${bookingId}/arrive`).set(auth(vendor.token)).send({ code });
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('in_progress');
    expect(ok.body.data.arrivalCode).toBeUndefined();

    // Arrived vendors can't be reported as a no-show
    const noShow = await report(organizer.token, bookingId, { reason: 'no_show', details: 'Nobody came to set up' });
    expect(noShow.status).toBe(400);
  });

  it('is not accepted too early, and locks after five wrong tries', async () => {
    const { organizer, vendor, bookingId } = await paidBooking({ daysAway: 5 });
    const code = (await request(app).get(`/api/v1/bookings/${bookingId}`).set(auth(organizer.token))).body.data.arrivalCode;
    const early = await request(app).post(`/api/v1/bookings/${bookingId}/arrive`).set(auth(vendor.token)).send({ code });
    expect(early.body.error.message).toMatch(/day before/);

    await Booking.updateOne({ _id: bookingId }, { eventDate: new Date() });
    const wrong = code === '0000' ? '1111' : '0000';
    for (let i = 0; i < 5; i++) {
      await request(app).post(`/api/v1/bookings/${bookingId}/arrive`).set(auth(vendor.token)).send({ code: wrong }).expect(400);
    }
    await request(app).post(`/api/v1/bookings/${bookingId}/arrive`).set(auth(vendor.token)).send({ code }).expect(429);

    // The organizer can still mark them as arrived
    await request(app).post(`/api/v1/bookings/${bookingId}/mark-arrived`).set(auth(organizer.token)).expect(200);
    expect((await Booking.findById(bookingId)).arrivedAt).toBeTruthy();
  });
});

describe('reporting a problem', () => {
  it('freezes the payout; an unanswered no-show is refunded automatically and recorded', async () => {
    const { organizer, vendor, service, bookingId } = await paidBooking({ daysAway: 0 });

    // A no-show can't be reported before the event day
    await Booking.updateOne({ _id: bookingId }, { eventDate: new Date(Date.now() + 3 * DAY) });
    expect((await report(organizer.token, bookingId, { reason: 'no_show', details: 'Nobody came to set up' })).status).toBe(400);
    await Booking.updateOne({ _id: bookingId }, { eventDate: new Date() });

    expect((await report(vendor.token, bookingId, { reason: 'no_show', details: 'Nobody came to set up' })).status).toBe(403);
    expect((await report(organizer.token, bookingId, { reason: 'no_show', details: 'no' })).status).toBe(400);

    const res = await report(organizer.token, bookingId, { reason: 'no_show', details: 'The decorator never came' });
    expect(res.status).toBe(200);
    expect(res.body.data.dispute.status).toBe('open');

    // Frozen: cannot be completed, by hand or by the 3-day auto-complete
    await request(app).post(`/api/v1/bookings/${bookingId}/complete`).set(auth(organizer.token)).expect(400);
    await request(app).post(`/api/v1/bookings/${bookingId}/cancel`).set(auth(vendor.token)).expect(400);
    await Booking.updateOne({ _id: bookingId }, { eventDate: new Date(Date.now() - 5 * DAY) });
    expect(await completeOverdueBookings()).toBe(0);

    // Not yet overdue: nothing happens
    expect(await disputeService.resolveOverdue()).toBe(0);
    expect(await disputeService.resolveOverdue(new Date(Date.now() + 25 * HOUR))).toBe(1);

    const booking = await Booking.findById(bookingId);
    expect(booking.status).toBe('refunded');
    expect(booking.dispute).toMatchObject({ status: 'resolved', resolution: 'refund', noShow: true });
    expect(refunds).toEqual([{ paymentId: expect.any(String), amount: 10000 }]);
    expect((await Payment.findOne({ booking: bookingId })).payoutStatus).toBe('not_applicable');
    expect((await User.findById(vendor.user._id)).noShowCount).toBe(1);
    expect((await Service.findById(service._id)).noShowCount).toBe(1);
  });

  it('a vendor reply sends it to an admin, who can partly refund and add a penalty taken from the next payout', async () => {
    const { organizer, vendor, bookingId } = await paidBooking({ daysAway: 0 });
    await report(organizer.token, bookingId, { reason: 'not_as_agreed', details: 'Half the balloons were missing' }).expect(200);

    await request(app).post(`/api/v1/bookings/${bookingId}/dispute-response`).set(auth(organizer.token))
      .send({ response: 'Something here' }).expect(403);
    const reply = await request(app).post(`/api/v1/bookings/${bookingId}/dispute-response`).set(auth(vendor.token))
      .send({ response: 'Everything agreed was set up, see photos', evidence: ['https://example.com/a.jpg', 'javascript:alert(1)'] });
    expect(reply.status).toBe(200);
    expect(reply.body.data.dispute.vendorEvidence).toEqual(['https://example.com/a.jpg']);

    // Answered in time, so no automatic refund
    expect(await disputeService.resolveOverdue(new Date(Date.now() + 48 * HOUR))).toBe(0);

    const admin = await createUser({ role: 'admin' });
    await request(app).get('/api/v1/admin/disputes').set(auth(organizer.token)).expect(403);
    const list = await request(app).get('/api/v1/admin/disputes').set(auth(admin.token));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].refundableOnline).toBe(10000);
    expect((await request(app).get('/api/v1/admin/stats').set(auth(admin.token))).body.data.openDisputes).toBe(1);

    await request(app).post(`/api/v1/admin/disputes/${bookingId}/resolve`).set(auth(admin.token))
      .send({ resolution: 'partial', amount: 20000 }).expect(400);
    const resolved = await request(app).post(`/api/v1/admin/disputes/${bookingId}/resolve`).set(auth(admin.token))
      .send({ resolution: 'partial', amount: 3000, penalty: 500, note: 'Photos show most of the decor.' });
    expect(resolved.status).toBe(200);
    expect(refunds).toEqual([{ paymentId: expect.any(String), amount: 3000 }]);

    const booking = await Booking.findById(bookingId);
    expect(booking.status).toBe('completed');
    const payment = await Payment.findOne({ booking: bookingId });
    expect(payment.payoutStatus).toBe('pending');
    expect(payment.payeeAmount).toBe(5950); // 7,000 kept less 15%

    // The ₹500 penalty comes out of this payout
    const payouts = await request(app).get('/api/v1/admin/payouts').set(auth(admin.token));
    expect(payouts.body.data[0].payee.penaltyDue).toBe(500);
    const paid = await request(app).post(`/api/v1/admin/payouts/${payment._id}/mark-paid`).set(auth(admin.token)).send({ reference: 'UTR9' });
    expect(paid.body.data.penaltyDeducted).toBe(500);
    expect((await User.findById(vendor.user._id)).penaltyDue).toBe(0);
  });

  it('vendors with a verified no-show rank below others', async () => {
    const a = await createUser();
    const b = await createUser();
    await createService(a.user, { serviceName: 'Top rated', ratingAverage: 5, noShowCount: 1 });
    await createService(b.user, { serviceName: 'Reliable', ratingAverage: 4 });
    const res = await request(app).get('/api/v1/services');
    expect(res.body.data.map(s => s.serviceName)).toEqual(['Reliable', 'Top rated']);
  });
});

describe('paid tickets without an account', () => {
  const paidEvent = async (overrides = {}) => {
    const host = await createUser();
    const event = await createEvent(host.user, {
      isPublic: true, isPublished: true, status: 'active', entryFee: 300, isPaid: true, ...overrides
    });
    return { host, event };
  };

  const buy = (body) => request(app).post('/api/v1/rsvps/guest').send(body);
  const verifyGuest = (orderId, guestToken) => request(app).post('/api/v1/payments/guest/verify').send({
    razorpay_order_id: orderId, razorpay_payment_id: `pay_${orderId}`, razorpay_signature: sign(orderId, `pay_${orderId}`), guestToken
  });

  it('a guest buys a ticket with name and phone, gets a check-in code, and can cancel for a refund', async () => {
    const { host, event } = await paidEvent({ date: new Date(Date.now() + 10 * DAY) });

    const res = await buy({ eventId: event._id, name: 'Asha', phone: '98765 43210', guestsCount: 1 });
    expect(res.status).toBe(201);
    expect(res.body.data.rsvp.status).toBe('pending_payment');
    expect(res.body.data.checkout.amount).toBe(600);
    const { guestToken } = res.body.data;
    const { orderId } = res.body.data.checkout;

    // Someone else's token can't confirm it
    await verifyGuest(orderId, 'x'.repeat(32)).expect(404);
    await verifyGuest(orderId, guestToken).expect(200);

    const mine = await request(app).get(`/api/v1/rsvps/guest?token=${guestToken}`);
    expect(mine.body.data).toMatchObject({ status: 'going', paymentStatus: 'paid', amountPaid: 600 });
    expect(mine.body.data.checkInCode).toBeTruthy();
    expect((await Event.findById(event._id)).currentAttendees).toBe(2);

    const payment = await Payment.findOne({ event: event._id });
    expect(payment.payer).toBeUndefined();
    expect(payment.platformFee).toBe(30); // 5% taken from the host's price
    expect(payment.payeeAmount).toBe(570);

    // Already has a ticket; can't silently switch to "maybe"
    expect((await buy({ eventId: event._id, name: 'Asha', phone: '9876543210', guestsCount: 1, guestToken })).status).toBe(400);
    expect((await buy({ eventId: event._id, name: 'Asha', status: 'maybe', guestToken })).status).toBe(400);

    // The host sees the buyer and their number
    const list = await request(app).get(`/api/v1/rsvps/event/${event._id}`).set(auth(host.token));
    expect(list.body.data[0]).toMatchObject({ guestName: 'Asha', guestPhone: '9876543210', paymentStatus: 'paid' });

    const cancel = await request(app).post('/api/v1/rsvps/guest/cancel').send({ token: guestToken });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.refundIssued).toBe(600);
    expect((await Event.findById(event._id)).currentAttendees).toBe(0);
  });

  it('when the host chooses, the guest pays the fee on top and the host keeps the full price', async () => {
    const { event } = await paidEvent({ ticketFeePaidBy: 'guest' });
    const res = await buy({ eventId: event._id, name: 'Ravi', phone: '9123456780' });
    expect(res.body.data.checkout.amount).toBe(315);
    await verifyGuest(res.body.data.checkout.orderId, res.body.data.guestToken).expect(200);

    const payment = await Payment.findOne({ event: event._id });
    expect(payment.platformFee).toBe(15);
    expect(payment.payeeAmount).toBe(300);
  });

  it('signed-in buyers also pay the fee on top when the host chose that', async () => {
    const { event } = await paidEvent({ ticketFeePaidBy: 'guest' });
    const attendee = await createUser();
    const res = await request(app).post('/api/v1/rsvps').set(auth(attendee.token)).send({ eventId: event._id });
    expect(res.body.data.checkout.amount).toBe(315);
  });
});
