const Event = require('../models/Event');
const Offer = require('../models/Offer');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const ApiResponse = require('../utils/apiResponse');
const offerService = require('../services/offerService');

const loadEvent = async (id) => {
  const event = await Event.findById(id);
  if (!event) throw new ApiError('Event not found', 404);
  return event;
};

const loadOffer = async (id) => {
  const offer = await Offer.findById(id);
  if (!offer) throw new ApiError('Offer not found', 404);
  return offer;
};

// @desc    Open or close an event to vendor offers
// @route   PUT /api/v1/offers/events/:id/settings   { open, needs, note }
// @access  Private (organizer)
exports.updateSettings = catchAsync(async (req, res) => {
  const settings = await offerService.updateSettings(await loadEvent(req.params.id), req.user, req.body);
  res.json(ApiResponse.success(settings, settings.open ? 'Vendors can now send offers' : 'Offers closed'));
});

// @desc    Offers on an event
// @route   GET /api/v1/offers/events/:id
// @access  Private (organizer)
exports.getEventOffers = catchAsync(async (req, res) => {
  const event = await loadEvent(req.params.id);
  const offers = await offerService.forEvent(event, req.user);
  res.json(ApiResponse.success({ settings: event.vendorOffers, offers }, 'Offers retrieved'));
});

// @desc    Events a vendor can send offers to
// @route   GET /api/v1/offers/leads
// @access  Private (vendor)
exports.getLeads = catchAsync(async (req, res) => {
  res.json(ApiResponse.success(await offerService.leads(req.user), 'Events retrieved'));
});

// @desc    Offers the vendor sent
// @route   GET /api/v1/offers/mine
// @access  Private (vendor)
exports.getMine = catchAsync(async (req, res) => {
  res.json(ApiResponse.success(await offerService.mine(req.user), 'Offers retrieved'));
});

// @desc    Send an offer
// @route   POST /api/v1/offers   { eventId, serviceId, price, message }
// @access  Private (vendor)
exports.createOffer = catchAsync(async (req, res) => {
  const offer = await offerService.create(req.user, req.body);
  res.status(201).json(ApiResponse.success(offer, 'Offer sent'));
});

// @route   POST /api/v1/offers/:id/accept
exports.acceptOffer = catchAsync(async (req, res) => {
  const { offer, booking } = await offerService.accept(await loadOffer(req.params.id), req.user);
  res.json(ApiResponse.success({ offer, booking }, 'Offer accepted'));
});

// @route   POST /api/v1/offers/:id/decline
exports.declineOffer = catchAsync(async (req, res) => {
  res.json(ApiResponse.success(await offerService.decline(await loadOffer(req.params.id), req.user), 'Offer declined'));
});

// @route   POST /api/v1/offers/:id/withdraw
exports.withdrawOffer = catchAsync(async (req, res) => {
  res.json(ApiResponse.success(await offerService.withdraw(await loadOffer(req.params.id), req.user), 'Offer withdrawn'));
});
