const tasks = require('./tasks');
const projects = require('./projects');
const journal = require('./journal');

async function getSummary() {
  return {
    open_tasks: await tasks.listTasks({ status: 'open' }),
    projects: await projects.listProjects(),
    recent_journal: await journal.listEntries({ limit: 5 }),
    generated_at: new Date().toISOString(),
  };
}

module.exports = { getSummary };
