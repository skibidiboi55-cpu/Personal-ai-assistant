import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");

async function loadEnv() {
  try {
    const text = await readFile(join(root, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator < 0) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

await loadEnv();

const provider = process.env.AI_PROVIDER || "openrouter";
const model = process.env.AI_MODEL || "google/gemini-2.5-flash";

function providerConfig() {
  if (provider === "openrouter") {
    return {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      headers: {
        "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
        "X-Title": process.env.APP_NAME || "Personal AI Assistant",
      },
    };
  }
  if (provider === "ollama") {
    return {
      baseUrl: process.env.AI_BASE_URL || "http://127.0.0.1:11434/v1",
      apiKey: process.env.AI_API_KEY || "ollama",
      headers: {},
    };
  }
  return {
    baseUrl: process.env.AI_BASE_URL || "https://api.openai.com/v1",
    apiKey: process.env.AI_API_KEY,
    headers: {},
  };
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) throw Object.assign(new Error("Request is too large."), { status: 413 });
  }
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 });
  }
}

async function chat(messages, selectedModel) {
  const config = providerConfig();
  if (!config.apiKey && provider !== "ollama") {
    throw new Error("No API key configured. Copy .env.example to .env and add your provider key.");
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...config.headers,
    },
    body: JSON.stringify({
      model: selectedModel || model,
      messages,
      temperature: 0.7,
      stream: false,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Model provider returned HTTP ${response.status}`);
  }
  return {
    message: data?.choices?.[0]?.message?.content ?? "",
    model: data?.model || selectedModel || model,
    usage: data?.usage || null,
  };
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET" && url.pathname === "/api/config") {
      return json(res, 200, {
        provider,
        model,
        configured: Boolean(provider === "ollama" || providerConfig().apiKey),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      const input = await readBody(req);
      if (!Array.isArray(input.messages) || !input.messages.length) {
        return json(res, 400, { error: "messages must be a non-empty array" });
      }
      const messages = input.messages
        .filter((item) =>
          item &&
          ["system", "user", "assistant"].includes(item.role) &&
          typeof item.content === "string"
        )
        .slice(-40);
      return json(res, 200, await chat(messages, input.model));
    }

    if (url.pathname.startsWith("/api/")) {
      return json(res, 404, { error: "API route not found" });
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return json(res, 405, { error: "Method not allowed" });
    }

    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return json(res, 400, { error: "Invalid URL path" });
    }
    const relativePath = pathname === "/" ? "index.html" : (pathname.startsWith("/") ? pathname.slice(1) : pathname);
    const filePath = resolve(publicDir, relativePath);
    if (!filePath.startsWith(publicDir + sep)) {
      return json(res, 403, { error: "Forbidden" });
    }

    const file = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mime[extname(filePath)] || "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : file);
  } catch (error) {
    if (error.code === "ENOENT") return json(res, 404, { error: "File not found" });
    console.error(error);
    json(res, error.status || 500, { error: error.message || "Unexpected error" });
  }
});

const firstPort = Number(process.env.PORT || 3000);
const lastPort = firstPort + 20;

function listenOn(port) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && port < lastPort) {
      console.warn(`Port ${port} is already in use; trying ${port + 1}.`);
      return listenOn(port + 1);
    }
    console.error(`Could not start the server on ports ${firstPort}-${port}: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, () => {
    const actualPort = server.address().port;
    console.log(`Personal AI Assistant running at http://localhost:${actualPort}`);
  });
}

listenOn(firstPort);
