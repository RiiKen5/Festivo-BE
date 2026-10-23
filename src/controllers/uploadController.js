const multer = require('multer');
const mongoose = require('mongoose');
const Image = require('../models/Image');
const User = require('../models/User');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const ApiResponse = require('../utils/apiResponse');
const { storeImage } = require('../services/imageStorage');

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

// Accept one image in field `field`, held in memory for processing
exports.acceptImage = (field) => multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(new ApiError('Only JPEG, PNG, WebP or HEIC images are allowed', 400));
  }
}).single(field);

const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;

// @desc    Upload an image (event covers, service portfolios, ...)
// @route   POST /api/v1/uploads   (multipart field: file)
// @access  Private
exports.uploadImage = catchAsync(async (req, res, next) => {
  if (!req.file) {
    return next(new ApiError('Please choose an image to upload', 400));
  }

  const url = await storeImage(req.file, req.user, baseUrl(req));
  res.status(201).json(ApiResponse.success({ url }, 'Image uploaded'));
});

// @desc    Upload and set the current user's profile photo
// @route   POST /api/v1/auth/upload-avatar   (multipart field: profilePhoto)
// @access  Private
exports.uploadAvatar = catchAsync(async (req, res, next) => {
  if (!req.file) {
    return next(new ApiError('Please choose a photo to upload', 400));
  }

  const url = await storeImage(req.file, req.user, baseUrl(req), 512);
  await User.findByIdAndUpdate(req.user._id, { profilePhoto: url });

  res.json(ApiResponse.success({ profilePhoto: url }, 'Profile photo updated'));
});

// @desc    Serve an image stored in the database
// @route   GET /api/v1/uploads/:id
// @access  Public
exports.getImage = catchAsync(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return next(new ApiError('Image not found', 404));
  }

  const image = await Image.findById(req.params.id).select('data contentType').lean();
  if (!image) {
    return next(new ApiError('Image not found', 404));
  }

  res.set({
    'Content-Type': image.contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
    // The web app is on another origin
    'Cross-Origin-Resource-Policy': 'cross-origin'
  });
  res.send(image.data.buffer ? Buffer.from(image.data.buffer) : image.data);
});
