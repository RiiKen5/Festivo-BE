const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const { protect } = require('../middlewares/auth');
const { bookingLimiter } = require('../middlewares/rateLimiter');
const { validate, bookingValidations, paramValidations, paginationValidations } = require('../middlewares/validation');

// All routes are protected
router.use(protect);

router.get('/', paginationValidations, validate, bookingController.getBookings);
router.get('/stats', bookingController.getBookingStats);
router.get('/vendor/upcoming', bookingController.getVendorUpcomingBookings);
router.get('/event/:eventId', bookingController.getEventBookings);
router.get('/with/:userId', paramValidations.userId, validate, bookingController.getBookingsWithUser);
router.get('/:id', paramValidations.mongoId, validate, bookingController.getBooking);

router.post(
  '/',
  bookingLimiter,
  bookingValidations.create,
  validate,
  bookingController.createBooking
);

router.put('/:id', paramValidations.mongoId, validate, bookingController.updateBooking);

router.post('/:id/confirm', paramValidations.mongoId, validate, bookingController.confirmBooking);
router.post('/:id/cancel', paramValidations.mongoId, validate, bookingController.cancelBooking);
router.post('/:id/complete', paramValidations.mongoId, validate, bookingController.completeBooking);
router.post('/:id/arrive', paramValidations.mongoId, validate, bookingController.confirmArrival);
router.post('/:id/mark-arrived', paramValidations.mongoId, validate, bookingController.markArrived);
router.post('/:id/report-problem', paramValidations.mongoId, validate, bookingController.reportProblem);
router.post('/:id/dispute-response', paramValidations.mongoId, validate, bookingController.respondToDispute);
// Vendor records an offline (cash/UPI) payment they received.
// Organizers pay through /payments/bookings/:id/order.
router.put('/:id/payment', paramValidations.mongoId, validate, bookingController.recordPayment);

module.exports = router;
