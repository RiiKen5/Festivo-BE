const Task = require('../models/Task');
const Event = require('../models/Event');
const Notification = require('../models/Notification');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const ApiResponse = require('../utils/apiResponse');

// @desc    Get tasks for an event
// @route   GET /api/v1/tasks/event/:eventId
// @access  Private
exports.getEventTasks = catchAsync(async (req, res, next) => {
  const { status, priority, category, assignedTo, sort = 'dueDate' } = req.query;

  const event = await Event.findById(req.params.eventId);
  if (!event) {
    return next(new ApiError('Event not found', 404));
  }

  // Check authorization
  const isAuthorized =
    event.organizer.toString() === req.user._id.toString() ||
    event.coOrganizers.includes(req.user._id) ||
    req.user.role === 'admin';

  if (!isAuthorized) {
    return next(new ApiError('Not authorized to view tasks for this event', 403));
  }

  const query = { event: req.params.eventId };
  if (status) query.status = status;
  if (priority) query.priority = priority;
  if (category) query.category = category;
  if (assignedTo) query.assignedTo = assignedTo;

  const tasks = await Task.find(query)
    .populate('assignedTo', 'name profilePhoto')
    .populate('createdBy', 'name')
    .populate('linkedBooking', 'service status')
    .sort(sort)
    .lean();

  res.json(ApiResponse.success(tasks, 'Tasks retrieved successfully'));
});

// @desc    Get single task
// @route   GET /api/v1/tasks/:id
// @access  Private
exports.getTask = catchAsync(async (req, res, next) => {
  const task = await Task.findById(req.params.id)
    .populate('event', 'title organizer coOrganizers')
    .populate('assignedTo', 'name profilePhoto email')
    .populate('createdBy', 'name profilePhoto')
    .populate('linkedBooking');

  if (!task) {
    return next(new ApiError('Task not found', 404));
  }

  // Check authorization
  const event = task.event;
  const isAuthorized =
    event.organizer.toString() === req.user._id.toString() ||
    event.coOrganizers?.includes(req.user._id) ||
    task.assignedTo?._id.toString() === req.user._id.toString() ||
    req.user.role === 'admin';

  if (!isAuthorized) {
    return next(new ApiError('Not authorized to view this task', 403));
  }

  res.json(ApiResponse.success(task, 'Task retrieved successfully'));
});

// @desc    Create task
// @route   POST /api/v1/tasks
// @access  Private
exports.createTask = catchAsync(async (req, res, next) => {
  const { eventId, taskName, description, category, priority, dueDate, assignedTo, budgetAllocated, linkedBooking } = req.body;

  const event = await Event.findById(eventId);
  if (!event) {
    return next(new ApiError('Event not found', 404));
  }

  // Check authorization
  const isAuthorized =
    event.organizer.toString() === req.user._id.toString() ||
    event.coOrganizers.includes(req.user._id);

  if (!isAuthorized) {
    return next(new ApiError('Not authorized to create tasks for this event', 403));
  }

  const task = await Task.create({
    event: eventId,
    taskName,
    description,
    category,
    priority: priority || 'medium',
    dueDate,
    assignedTo,
    budgetAllocated,
    linkedBooking,
    createdBy: req.user._id
  });

  // Notify assigned user if different from creator
  if (assignedTo && assignedTo.toString() !== req.user._id.toString()) {
    await Notification.createNotification({
      recipient: assignedTo,
      type: 'task_assigned',
      title: 'Task Assigned',
      message: `You have been assigned a new task: ${taskName}`,
      relatedEvent: eventId,
      actionUrl: `/events/${eventId}/tasks`
    });
  }

  await task.populate('assignedTo', 'name profilePhoto');

  res.status(201).json(ApiResponse.success(task, 'Task created successfully'));
});

// @desc    Update task
// @route   PUT /api/v1/tasks/:id
// @access  Private
exports.updateTask = catchAsync(async (req, res, next) => {
  let task = await Task.findById(req.params.id).populate('event');

  if (!task) {
    return next(new ApiError('Task not found', 404));
  }

  // Check authorization
  const event = task.event;
  const isAuthorized =
    event.organizer.toString() === req.user._id.toString() ||
    event.coOrganizers?.includes(req.user._id) ||
    task.assignedTo?.toString() === req.user._id.toString();

  if (!isAuthorized) {
    return next(new ApiError('Not authorized to update this task', 403));
  }

  // If assigning to new user, notify them
  const previousAssignee = task.assignedTo?.toString();

  task = await Task.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true
  }).populate('assignedTo', 'name profilePhoto');

  // Notify new assignee
  if (req.body.assignedTo && req.body.assignedTo !== previousAssignee && req.body.assignedTo !== req.user._id.toString()) {
    await Notification.createNotification({
      recipient: req.body.assignedTo,
      type: 'task_assigned',
      title: 'Task Assigned',
      message: `You have been assigned a task: ${task.taskName}`,
      relatedEvent: task.event._id || task.event,
      actionUrl: `/events/${task.event._id || task.event}/tasks`
    });
  }

  res.json(ApiResponse.success(task, 'Task updated successfully'));
});

// @desc    Delete task
// @route   DELETE /api/v1/tasks/:id
// @access  Private
exports.deleteTask = catchAsync(async (req, res, next) => {
  const task = await Task.findById(req.params.id).populate('event');

  if (!task) {
    return next(new ApiError('Task not found', 404));
  }

  // Only event organizer can delete
  if (task.event.organizer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    return next(new ApiError('Not authorized to delete this task', 403));
  }

  await Task.findByIdAndDelete(req.params.id);

  res.json(ApiResponse.success(null, 'Task deleted successfully'));
});

// @desc    Update task status
// @route   PUT /api/v1/tasks/:id/status
// @access  Private
exports.updateTaskStatus = catchAsync(async (req, res, next) => {
  const { status } = req.body;
  const task = await Task.findById(req.params.id).populate('event');

  if (!task) {
    return next(new ApiError('Task not found', 404));
  }

  // Check authorization
  const event = task.event;
  const isAuthorized =
    event.organizer.toString() === req.user._id.toString() ||
    event.coOrganizers?.includes(req.user._id) ||
    task.assignedTo?.toString() === req.user._id.toString();

  if (!isAuthorized) {
    return next(new ApiError('Not authorized to update this task', 403));
  }

  task.status = status;
  await task.save();

  res.json(ApiResponse.success(task, 'Task status updated successfully'));
});

// @desc    Get my assigned tasks
// @route   GET /api/v1/tasks/my-tasks
// @access  Private
exports.getMyTasks = catchAsync(async (req, res, next) => {
  const { status, priority, sort = 'dueDate' } = req.query;

  const query = { assignedTo: req.user._id };
  if (status) query.status = status;
  if (priority) query.priority = priority;

  const tasks = await Task.find(query)
    .populate('event', 'title date city')
    .populate('createdBy', 'name')
    .sort(sort)
    .lean();

  res.json(ApiResponse.success(tasks, 'Your tasks retrieved successfully'));
});

// @desc    Get overdue tasks
// @route   GET /api/v1/tasks/event/:eventId/overdue
// @access  Private
exports.getOverdueTasks = catchAsync(async (req, res, next) => {
  const event = await Event.findById(req.params.eventId);
  if (!event) {
    return next(new ApiError('Event not found', 404));
  }

  // Check authorization
  if (event.organizer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    return next(new ApiError('Not authorized', 403));
  }

  const tasks = await Task.getOverdueTasks(req.params.eventId);

  res.json(ApiResponse.success(tasks, 'Overdue tasks retrieved'));
});

// @desc    Get task summary for event
// @route   GET /api/v1/tasks/event/:eventId/summary
// @access  Private
exports.getTaskSummary = catchAsync(async (req, res, next) => {
  const event = await Event.findById(req.params.eventId);
  if (!event) {
    return next(new ApiError('Event not found', 404));
  }

  // Check authorization
  const isAuthorized =
    event.organizer.toString() === req.user._id.toString() ||
    event.coOrganizers.includes(req.user._id);

  if (!isAuthorized) {
    return next(new ApiError('Not authorized', 403));
  }

  const summary = await Task.aggregate([
    { $match: { event: event._id } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        budgetAllocated: { $sum: '$budgetAllocated' },
        budgetSpent: { $sum: '$budgetSpent' }
      }
    }
  ]);

  // Get by category
  const byCategory = await Task.aggregate([
    { $match: { event: event._id } },
    {
      $group: {
        _id: '$category',
        total: { $sum: 1 },
        completed: {
          $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] }
        }
      }
    }
  ]);

  // Get overdue count
  const overdueCount = await Task.countDocuments({
    event: event._id,
    status: { $in: ['pending', 'in_progress'] },
    dueDate: { $lt: new Date() }
  });

  res.json(
    ApiResponse.success(
      { byStatus: summary, byCategory, overdueCount },
      'Task summary retrieved'
    )
  );
});

// @desc    Bulk update tasks
// @route   PUT /api/v1/tasks/bulk-update
// @access  Private
exports.bulkUpdateTasks = catchAsync(async (req, res, next) => {
  const { taskIds, updates } = req.body;

  if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
    return next(new ApiError('Task IDs required', 400));
  }

  // Verify all tasks belong to user's events
  const tasks = await Task.find({ _id: { $in: taskIds } }).populate('event');

  for (const task of tasks) {
    if (task.event.organizer.toString() !== req.user._id.toString()) {
      return next(new ApiError('Not authorized to update all selected tasks', 403));
    }
  }

  await Task.updateMany(
    { _id: { $in: taskIds } },
    updates
  );

  res.json(ApiResponse.success(null, 'Tasks updated successfully'));
});
