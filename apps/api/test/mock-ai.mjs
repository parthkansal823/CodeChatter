// A stand-in AI server for tests: speaks the OpenAI chat-completions API
// (streaming), so the AI copilot can be tested without a paid key.
//
//   node test/mock-ai.mjs               (from apps/api; listens on 127.0.0.1:4792)
//
// Point the API at it in .env, then restart the API:
//   AI_PROVIDER=openai
//   OPENAI_BASE_URL=http://127.0.0.1:4792/v1
//   OPENAI_API_KEY=mock
//   AI_MODEL=mock
//
// Answers depend on the mode in the system prompt:
//   Edit:   one code block that replaces the file
//   Agent:  a plan, then <create> and <run> for the last *.py name in the question
//   others: a short Markdown answer that echoes the question
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_AI_PORT ?? 4792);

function answerFor(messages) {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const question = typeof lastUser?.content === "string" ? lastUser.content : (lastUser?.content ?? []).map((part) => part.text ?? "").join(" ");
  const text = String(system);
  if (text.includes("Mode: Edit.")) {
    return 'Here is the change.\n\n```python\nprint("edited by the AI")\n```\n';
  }
  if (text.includes("Mode: Agent.")) {
    // The last name mentioned: attached context (the file list) comes before the question.
    const file = [...question.matchAll(/([\w./-]+\.py)\b/g)].at(-1)?.[1] ?? "agent_made.py";
    return `<plan>\n1. Create ${file}.\n2. Run it.\n</plan>\n<create path="${file}">\nprint("made by the agent")\n</create>\n<run path="${file}"/>\n`;
  }
  const asked = question.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return `**Mock answer.** You asked: "${asked}"\n\n\`\`\`python\nprint("hello from the mock")\n\`\`\`\n`;
}

// Small pieces, a little apart, so the client really streams.
function* pieces(text) {
  for (let i = 0; i < text.length; i += 12) yield text.slice(i, i + 12);
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url?.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [{ id: "mock", object: "model", owned_by: "test" }] }));
    return;
  }
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body || "{}");
  const answer = answerFor(request.messages ?? []);
  const base = { id: `mock-${Date.now()}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: request.model ?? "mock" };

  if (!request.stream) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ...base, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } }));
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  for (const piece of pieces(answer)) {
    if (res.destroyed) return;
    send({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: Math.ceil(answer.length / 4), total_tokens: 50 + Math.ceil(answer.length / 4) } });
  res.end("data: [DONE]\n\n");
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock AI on http://127.0.0.1:${PORT}/v1`));
