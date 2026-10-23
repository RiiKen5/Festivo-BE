const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');
const { protect } = require('../middlewares/auth');
const { uploadLimiter } = require('../middlewares/rateLimiter');

router.get('/:id', uploadController.getImage);
router.post('/', protect, uploadLimiter, uploadController.acceptImage('file'), uploadController.uploadImage);

module.exports = router;
