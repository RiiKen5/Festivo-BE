const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { protect } = require('../middlewares/auth');
const { paramValidations, validate } = require('../middlewares/validation');
const { guestRsvpLimiter } = require('../middlewares/rateLimiter');

// The webhook is mounted separately in app.js because it needs the raw body

router.get('/config', paymentController.getConfig);
router.post('/guest/verify', guestRsvpLimiter, paymentController.verifyGuestPayment);

router.use(protect);

router.get('/mine', paymentController.getMyPayments);
router.post('/bookings/:id/order', paramValidations.mongoId, validate, paymentController.createBookingOrder);
router.post('/rsvps/:id/order', paramValidations.mongoId, validate, paymentController.createTicketOrder);
router.post('/verify', paymentController.verifyPayment);

module.exports = router;
