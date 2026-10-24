// Starter checklist for each event type. `service` links an item to a vendor
// category so the planner can recommend vendors for it; `daysBefore` sets
// the due date relative to the event.
const item = (taskName, category, daysBefore, service = null, priority = 'medium') =>
  ({ taskName, category, daysBefore, service, priority });

const GUESTS = item('Send invitations to guests', 'guest_management', 14, null, 'high');
const RSVPS = item('Check who is coming (RSVPs)', 'guest_management', 3);

const TEMPLATES = {
  birthday: [
    item('Fix the venue', 'venue', 21, 'venue', 'high'),
    GUESTS,
    item('Order the birthday cake', 'food', 7, 'food', 'high'),
    item('Book decorations', 'decor', 10, 'decor', 'high'),
    item('Book a photographer', 'photography', 10, 'photography'),
    item('Plan games or entertainment', 'entertainment', 7, 'entertainment'),
    item('Arrange return gifts', 'other', 5),
    RSVPS
  ],
  house_party: [
    GUESTS,
    item('Plan food and drinks', 'food', 5, 'food', 'high'),
    item('Book music or a DJ', 'music', 7, 'music'),
    item('Set up decorations', 'decor', 3, 'decor'),
    item('Arrange cleanup after the party', 'logistics', 2, 'cleanup'),
    RSVPS
  ],
  meetup: [
    item('Book the venue', 'venue', 21, 'venue', 'high'),
    item('Publish the event and share the link', 'communication', 14, null, 'high'),
    item('Arrange snacks and drinks', 'food', 5, 'food'),
    item('Book a photographer', 'photography', 7, 'photography'),
    RSVPS
  ],
  wedding: [
    item('Book the venue', 'venue', 90, 'venue', 'urgent'),
    item('Book catering', 'catering', 60, 'food', 'high'),
    item('Book decorations', 'decor', 45, 'decor', 'high'),
    item('Book a photographer', 'photography', 60, 'photography', 'high'),
    item('Book music or a DJ', 'music', 30, 'music'),
    item('Send invitations to guests', 'guest_management', 30, null, 'high'),
    RSVPS
  ],
  corporate: [
    item('Book the venue', 'venue', 30, 'venue', 'high'),
    item('Book catering', 'catering', 14, 'food', 'high'),
    item('Book a photographer', 'photography', 10, 'photography'),
    item('Send invitations to attendees', 'guest_management', 14, null, 'high'),
    RSVPS
  ],
  farewell: [
    item('Fix the venue', 'venue', 14, 'venue', 'high'),
    GUESTS,
    item('Order a cake', 'food', 5, 'food'),
    item('Book decorations', 'decor', 7, 'decor'),
    item('Arrange a farewell gift', 'other', 5),
    RSVPS
  ],
  other: [
    item('Fix the venue', 'venue', 14, 'venue', 'high'),
    GUESTS,
    item('Plan food and drinks', 'food', 5, 'food'),
    RSVPS
  ]
};

/**
 * Checklist tasks for a new event, ready for Task.insertMany.
 * Due dates in the past (an event planned at short notice) fall back to today.
 */
exports.checklistFor = (event, userId) => {
  const template = TEMPLATES[event.eventType] || TEMPLATES.other;
  const eventDay = new Date(event.date).getTime();
  const now = Date.now();
  return template.map(t => ({
    event: event._id,
    createdBy: userId,
    taskName: t.taskName,
    category: t.category,
    serviceCategory: t.service || undefined,
    priority: t.priority,
    dueDate: new Date(Math.max(now, eventDay - t.daysBefore * 864e5))
  }));
};
