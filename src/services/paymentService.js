const Razorpay = require('razorpay');
const crypto = require('crypto');

class PaymentService {
  constructor() {
    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
      this.razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
      });
    } else {
      console.warn('Razorpay credentials not configured. Payment service will be disabled.');
      this.razorpay = null;
    }
  }

  // Create Razorpay order
  async createOrder(amount, currency = 'INR', receipt = null, notes = {}) {
    if (!this.razorpay) {
      throw new Error('Payment service not configured');
    }

    const options = {
      amount: amount * 100, // Razorpay expects amount in paise
      currency,
      receipt: receipt || `order_${Date.now()}`,
      notes
    };

    try {
      const order = await this.razorpay.orders.create(options);
      return order;
    } catch (error) {
      console.error('Razorpay order creation error:', error);
      throw error;
    }
  }

  // Verify payment signature
  verifyPaymentSignature(orderId, paymentId, signature) {
    const body = orderId + '|' + paymentId;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    return expectedSignature === signature;
  }

  // Fetch payment details
  async getPayment(paymentId) {
    if (!this.razorpay) {
      throw new Error('Payment service not configured');
    }

    try {
      const payment = await this.razorpay.payments.fetch(paymentId);
      return payment;
    } catch (error) {
      console.error('Fetch payment error:', error);
      throw error;
    }
  }

  // Fetch order details
  async getOrder(orderId) {
    if (!this.razorpay) {
      throw new Error('Payment service not configured');
    }

    try {
      const order = await this.razorpay.orders.fetch(orderId);
      return order;
    } catch (error) {
      console.error('Fetch order error:', error);
      throw error;
    }
  }

  // Initiate refund
  async initiateRefund(paymentId, amount = null, notes = {}) {
    if (!this.razorpay) {
      throw new Error('Payment service not configured');
    }

    const options = {
      notes
    };

    // If amount provided, partial refund
    if (amount) {
      options.amount = amount * 100;
    }

    try {
      const refund = await this.razorpay.payments.refund(paymentId, options);
      return refund;
    } catch (error) {
      console.error('Refund error:', error);
      throw error;
    }
  }

  // Get refund details
  async getRefund(paymentId, refundId) {
    if (!this.razorpay) {
      throw new Error('Payment service not configured');
    }

    try {
      const refund = await this.razorpay.refunds.fetch(refundId);
      return refund;
    } catch (error) {
      console.error('Fetch refund error:', error);
      throw error;
    }
  }

  // Create booking payment order
  async createBookingPayment(booking) {
    const notes = {
      booking_id: booking._id.toString(),
      event_id: booking.event.toString(),
      service_id: booking.service.toString(),
      organizer_id: booking.organizer.toString(),
      vendor_id: booking.vendor.toString()
    };

    return this.createOrder(
      booking.priceAgreed,
      'INR',
      `booking_${booking._id}`,
      notes
    );
  }

  // Create RSVP payment order (for paid events)
  async createRSVPPayment(rsvp, event) {
    const totalAmount = event.entryFee * (1 + rsvp.guestsCount);

    const notes = {
      rsvp_id: rsvp._id.toString(),
      event_id: event._id.toString(),
      attendee_id: rsvp.attendee.toString(),
      guests_count: rsvp.guestsCount
    };

    return this.createOrder(
      totalAmount,
      'INR',
      `rsvp_${rsvp._id}`,
      notes
    );
  }

  // Process webhook event
  async processWebhook(body, signature) {
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(JSON.stringify(body))
      .digest('hex');

    if (expectedSignature !== signature) {
      throw new Error('Invalid webhook signature');
    }

    const event = body.event;
    const payload = body.payload;

    switch (event) {
      case 'payment.captured':
        return this.handlePaymentCaptured(payload);
      case 'payment.failed':
        return this.handlePaymentFailed(payload);
      case 'refund.created':
        return this.handleRefundCreated(payload);
      default:
        console.log('Unhandled webhook event:', event);
        return null;
    }
  }

  async handlePaymentCaptured(payload) {
    const payment = payload.payment.entity;
    console.log('Payment captured:', payment.id);
    // Update booking/rsvp payment status in your database
    return { status: 'captured', paymentId: payment.id };
  }

  async handlePaymentFailed(payload) {
    const payment = payload.payment.entity;
    console.log('Payment failed:', payment.id);
    // Handle failed payment
    return { status: 'failed', paymentId: payment.id };
  }

  async handleRefundCreated(payload) {
    const refund = payload.refund.entity;
    console.log('Refund created:', refund.id);
    // Update booking/rsvp refund status
    return { status: 'refunded', refundId: refund.id };
  }

  // Calculate platform fee
  calculatePlatformFee(amount, percentage = 5) {
    return Math.round(amount * (percentage / 100));
  }

  // Calculate vendor payout
  calculateVendorPayout(amount, platformFeePercentage = 5) {
    const platformFee = this.calculatePlatformFee(amount, platformFeePercentage);
    return amount - platformFee;
  }
}

module.exports = new PaymentService();
