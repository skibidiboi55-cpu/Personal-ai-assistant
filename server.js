import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const execFileAsync = promisify(execFile);

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

let provider = process.env.AI_PROVIDER || "openrouter";
let model = process.env.AI_MODEL || "google/gemini-2.5-flash";

let modelCache = { expiresAt: 0, value: null };

function stripJsonComments(text) {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
    } else if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index++;
      output += "\n";
    } else if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index++;
      index++;
    } else {
      output += char;
    }
  }
  return output.replace(/,\s*([}\]])/g, "$1");
}

async function readOpenCodeDefaultModel() {
  if (process.env.OPENCODE_CONFIG_CONTENT) {
    try {
      const inlineConfig = JSON.parse(stripJsonComments(process.env.OPENCODE_CONFIG_CONTENT));
      if (typeof inlineConfig.model === "string" && inlineConfig.model.includes("/")) return inlineConfig.model;
    } catch {}
  }
  const candidates = [
    process.env.OPENCODE_CONFIG,
    join(root, "opencode.json"),
    join(root, "opencode.jsonc"),
    join(root, ".opencode", "opencode.json"),
    join(root, ".opencode", "opencode.jsonc"),
    join(homedir(), ".config", "opencode", "opencode.json"),
    join(homedir(), ".config", "opencode", "opencode.jsonc"),
  ].filter(Boolean);
  for (const path of candidates) {
    try {
      const content = await readFile(path, "utf8");
      const config = JSON.parse(stripJsonComments(content));
      if (typeof config.model === "string" && config.model.includes("/")) return config.model;
    } catch (error) {
      if (error.code !== "ENOENT") console.warn(`Could not read OpenCode config at ${path}: ${error.message}`);
    }
  }
  return null;
}

async function getOpenCodeModels(refresh = false) {
  if (!refresh && modelCache.value && modelCache.expiresAt > Date.now()) return modelCache.value;
  try {
    const { stdout } = await execFileAsync("opencode", ["models"], {
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 5_000_000,
      windowsHide: true,
      shell: process.platform === "win32",
    });
    const models = [...new Set(stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[^/\s]+\/.+/.test(line)))];
    const defaultModel = await readOpenCodeDefaultModel();
    const result = { available: true, models, defaultModel, error: null };
    modelCache = { value: result, expiresAt: Date.now() + 60_000 };
    return result;
  } catch (error) {
    const result = {
      available: false,
      models: [],
      defaultModel: null,
      error: error.code === "ENOENT" ? "OpenCode CLI was not found on PATH." : "Could not read models from OpenCode CLI.",
    };
    modelCache = { value: result, expiresAt: Date.now() + 15_000 };
    return result;
  }
}

async function saveSettings(input) {
  const nextProvider = ["openrouter", "openai-compatible", "ollama"].includes(input.provider)
    ? input.provider
    : null;
  if (!nextProvider) throw Object.assign(new Error("Choose a supported provider."), { status: 400 });
  const nextModel = typeof input.model === "string" && input.model.trim() ? input.model.trim() : model;
  const clearKey = input.clearKey === true;
  if (typeof input.apiKey === "string" && /[\r\n]/.test(input.apiKey)) {
    throw Object.assign(new Error("API keys cannot contain line breaks."), { status: 400 });
  }
  const updates = { AI_PROVIDER: nextProvider, AI_MODEL: nextModel };
  if (nextProvider === "openrouter") {
    if (typeof input.apiKey === "string" && input.apiKey.trim()) updates.OPENROUTER_API_KEY = input.apiKey.trim();
    else if (clearKey) updates.OPENROUTER_API_KEY = "";
  } else if (nextProvider !== "ollama") {
    if (typeof input.apiKey === "string" && input.apiKey.trim()) updates.AI_API_KEY = input.apiKey.trim();
    else if (clearKey) updates.AI_API_KEY = "";
  }
  if (nextProvider !== "openrouter" && typeof input.baseUrl === "string" && input.baseUrl.trim()) {
    try {
      const parsed = new URL(input.baseUrl.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      updates.AI_BASE_URL = parsed.toString().replace(/\/$/, "");
    } catch {
      throw Object.assign(new Error("Enter a valid HTTP or HTTPS API URL."), { status: 400 });
    }
  }

  const envPath = join(root, ".env");
  let lines = [];
  try {
    lines = (await readFile(envPath, "utf8")).split(/\r?\n/);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const written = new Set();
  lines = lines.map((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match || !(match[1] in updates)) return line;
    written.add(match[1]);
    return `${match[1]}=${updates[match[1]]}`;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!written.has(key)) lines.push(`${key}=${value}`);
    process.env[key] = value;
  }
  await writeFile(envPath, `${lines.join("\n").trimEnd()}\n`, { encoding: "utf8", mode: 0o600 });
  provider = nextProvider;
  model = nextModel;
  modelCache = { expiresAt: 0, value: null };
  return { configured: Boolean(provider === "ollama" || (provider === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.AI_API_KEY)), provider, model };
}

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

    if (req.method === "GET" && url.pathname === "/api/models") {
      return json(res, 200, await getOpenCodeModels(url.searchParams.get("refresh") === "1"));
    }

    if (req.method === "POST" && url.pathname === "/api/settings") {
      const input = await readBody(req);
      return json(res, 200, await saveSettings(input));
    }

    if (req.method === "GET" && url.pathname === "/api/config") {
      return json(res, 200, {
        provider,
        model,
        baseUrl: provider === "openrouter" ? "https://openrouter.ai/api/v1" : (process.env.AI_BASE_URL || (provider === "ollama" ? "http://127.0.0.1:11434/v1" : "https://api.openai.com/v1")),
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
      let selectedModel = input.model || model;
      if (provider === "openrouter" && selectedModel.startsWith("openrouter/")) {
        selectedModel = selectedModel.slice("openrouter/".length);
      } else if (provider === "openai-compatible" && selectedModel.startsWith("openai/")) {
        selectedModel = selectedModel.slice("openai/".length);
      }
      return json(res, 200, await chat(messages, selectedModel));
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
  server.listen(port, "127.0.0.1", () => {
    const actualPort = server.address().port;
    console.log(`Personal AI Assistant running at http://localhost:${actualPort}`);
  });
}

listenOn(firstPort);
