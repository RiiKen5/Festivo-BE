const express = require('express');
const router = express.Router();
const serviceController = require('../controllers/serviceController');
const { protect, restrictTo } = require('../middlewares/auth');
const { cache } = require('../middlewares/cache');
const { validate, serviceValidations, paramValidations, paginationValidations } = require('../middlewares/validation');

// Public routes
router.get('/', cache(300), paginationValidations, validate, serviceController.getServices);
router.get('/top-rated', cache(300), serviceController.getTopRatedServices);
router.get('/nearby', serviceController.getNearbyServices);
router.get('/category/:category', cache(300), paginationValidations, validate, serviceController.getServicesByCategory);
router.get('/slug/:slug', cache(60), serviceController.getServiceBySlug);

// Protected route - must be before /:id to avoid matching "my-services" as an id
router.get('/my-services', protect, serviceController.getMyServices);

router.get('/:id', paramValidations.mongoId, validate, serviceController.getService);
router.get('/:id/check-availability', paramValidations.mongoId, validate, serviceController.checkAvailability);

// Protected routes
router.use(protect);

router.post(
  '/',
  serviceValidations.create,
  validate,
  serviceController.createService
);

router.put(
  '/:id',
  paramValidations.mongoId,
  validate,
  serviceController.updateService
);

router.delete('/:id', paramValidations.mongoId, validate, serviceController.deleteService);

router.put('/:id/availability', paramValidations.mongoId, validate, serviceController.updateAvailability);
router.get('/:id/stats', paramValidations.mongoId, validate, serviceController.getServiceStats);

// Admin routes
router.post('/:id/verify', restrictTo('admin'), paramValidations.mongoId, validate, serviceController.verifyService);

module.exports = router;
