const tasks = require('./tasks');
const projects = require('./projects');
const journal = require('./journal');
const briefing = require('./briefing');

// Each skill = a tool Claude can call, plus the function that executes it.
const SKILLS = [
  {
    schema: {
      name: 'add_task',
      description: 'Add a new task/todo to track for the user.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'What needs to be done' },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
          due_date: { type: 'string', description: 'ISO date, optional' },
        },
        required: ['title'],
      },
    },
    run: (input) => tasks.addTask(input),
  },
  {
    schema: {
      name: 'list_tasks',
      description: 'List tasks, optionally filtered by status (open/done).',
      input_schema: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['open', 'done'] } },
      },
    },
    run: (input) => tasks.listTasks(input),
  },
  {
    schema: {
      name: 'complete_task',
      description: 'Mark a task as done by its id.',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'integer' } },
        required: ['id'],
      },
    },
    run: (input) => tasks.completeTask(input),
  },
  {
    schema: {
      name: 'add_project',
      description: 'Create a new project or money-making idea to track and develop.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          goal_revenue: { type: 'number', description: 'Target revenue in USD, optional' },
        },
        required: ['name'],
      },
    },
    run: (input) => projects.addProject(input),
  },
  {
    schema: {
      name: 'update_project',
      description: 'Update a project\'s status (idea/active/paused/shipped/killed) or notes.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          status: { type: 'string', enum: ['idea', 'active', 'paused', 'shipped', 'killed'] },
          notes: { type: 'string' },
        },
        required: ['id'],
      },
    },
    run: (input) => projects.updateProject(input),
  },
  {
    schema: {
      name: 'list_projects',
      description: 'List all tracked projects/income ideas and their status.',
      input_schema: { type: 'object', properties: {} },
    },
    run: () => projects.listProjects(),
  },
  {
    schema: {
      name: 'add_journal_entry',
      description: "Log a note about the user's life/day/mood, for keeping context over time.",
      input_schema: {
        type: 'object',
        properties: {
          mood: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['content'],
      },
    },
    run: (input) => journal.addEntry(input),
  },
  {
    schema: {
      name: 'get_summary',
      description: 'Get a full snapshot of open tasks, all projects, and recent journal entries. Use this to orient before giving a briefing or advice.',
      input_schema: { type: 'object', properties: {} },
    },
    run: () => briefing.getSummary(),
  },
];

const toolSchemas = SKILLS.map((s) => s.schema);
const toolMap = Object.fromEntries(SKILLS.map((s) => [s.schema.name, s.run]));

module.exports = { toolSchemas, toolMap };
