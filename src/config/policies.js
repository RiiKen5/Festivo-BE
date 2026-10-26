// Business rules for money movement. Percentages can be overridden per
// deployment through environment variables.

const percentFromEnv = (name, fallback) => {
  const value = parseFloat(process.env[name]);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : fallback;
};

const HOUR = 60 * 60 * 1000;

module.exports = {
  // Platform commission taken from each online vendor booking payment
  bookingCommissionPercent: () => percentFromEnv('BOOKING_COMMISSION_PERCENT', 15),

  // Platform fee taken from each paid event ticket
  ticketFeePercent: () => percentFromEnv('TICKET_FEE_PERCENT', 5),

  /**
   * What one ticket costs the buyer. The organizer chooses who pays the
   * platform fee: taken from their ticket price, or added on top of it.
   * @param {object} event - Event with entryFee and ticketFeePaidBy
   * @returns {number} - Rupees per person
   */
  ticketPrice: (event) => {
    const fee = event.ticketFeePaidBy === 'guest' ? module.exports.ticketFeePercent() : 0;
    return Math.round(event.entryFee * (100 + fee)) / 100;
  },

  // Hours a vendor has to answer a reported problem before the organizer
  // is refunded automatically (unless the vendor's arrival was verified)
  disputeResponseHours: () => 24,

  /**
   * Share of a booking's online payments refunded to the organizer when the
   * booking is cancelled.
   * @param {object} booking - Booking being cancelled
   * @param {boolean} cancelledByVendor - Vendor cancellations always refund in full
   * @param {Date} [now]
   * @returns {number} - Fraction between 0 and 1
   */
  bookingRefundShare: (booking, cancelledByVendor, now = new Date()) => {
    if (cancelledByVendor) return 1;
    const hoursLeft = (new Date(booking.eventDate) - now) / HOUR;
    if (hoursLeft >= 7 * 24) return 1;
    if (hoursLeft >= 48) return 0.5;
    return 0;
  },

  /**
   * Share of a ticket refunded when the attendee cancels their own RSVP.
   * Tickets for events the organizer cancels are always refunded in full.
   * @param {object} event - Event the ticket is for
   * @param {Date} [now]
   * @returns {number} - Fraction between 0 and 1
   */
  ticketRefundShare: (event, now = new Date()) => {
    const hoursLeft = (new Date(event.date) - now) / HOUR;
    return hoursLeft >= 48 ? 1 : 0;
  }
};
