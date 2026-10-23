const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { protect, restrictTo } = require('../middlewares/auth');
const { paramValidations, validate } = require('../middlewares/validation');

router.use(protect, restrictTo('admin'));

router.get('/stats', adminController.getStats);
router.get('/growth', adminController.getGrowth);
router.get('/payouts', adminController.getPayouts);
router.post('/payouts/:id/mark-paid', paramValidations.mongoId, validate, adminController.markPayoutPaid);
router.get('/services/unverified', adminController.getUnverifiedServices);
router.get('/reviews/flagged', adminController.getFlaggedReviews);

module.exports = router;
