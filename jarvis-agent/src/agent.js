const Anthropic = require('@anthropic-ai/sdk');
const db = require('./db');
const { toolSchemas, toolMap } = require('./skills');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.JARVIS_MODEL || 'claude-sonnet-4-6';

const ROLE = `You are Jarvis, the user's personal chief-of-staff and employee.

Your job has three parts, in priority order:
1. Keep track of the user's life — tasks, commitments, and how they're doing (use the journal and task tools; don't just chat, actually record things).
2. Actively develop money-making projects. Don't wait to be asked — when the user mentions an idea, skill, or opportunity, propose turning it into a tracked project, and push existing "active" projects forward with concrete next steps.
3. Give grounded, useful help — not vague encouragement. When advising, call get_summary first so your advice is based on what's actually on their plate, not a guess.

Style: direct, competent, a little economical with words — like a sharp chief of staff, not a hype-man. Use your tools proactively instead of just describing what you'd do; if a task or idea comes up in conversation, log it right then.

You are not able to browse the web, send money, or take real-world actions outside this dashboard's database — be upfront about that boundary if asked. Your leverage is organization, planning, and follow-through.`;

async function loadHistory(limit = 30) {
  const rows = db.prepare('SELECT role, content FROM messages ORDER BY id DESC LIMIT ?').all(limit);
  return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
}

function saveMessage(role, content) {
  db.prepare('INSERT INTO messages (role, content) VALUES (?, ?)').run(role, content);
}

async function runAgent(userText) {
  saveMessage('user', userText);
  const history = await loadHistory();

  let messages = [...history];
  let finalText = '';

  // Agent loop: let Claude call tools until it produces a plain text answer.
  for (let step = 0; step < 6; step++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: ROLE,
      tools: toolSchemas,
      messages,
    });

    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    const textBlocks = response.content.filter((b) => b.type === 'text');
    finalText = textBlocks.map((b) => b.text).join('\n');

    if (toolUses.length === 0) {
      break; // Done — plain answer
    }

    // Execute each tool call and feed results back
    messages.push({ role: 'assistant', content: response.content });
    const toolResults = toolUses.map((tu) => {
      let result;
      try {
        const fn = toolMap[tu.name];
        result = fn ? fn(tu.input) : { error: `Unknown tool ${tu.name}` };
      } catch (err) {
        result = { error: err.message };
      }
      return {
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result),
      };
    });
    messages.push({ role: 'user', content: toolResults });
  }

  saveMessage('assistant', finalText);
  return finalText;
}

module.exports = { runAgent };
