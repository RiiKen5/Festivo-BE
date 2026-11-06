const catchAsync = require('../utils/catchAsync');
const ApiResponse = require('../utils/apiResponse');
const seoService = require('../services/seoService');

// @desc    Public listings for the frontend build (crawlable pages, sitemap)
// @route   GET /api/v1/seo/pages
// @access  Public
exports.getPages = catchAsync(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(ApiResponse.success(await seoService.publicPages()));
});
