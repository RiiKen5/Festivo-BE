const crypto = require('crypto');
const request = require('supertest');
const app = require('../../src/app');
const paymentService = require('../../src/services/paymentService');
const payoutService = require('../../src/services/payoutService');
const Booking = require('../../src/models/Booking');
const Payment = require('../../src/models/Payment');
const Service = require('../../src/models/Service');
const User = require('../../src/models/User');
const { completeOverdueBookings } = require('../../src/jobs/autoComplete');
const { connect, clear, disconnect, createUser, createEvent, createService, auth } = require('../helpers');

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const sign = (orderId, paymentId) => crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

let seq = 0;
let refunds;

beforeAll(connect);
afterAll(disconnect);
beforeEach(() => {
  refunds = [];
  jest.spyOn(paymentService, 'createOrder').mockImplementation(async (amount) => ({ id: `forder_${++seq}`, amount: amount * 100 }));
  jest.spyOn(paymentService, 'refund').mockImplementation(async (paymentId, amount) => { refunds.push(amount); return { id: `r_${refunds.length}` }; });
});
afterEach(async () => {
  jest.restoreAllMocks();
  delete process.env.FOUNDING_UNTIL;
  delete process.env.FOUNDING_VENDOR_LIMIT;
  await clear();
});

const listService = async (vendor, overrides = {}) => {
  const res = await request(app).post('/api/v1/services').set(auth(vendor.token)).send({
    serviceName: 'Balloon Decor', category: 'decor', description: 'Balloon arches and backdrops for parties',
    basePrice: 10000, priceUnit: 'per_event', city: 'Bengaluru', ...overrides
  });
  expect(res.status).toBe(201);
  return res.body.data;
};

const book = async ({ organizer, service, daysAway = 30, viaVendorLink, price = 10000 }) => {
  const event = await createEvent(organizer.user, { date: new Date(Date.now() + daysAway * DAY) });
  const res = await request(app).post('/api/v1/bookings').set(auth(organizer.token))
    .send({ eventId: event._id, serviceId: service._id, priceAgreed: price, viaVendorLink });
  expect(res.status).toBe(201);
  return res.body.data;
};

const confirmAndPay = async ({ organizer, vendor, bookingId, amounts = [undefined] }) => {
  await request(app).post(`/api/v1/bookings/${bookingId}/confirm`).set(auth(vendor.token)).send({}).expect(200);
  for (const amount of amounts) {
    const order = await request(app).post(`/api/v1/payments/bookings/${bookingId}/order`).set(auth(organizer.token)).send(amount ? { amount } : {});
    const { orderId } = order.body.data;
    await request(app).post('/api/v1/payments/verify').set(auth(organizer.token))
      .send({ razorpay_order_id: orderId, razorpay_payment_id: `p_${orderId}`, razorpay_signature: sign(orderId, `p_${orderId}`) }).expect(200);
  }
};

describe('fee by source and founding terms', () => {
  it('charges 3% on the vendor\'s own customers and 10% on new ones; a repeat customer keeps their first source', async () => {
    const vendor = await createUser();
    const service = await createService(vendor.user, { basePrice: 10000 });
    const own = await createUser();
    const found = await createUser();

    expect((await book({ organizer: own, service, viaVendorLink: true })).feePercent).toBe(3);
    const fromFestivo = await book({ organizer: found, service });
    expect(fromFestivo).toMatchObject({ source: 'marketplace', feePercent: 10 });

    // Later sent the vendor's link: still a customer Festivo brought
    expect((await book({ organizer: found, service, viaVendorLink: true })).source).toBe('marketplace');

    await confirmAndPay({ organizer: found, vendor, bookingId: fromFestivo._id });
    const payment = await Payment.findOne({ booking: fromFestivo._id });
    expect(payment.platformFee).toBe(1000);
  });

  it('the first vendors to list get founding terms (0% own, 5% new) while they are open', async () => {
    process.env.FOUNDING_VENDOR_LIMIT = '1';
    const first = await createUser();
    const second = await createUser();
    const service = await listService(first);
    await listService(second);
    expect((await User.findById(first.user._id)).foundingVendor).toBe(true);
    expect((await User.findById(second.user._id)).foundingVendor).toBe(false);

    const organizer = await createUser();
    expect((await book({ organizer, service, viaVendorLink: true })).feePercent).toBe(0);
    const other = await createUser();
    expect((await book({ organizer: other, service })).feePercent).toBe(5);

    // After the founding date, new bookings move to standard fees and no new spots open
    process.env.FOUNDING_UNTIL = new Date(Date.now() - DAY).toISOString();
    const third = await createUser();
    expect((await book({ organizer: third, service })).feePercent).toBe(10);
    await User.updateOne({ _id: first.user._id }, { foundingVendor: false });
    process.env.FOUNDING_VENDOR_LIMIT = '50';
    const late = await createUser();
    await listService(late);
    expect((await User.findById(late.user._id)).foundingVendor).toBe(false);

    const config = await request(app).get('/api/v1/payments/config');
    expect(config.body.data.bookingFees).toMatchObject({ ownPercent: 3, newPercent: 10, foundingOwnPercent: 0, foundingNewPercent: 5, cap: 1000 });
  });

  it('never takes more than ₹1,000 across all payments of a booking', async () => {
    const vendor = await createUser();
    const service = await createService(vendor.user);
    const organizer = await createUser();
    const b = await book({ organizer, service, price: 30000 });
    await confirmAndPay({ organizer, vendor, bookingId: b._id, amounts: [6000, 24000] });
    const payments = await Payment.find({ booking: b._id }).sort('createdAt');
    expect(payments.map(p => p.platformFee)).toEqual([600, 400]);
  });
});

describe('early release and the payout promise', () => {
  const setup = async ({ verified = true, daysAway = 5 } = {}) => {
    const vendor = await createUser();
    const service = await createService(vendor.user, { isVerified: verified });
    const organizer = await createUser();
    const admin = await createUser({ role: 'admin' });
    const b = await book({ organizer, service, daysAway });
    await confirmAndPay({ organizer, vendor, bookingId: b._id });
    return { vendor, organizer, admin, bookingId: b._id };
  };
  const payouts = (admin) => request(app).get('/api/v1/admin/payouts').set(auth(admin.token));
  const send = (admin, id, part, reference = 'UTR1') => request(app).post(`/api/v1/admin/payouts/${id}/mark-paid`).set(auth(admin.token)).send({ part, reference });

  it('verified vendors get half their share before the event and the rest within 24 hours of the job', async () => {
    const { vendor, organizer, admin, bookingId } = await setup();

    let list = (await payouts(admin)).body.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ part: 'advance', amountDue: 4500 }); // half of 9,000
    await send(admin, list[0]._id, 'advance').expect(200);

    let earnings = (await request(app).get('/api/v1/payments/mine?role=payee').set(auth(vendor.token))).body.summary;
    expect(earnings).toEqual({ held: 4500, payoutDue: 0, paidOut: 4500 });

    await request(app).post(`/api/v1/bookings/${bookingId}/complete`).set(auth(organizer.token)).expect(200);
    list = (await payouts(admin)).body.data;
    expect(list[0]).toMatchObject({ part: 'final', amountDue: 4500 });
    expect(new Date(list[0].dueBy) - Date.now()).toBeGreaterThan(23 * HOUR);
    const final = await send(admin, list[0]._id, 'final');
    expect(final.body.data).toMatchObject({ sent: 4500, feeWaived: false });

    earnings = (await request(app).get('/api/v1/payments/mine?role=payee').set(auth(vendor.token))).body.summary;
    expect(earnings).toEqual({ held: 0, payoutDue: 0, paidOut: 9000 });
  });

  it('a late payout carries no Festivo fee', async () => {
    const { admin, bookingId, organizer } = await setup({ verified: false });
    expect((await payouts(admin)).body.data).toHaveLength(0); // unverified: no early release
    await request(app).post(`/api/v1/bookings/${bookingId}/complete`).set(auth(organizer.token)).expect(200);
    await Payment.updateOne({ booking: bookingId }, { payoutDueBy: new Date(Date.now() - HOUR) });

    const [item] = (await payouts(admin)).body.data;
    const res = await send(admin, item._id, 'final');
    expect(res.body.data).toMatchObject({ sent: 10000, feeWaived: true, platformFee: 0 });
  });

  it('starts 7 days before the event, and is recovered from later payouts if the money is refunded', async () => {
    const { vendor, admin, bookingId } = await setup({ daysAway: 20 });
    expect((await payouts(admin)).body.data).toHaveLength(0);
    expect(await payoutService.releaseAdvances({ now: new Date(Date.now() + 14 * DAY) })).toBe(1);

    const [advance] = (await payouts(admin)).body.data;
    await send(admin, advance._id, 'advance').expect(200);

    // The vendor cancels: the organizer gets everything back, and the ₹4,500
    // already sent is owed to Festivo
    await request(app).post(`/api/v1/bookings/${bookingId}/cancel`).set(auth(vendor.token)).expect(200);
    expect(refunds).toEqual([10000]);
    expect((await User.findById(vendor.user._id)).penaltyDue).toBe(4500);
  });

  it('a reported problem stops an advance that has not been sent', async () => {
    const { organizer, admin, bookingId } = await setup({ daysAway: 0 });
    expect((await payouts(admin)).body.data).toHaveLength(1);
    await request(app).post(`/api/v1/bookings/${bookingId}/report-problem`).set(auth(organizer.token))
      .send({ reason: 'no_show', details: 'Nobody came to decorate' }).expect(200);
    expect((await payouts(admin)).body.data).toHaveLength(0);
    expect((await Payment.findOne({ booking: bookingId })).advance.status).toBe('cancelled');
  });

  it('bookings where the vendor confirmed arrival complete after 1 day instead of 3', async () => {
    const { bookingId } = await setup({ verified: false, daysAway: 0 });
    await Booking.updateOne({ _id: bookingId }, { eventDate: new Date(Date.now() - 1.5 * DAY), arrivedAt: new Date(Date.now() - 1.5 * DAY) });
    expect(await completeOverdueBookings()).toBe(1);
  });
});
