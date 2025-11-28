module.exports = {
  // User Types
  USER_TYPES: {
    ORGANIZER: 'organizer',
    HELPER: 'helper',
    ATTENDEE: 'attendee',
    ALL: 'all'
  },

  // User Levels
  USER_LEVELS: {
    BRONZE: 'Bronze',
    SILVER: 'Silver',
    GOLD: 'Gold',
    PLATINUM: 'Platinum'
  },

  // XP Thresholds
  XP_THRESHOLDS: {
    SILVER: 101,
    GOLD: 501,
    PLATINUM: 1501
  },

  // Event Types
  EVENT_TYPES: {
    BIRTHDAY: 'birthday',
    HOUSE_PARTY: 'house_party',
    MEETUP: 'meetup',
    WEDDING: 'wedding',
    CORPORATE: 'corporate',
    FAREWELL: 'farewell',
    OTHER: 'other'
  },

  // Event Status
  EVENT_STATUS: {
    DRAFT: 'draft',
    PLANNING: 'planning',
    ACTIVE: 'active',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled'
  },

  // Vibe Scores
  VIBE_SCORES: {
    CHILL: 'chill',
    PARTY: 'party',
    NETWORKING: 'networking',
    FORMAL: 'formal'
  },

  // Service Categories
  SERVICE_CATEGORIES: {
    FOOD: 'food',
    DECOR: 'decor',
    PHOTOGRAPHY: 'photography',
    MUSIC: 'music',
    CLEANUP: 'cleanup',
    ENTERTAINMENT: 'entertainment',
    VENUE: 'venue',
    OTHER: 'other'
  },

  // Booking Status
  BOOKING_STATUS: {
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    REFUNDED: 'refunded'
  },

  // Payment Status
  PAYMENT_STATUS: {
    UNPAID: 'unpaid',
    PARTIAL: 'partial',
    PAID: 'paid',
    REFUNDED: 'refunded'
  },

  // Task Status
  TASK_STATUS: {
    PENDING: 'pending',
    IN_PROGRESS: 'in_progress',
    DONE: 'done',
    CANCELLED: 'cancelled'
  },

  // Task Priority
  TASK_PRIORITY: {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    URGENT: 'urgent'
  },

  // RSVP Status
  RSVP_STATUS: {
    GOING: 'going',
    MAYBE: 'maybe',
    NOT_GOING: 'not_going',
    CANCELLED: 'cancelled'
  },

  // Notification Types
  NOTIFICATION_TYPES: {
    BOOKING: 'booking',
    MESSAGE: 'message',
    REVIEW: 'review',
    EVENT_REMINDER: 'event_reminder',
    PAYMENT: 'payment',
    SYSTEM: 'system',
    RSVP: 'rsvp',
    TASK_ASSIGNED: 'task_assigned'
  },

  // XP Rewards
  XP_REWARDS: {
    EVENT_CREATED: 50,
    EVENT_COMPLETED: 100,
    BOOKING_COMPLETED: 30,
    REVIEW_GIVEN: 10,
    EVENT_ATTENDED: 20
  },

  // Pagination
  PAGINATION: {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 20,
    MAX_LIMIT: 100
  }
};
