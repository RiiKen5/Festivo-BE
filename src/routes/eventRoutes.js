const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');
const { protect, optionalAuth } = require('../middlewares/auth');
const { cache } = require('../middlewares/cache');
const { validate, eventValidations, paramValidations, paginationValidations } = require('../middlewares/validation');

// Public routes (with optional auth for personalization)
router.get('/', optionalAuth, cache(300), paginationValidations, validate, eventController.getEvents);
router.get('/upcoming', cache(300), eventController.getUpcomingEvents);
router.get('/popular', cache(300), eventController.getPopularEvents);
router.get('/nearby', eventController.getNearbyEvents);
router.get('/slug/:slug', cache(60), eventController.getEventBySlug);
router.get('/:id', paramValidations.mongoId, validate, eventController.getEvent);

// Protected routes
router.use(protect);

router.get('/my-events', eventController.getMyEvents);

router.post(
  '/',
  eventValidations.create,
  validate,
  eventController.createEvent
);

router.put(
  '/:id',
  paramValidations.mongoId,
  eventValidations.update,
  validate,
  eventController.updateEvent
);

router.delete('/:id', paramValidations.mongoId, validate, eventController.deleteEvent);

router.post('/:id/publish', paramValidations.mongoId, validate, eventController.publishEvent);
router.post('/:id/unpublish', paramValidations.mongoId, validate, eventController.unpublishEvent);
router.post('/:id/cancel', paramValidations.mongoId, validate, eventController.cancelEvent);
router.post('/:id/complete', paramValidations.mongoId, validate, eventController.completeEvent);

router.post('/:id/co-organizers', paramValidations.mongoId, validate, eventController.addCoOrganizer);
router.delete('/:id/co-organizers/:userId', eventController.removeCoOrganizer);

module.exports = router;
