import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");

function loadEnv() {
  try {
    const text = requireEnvFile();
    for (const line of text.split(/\\r?\\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const i = trimmed.indexOf("=");
      if (i === -1) continue;
      const key = trimmed.slice(0, i).trim();
      const value = trimmed.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

async function requireEnvFile() {
  return await readFile(join(root, ".env"), "utf8");
}

loadEnv();

const provider = process.env.AI_PROVIDER || "openrouter";
const model = process.env.AI_MODEL || "google/gemini-2.5-flash";

function providerConfig() {
  if (provider === "openrouter") {
    return {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      headers: {
        "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
        "X-Title": process.env.APP_NAME || "Personal AI Assistant"
      }
    };
  }

  if (provider === "ollama") {
    return {
      baseUrl: process.env.AI_BASE_URL || "http://127.0.0.1:11434/v1",
      apiKey: process.env.AI_API_KEY || "ollama",
      headers: {}
    };
  }

  return {
    baseUrl: process.env.AI_BASE_URL || "https://api.openai.com/v1",
    apiKey: process.env.AI_API_KEY,
    headers: {}
  };
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function body(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (raw.length > 2_000_000) throw new Error("Request is too large.");
  return JSON.parse(raw || "{}");
}

async function chat(messages, selectedModel) {
  const config = providerConfig();
  if (!config.apiKey && provider !== "ollama") {
    throw new Error("No API key configured. Copy .env.example to .env and add your provider key.");
  }

  const response = await fetch(config.baseUrl + "/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...config.headers
    },
    body: JSON.stringify({
      model: selectedModel || model,
      messages,
      temperature: 0.7,
      stream: false
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Model provider returned HTTP ${response.status}`);
  }

  return {
    message: data?.choices?.[0]?.message?.content ?? "",
    model: data?.model || selectedModel || model,
    usage: data?.usage || null
  };
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET" && url.pathname === "/api/config") {
      return json(res, 200, {
        provider,
        model,
        configured: Boolean(provider === "ollama" || providerConfig().apiKey)
      });
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      const input = await body(req);
      if (!Array.isArray(input.messages) || input.messages.length === 0) {
        return json(res, 400, { error: "messages must be a non-empty array" });
      }

      const messages = input.messages
        .filter(m => m && ["system", "user", "assistant"].includes(m.role) && typeof m.content === "string")
        .slice(-40);

      const result = await chat(messages, input.model);
      return json(res, 200, result);
    }

    const filePath = url.pathname === "/"
      ? join(publicDir, "index.html")
      : join(publicDir, url.pathname.replace(/^\\/+/, ""));

    if (!filePath.startsWith(publicDir)) return json(res, 403, { error: "Forbidden" });

    const file = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mime[extname(filePath)] || "application/octet-stream" });
    return res.end(file);
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: error.message || "Unexpected server error" });
  }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`Personal AI Assistant running at http://localhost:${port}`);
});
