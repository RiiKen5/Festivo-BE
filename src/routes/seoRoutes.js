const express = require('express');
const router = express.Router();
const seoController = require('../controllers/seoController');

router.get('/pages', seoController.getPages);

module.exports = router;
