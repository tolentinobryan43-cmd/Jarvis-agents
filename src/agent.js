const { GoogleGenAI } = require('@google/genai');
const { pool } = require('./db');
const { toolSchemas, toolMap } = require('./skills');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.JARVIS_MODEL || 'gemini-2.5-flash';

const functionDeclarations = toolSchemas.map((s) => ({
  name: s.name,
  description: s.description,
  parametersJsonSchema: s.input_schema,
}));

const ROLE = `You are Jarvis, the user's personal chief-of-staff and employee.

Your job has three parts, in priority order:
1. Keep track of the user's life — tasks, commitments, and how they're doing (use the journal and task tools; don't just chat, actually record things).
2. Actively develop money-making projects. Don't wait to be asked — when the user mentions an idea, skill, or opportunity, propose turning it into a tracked project, and push existing "active" projects forward with concrete next steps.
3. Give grounded, useful help — not vague encouragement. When advising, call get_summary first so your advice is based on what's actually on their plate, not a guess.

Style: direct, competent, a little economical with words — like a sharp chief of staff, not a hype-man. Use your tools proactively instead of just describing what you'd do; if a task or idea comes up in conversation, log it right then.

You are not able to browse the web, send money, or take real-world actions outside this dashboard's database — be upfront about that boundary if asked. Your leverage is organization, planning, and follow-through.`;

async function loadHistory(limit = 30) {
  const [rows] = await pool.query('SELECT role, content FROM messages ORDER BY id DESC LIMIT ?', [limit]);
  return rows.reverse().map((r) => ({
    role: r.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: r.content }],
  }));
}

async function saveMessage(role, content) {
  await pool.query('INSERT INTO messages (role, content) VALUES (?, ?)', [role, content]);
}

async function runAgent(userText) {
  await saveMessage('user', userText);
  const contents = await loadHistory();
  let finalText = '';

  // Agent loop: let Gemini call tools until it produces a plain text answer.
  for (let step = 0; step < 6; step++) {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction: ROLE,
        tools: [{ functionDeclarations }],
      },
    });

    const calls = response.functionCalls || [];
    finalText = response.text || '';

    if (calls.length === 0) {
      break; // Done — plain answer
    }

    // Echo the model's turn back, then execute each tool call and feed results back
    contents.push(response.candidates[0].content);
    const responseParts = await Promise.all(
      calls.map(async (call) => {
        let result;
        try {
          const fn = toolMap[call.name];
          result = fn ? await fn(call.args) : { error: `Unknown tool ${call.name}` };
        } catch (err) {
          result = { error: err.message };
        }
        return { functionResponse: { name: call.name, response: { result } } };
      })
    );
    contents.push({ role: 'user', parts: responseParts });
  }

  await saveMessage('assistant', finalText);
  return finalText;
}

module.exports = { runAgent };
