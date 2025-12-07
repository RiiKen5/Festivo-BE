const express = require('express');
const router = express.Router();
const rsvpController = require('../controllers/rsvpController');
const { protect } = require('../middlewares/auth');
const { validate, rsvpValidations, paramValidations, paginationValidations } = require('../middlewares/validation');

// All routes are protected
router.use(protect);

router.get('/my-rsvps', paginationValidations, validate, rsvpController.getMyRSVPs);
router.get('/event/:eventId', paginationValidations, validate, rsvpController.getEventRSVPs);
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
