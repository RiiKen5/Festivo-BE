const Razorpay = require('razorpay');
const crypto = require('crypto');
const { safeEqual } = require('../utils/helpers');

const toPaise = (rupees) => Math.round(rupees * 100);

// Thin wrapper around the Razorpay API. Business logic for what a payment
// means lives in checkoutService.
class PaymentService {
  constructor() {
    this.razorpay = null;
  }

  // Created lazily so tests and deployments can set credentials at runtime
  client() {
    if (!this.isConfigured()) {
      throw new Error('Payment service not configured');
    }
    if (!this.razorpay || this.razorpay.key_id !== process.env.RAZORPAY_KEY_ID) {
      this.razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
      });
    }
    return this.razorpay;
  }

  isConfigured() {
    return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
  }

  // Create Razorpay order; amount in rupees
  async createOrder(amount, receipt, notes = {}) {
    return this.client().orders.create({
      amount: toPaise(amount),
      currency: 'INR',
      receipt: receipt.slice(0, 40), // Razorpay limit
      notes
    });
  }

  // Verify the signature Razorpay Checkout returns to the browser
  verifyPaymentSignature(orderId, paymentId, signature) {
    if (!process.env.RAZORPAY_KEY_SECRET || !signature) return false;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    return safeEqual(expectedSignature, signature);
  }

  // Verify a webhook; must be computed over the raw request body
  verifyWebhookSignature(rawBody, signature) {
    if (!process.env.RAZORPAY_WEBHOOK_SECRET || !signature) return false;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');
    return safeEqual(expectedSignature, signature);
  }

  async getPayment(paymentId) {
    return this.client().payments.fetch(paymentId);
  }

  // Refund amount in rupees (full refund if omitted)
  async refund(paymentId, amount, notes = {}) {
    const options = { notes };
    if (amount) options.amount = toPaise(amount);
    return this.client().payments.refund(paymentId, options);
  }
}

module.exports = new PaymentService();
