const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { protect } = require('../middlewares/auth');
const { validate, paramValidations, paginationValidations } = require('../middlewares/validation');

// All routes are protected
router.use(protect);

router.get('/', paginationValidations, validate, notificationController.getNotifications);
router.get('/unread-count', notificationController.getUnreadCount);
router.get('/preferences', notificationController.getPreferences);

router.put('/read-all', notificationController.markAllAsRead);
router.put('/preferences', notificationController.updatePreferences);
router.put('/:id/read', paramValidations.mongoId, validate, notificationController.markAsRead);

router.delete('/clear-read', notificationController.clearReadNotifications);
router.delete('/:id', paramValidations.mongoId, validate, notificationController.deleteNotification);

module.exports = router;
