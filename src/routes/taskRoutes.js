const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');
const { protect } = require('../middlewares/auth');
const { validate, taskValidations, paramValidations } = require('../middlewares/validation');

// All routes are protected
router.use(protect);

router.get('/my-tasks', taskController.getMyTasks);
router.get('/event/:eventId', taskController.getEventTasks);
router.get('/event/:eventId/overdue', taskController.getOverdueTasks);
router.get('/event/:eventId/summary', taskController.getTaskSummary);
router.get('/:id', paramValidations.mongoId, validate, taskController.getTask);

router.post(
  '/',
  taskValidations.create,
  validate,
  taskController.createTask
);

router.put('/:id', paramValidations.mongoId, validate, taskController.updateTask);
router.put('/:id/status', paramValidations.mongoId, validate, taskController.updateTaskStatus);
router.delete('/:id', paramValidations.mongoId, validate, taskController.deleteTask);

router.put('/bulk-update', taskController.bulkUpdateTasks);

module.exports = router;
