const express = require('express');
const router = express.Router();
const offerController = require('../controllers/offerController');
const { protect } = require('../middlewares/auth');
const { paramValidations, validate } = require('../middlewares/validation');

router.use(protect);

router.get('/leads', offerController.getLeads);
router.get('/mine', offerController.getMine);
router.post('/', offerController.createOffer);
router.get('/events/:id', paramValidations.mongoId, validate, offerController.getEventOffers);
router.put('/events/:id/settings', paramValidations.mongoId, validate, offerController.updateSettings);
router.post('/:id/accept', paramValidations.mongoId, validate, offerController.acceptOffer);
router.post('/:id/decline', paramValidations.mongoId, validate, offerController.declineOffer);
router.post('/:id/withdraw', paramValidations.mongoId, validate, offerController.withdrawOffer);

module.exports = router;
