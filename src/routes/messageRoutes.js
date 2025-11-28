const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const { protect } = require('../middlewares/auth');
const { messageLimiter } = require('../middlewares/rateLimiter');
const { validate, messageValidations, paramValidations, paginationValidations } = require('../middlewares/validation');

// All routes are protected
router.use(protect);

router.get('/conversations', messageController.getConversations);
router.get('/unread-count', messageController.getUnreadCount);
router.get('/conversation/:userId', paginationValidations, validate, messageController.getConversation);
router.get('/booking/:bookingId', paginationValidations, validate, messageController.getBookingMessages);
router.get('/search', messageController.searchMessages);

router.post(
  '/',
  messageLimiter,
  messageValidations.create,
  validate,
  messageController.sendMessage
);

router.post('/with-attachment', messageLimiter, messageController.sendMessageWithAttachment);

router.put('/read/:userId', messageController.markAsRead);
router.delete('/:id', paramValidations.mongoId, validate, messageController.deleteMessage);

module.exports = router;
