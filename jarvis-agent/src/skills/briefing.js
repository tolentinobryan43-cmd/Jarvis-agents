const tasks = require('./tasks');
const projects = require('./projects');
const journal = require('./journal');

function getSummary() {
  return {
    open_tasks: tasks.listTasks({ status: 'open' }),
    projects: projects.listProjects(),
    recent_journal: journal.listEntries({ limit: 5 }),
    generated_at: new Date().toISOString(),
  };
}

module.exports = { getSummary };
