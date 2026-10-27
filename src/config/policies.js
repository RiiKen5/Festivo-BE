// Business rules for money movement. Percentages can be overridden per
// deployment through environment variables.

const percentFromEnv = (name, fallback) => {
  const value = parseFloat(process.env[name]);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : fallback;
};

const HOUR = 60 * 60 * 1000;

module.exports = {
  /**
   * Festivo's fee on a vendor booking (Founding Vendor Plan). Lower on the
   * vendor's own customers (who came through the vendor's shared link) than
   * on customers Festivo brought. Founding vendors pay less until the
   * founding terms end.
   * @param {object} terms
   * @param {'vendor_link'|'marketplace'} terms.source
   * @param {boolean} terms.founding - Vendor holds founding terms right now
   * @returns {number} - Percent
   */
  bookingFeePercent: ({ source, founding }) => {
    const own = source === 'vendor_link';
    if (founding) {
      return own ? percentFromEnv('FOUNDING_FEE_OWN_PERCENT', 0) : percentFromEnv('FOUNDING_FEE_NEW_PERCENT', 5);
    }
    return own ? percentFromEnv('BOOKING_FEE_OWN_PERCENT', 3) : percentFromEnv('BOOKING_FEE_NEW_PERCENT', 10);
  },

  // Most Festivo takes from one booking, in rupees
  bookingFeeCap: () => {
    const value = parseFloat(process.env.BOOKING_FEE_CAP);
    return Number.isFinite(value) && value >= 0 ? value : 1000;
  },

  // Founding terms: the first 50 vendors, through 31 January 2027 (IST)
  foundingVendorLimit: () => parseInt(process.env.FOUNDING_VENDOR_LIMIT, 10) || 50,
  foundingUntil: () => new Date(process.env.FOUNDING_UNTIL || '2027-02-01T00:00:00+05:30'),
  foundingOpen: (now = new Date()) => now < module.exports.foundingUntil(),

  // Verified vendors get this share of their money this many days before the event
  earlyReleaseDays: () => 7,
  earlyReleaseShare: () => 0.5,

  // Payout promise: sent within this many hours of becoming due, or no fee
  payoutPromiseHours: () => 24,

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
