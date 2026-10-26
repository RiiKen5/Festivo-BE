const express = require('express');
const { guestRsvpLimiter } = require('../middlewares/rateLimiter');
const router = express.Router();
const rsvpController = require('../controllers/rsvpController');
const { protect } = require('../middlewares/auth');
const { validate, rsvpValidations, paramValidations, paginationValidations } = require('../middlewares/validation');

// RSVP without an account, from the invite link (free events only)
router.post('/guest', guestRsvpLimiter, rsvpController.createGuestRSVP);
router.get('/guest', guestRsvpLimiter, rsvpController.getGuestRSVP);

// Everything else needs a signed-in user
router.use(protect);

router.get('/my-rsvps', paginationValidations, validate, rsvpController.getMyRSVPs);
// Organizers load the whole guest list, so this allows more than the usual page size
router.get('/event/:eventId', rsvpController.getEventRSVPs);
router.get('/event/:eventId/my-rsvp', rsvpController.getMyRSVP);
router.get('/event/:eventId/stats', rsvpController.getRSVPStats);

router.post(
  '/',
  rsvpValidations.create,
  validate,
  rsvpController.createRSVP
);

router.put('/:id', paramValidations.mongoId, validate, rsvpController.updateRSVP);
router.delete('/:id', paramValidations.mongoId, validate, rsvpController.cancelRSVP);

router.post('/:id/check-in', paramValidations.mongoId, validate, rsvpController.checkInAttendee);
router.post('/check-in-code', rsvpController.checkInByCode);
router.post('/:id/attended', paramValidations.mongoId, validate, rsvpController.markAttended);
router.post('/:id/rate', paramValidations.mongoId, validate, rsvpController.rateEvent);

module.exports = router;
