const RSVP = require('../models/RSVP');
const { safeEqual } = require('./helpers');

/**
 * Decide whether a user may see (and join) an event.
 * Private, draft and cancelled events are visible to their organizers,
 * admins, people holding the invite code, and people who already RSVP'd.
 * The event must be loaded with `+inviteCode` for invite links to work.
 * @param {object} event - Event document
 * @param {object} [user] - Authenticated user, if any
 * @param {string} [inviteCode] - Invite code from the invite link
 * @returns {Promise<boolean>}
 */
exports.canAccessEvent = async (event, user, inviteCode) => {
  if (event.isOpenToPublic()) return true;
  if (user && (user.role === 'admin' || event.isOrganizedBy(user))) return true;
  if (inviteCode && event.inviteCode && safeEqual(inviteCode, event.inviteCode)) return true;
  if (user && await RSVP.exists({ event: event._id, attendee: user._id })) return true;
  return false;
};

/**
 * Serialize an event, exposing the invite code only to its organizers
 * @param {object} event - Event document
 * @param {object} [user] - Authenticated user, if any
 * @returns {object}
 */
exports.serializeEvent = (event, user) => {
  const obj = event.toJSON();
  if (!user || !(user.role === 'admin' || event.isOrganizedBy(user))) {
    delete obj.inviteCode;
  }
  return obj;
};
