const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect, restrictTo } = require('../middlewares/auth');
const { paramValidations, validate, paginationValidations } = require('../middlewares/validation');

// Public routes
router.get('/search', protect, userController.searchUsers);
router.get('/vendors', paginationValidations, validate, userController.getVendors);
router.get('/:id/profile', paramValidations.mongoId, validate, userController.getUserProfile);
router.get('/:id/stats', paramValidations.mongoId, validate, userController.getUserStats);

// Protected routes
router.use(protect);

router.get('/nearby', userController.getNearbyUsers);

// Admin routes
router.get('/', restrictTo('admin'), paginationValidations, validate, userController.getUsers);
router.get('/:id', restrictTo('admin'), paramValidations.mongoId, validate, userController.getUser);
router.put('/:id', restrictTo('admin'), paramValidations.mongoId, validate, userController.updateUser);
router.delete('/:id', restrictTo('admin'), paramValidations.mongoId, validate, userController.deleteUser);
router.post('/:id/ban', restrictTo('admin'), paramValidations.mongoId, validate, userController.banUser);
router.post('/:id/unban', restrictTo('admin'), paramValidations.mongoId, validate, userController.unbanUser);
router.post('/:id/verify', restrictTo('admin'), paramValidations.mongoId, validate, userController.verifyUser);

module.exports = router;
