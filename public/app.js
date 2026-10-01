const messagesEl = document.querySelector("#messages");
const form = document.querySelector("#composer");
const input = document.querySelector("#input");
const send = document.querySelector("#send");
const modelSelect = document.querySelector("#model");
const modelLabel = document.querySelector("#modelLabel");
const statusText = document.querySelector("#statusText");
const dot = document.querySelector("#dot");
const settingsDialog = document.querySelector("#settingsDialog");
const settingsForm = document.querySelector("#settingsForm");
const providerInput = document.querySelector("#providerInput");
const apiKeyInput = document.querySelector("#apiKeyInput");
const baseUrlInput = document.querySelector("#baseUrlInput");
const baseUrlLabel = document.querySelector("#baseUrlLabel");
const settingsModel = document.querySelector("#settingsModel");
const modelOptions = document.querySelector("#modelOptions");
const modelDiscoveryStatus = document.querySelector("#modelDiscoveryStatus");
const settingsError = document.querySelector("#settingsError");
const clearKeyInput = document.querySelector("#clearKeyInput");

let messages = [];
let currentConfig = { provider: "openrouter", model: "google/gemini-2.5-flash", baseUrl: "" };
let discoveredModels = [];
let openCodeDefaultModel = null;

try {
  messages = JSON.parse(localStorage.getItem("personal-ai-messages") || "[]");
} catch {
  messages = [];
}

function saveMessages() {
  localStorage.setItem("personal-ai-messages", JSON.stringify(messages));
}

function renderMessages() {
  messagesEl.innerHTML = "";
  if (!messages.length) {
    messagesEl.innerHTML = '<div class="empty">Start a conversation.</div>';
    return;
  }
  for (const message of messages) {
    const row = document.createElement("div");
    row.className = `message ${message.role}`;
    const role = document.createElement("div");
    role.className = "role";
    role.textContent = message.role === "user" ? "You" : "AI";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = message.content;
    row.append(role, bubble);
    messagesEl.append(row);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addMessage(role, content) {
  messages.push({ role, content });
  saveMessages();
  renderMessages();
}

function providerPrefix(provider) {
  if (provider === "openai-compatible") return "openai/";
  return `${provider}/`;
}

function modelsForProvider(provider) {
  const prefix = providerPrefix(provider);
  const matching = discoveredModels.filter((id) => id.startsWith(prefix));
  return matching.length ? matching : discoveredModels;
}

function populateChatModels(preferredModel = currentConfig.model) {
  const choices = modelsForProvider(currentConfig.provider);
  const selected = preferredModel || openCodeDefaultModel || currentConfig.model;
  const values = [...choices];
  if (selected && !values.includes(selected)) values.unshift(selected);
  modelSelect.innerHTML = "";
  if (!values.length && selected) values.push(selected);
  for (const id of values) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id === openCodeDefaultModel ? `${id} · OpenCode default` : id;
    modelSelect.append(option);
  }
  if (selected) modelSelect.value = selected;
  modelLabel.textContent = `${currentConfig.provider} · ${modelSelect.value || currentConfig.model}`;
}

function populateSettingsModels(preferredModel = settingsModel.value) {
  const choices = modelsForProvider(providerInput.value);
  const selected = preferredModel || openCodeDefaultModel || currentConfig.model;
  modelOptions.innerHTML = "";
  for (const id of choices) {
    const option = document.createElement("option");
    option.value = id;
    modelOptions.append(option);
  }
  settingsModel.value = selected || "";
}

function updateProviderFields() {
  const customProvider = providerInput.value !== "openrouter";
  baseUrlInput.classList.toggle("base-url-hidden", !customProvider);
  baseUrlLabel.classList.toggle("base-url-hidden", !customProvider);
  baseUrlInput.placeholder = providerInput.value === "ollama"
    ? "http://127.0.0.1:11434/v1"
    : "https://api.openai.com/v1";
  const needsKey = providerInput.value !== "ollama";
  apiKeyInput.disabled = !needsKey;
  apiKeyInput.placeholder = needsKey ? "Paste your provider key" : "Ollama does not require a key";
  clearKeyInput.disabled = !needsKey;
  populateSettingsModels();
}

async function loadModels(refresh = false) {
  modelDiscoveryStatus.textContent = "Looking for OpenCode CLI models…";
  try {
    const response = await fetch(`/api/models${refresh ? "?refresh=1" : ""}`);
    const result = await response.json();
    discoveredModels = Array.isArray(result.models) ? result.models : [];
    openCodeDefaultModel = result.defaultModel || null;
    if (result.available) {
      modelDiscoveryStatus.textContent = `${discoveredModels.length} models found${openCodeDefaultModel ? ` · default: ${openCodeDefaultModel}` : ""}`;
    } else {
      modelDiscoveryStatus.textContent = result.error || "OpenCode CLI models unavailable; enter a model ID manually.";
    }
    populateChatModels(openCodeDefaultModel || currentConfig.model);
    populateSettingsModels(openCodeDefaultModel || currentConfig.model);
  } catch {
    modelDiscoveryStatus.textContent = "Could not contact the local model list; enter a model ID manually.";
  }
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    currentConfig = await response.json();
    statusText.textContent = currentConfig.configured ? "Model ready" : "Add an API key in Settings";
    dot.style.background = currentConfig.configured ? "#7cffaa" : "#ffbd66";
    providerInput.value = currentConfig.provider;
    baseUrlInput.value = currentConfig.baseUrl || "";
    populateChatModels(currentConfig.model);
    populateSettingsModels(currentConfig.model);
    modelLabel.textContent = `${currentConfig.provider} · ${currentConfig.model}`;
  } catch {
    statusText.textContent = "Server unavailable";
    dot.style.background = "#ff7070";
  }
}

async function openSettings() {
  settingsError.textContent = "";
  apiKeyInput.value = "";
  clearKeyInput.checked = false;
  providerInput.value = currentConfig.provider;
  baseUrlInput.value = currentConfig.baseUrl || "";
  settingsModel.value = modelSelect.value || currentConfig.model;
  updateProviderFields();
  if (!discoveredModels.length) await loadModels();
  settingsDialog.showModal();
}

document.querySelector("#openSettings").addEventListener("click", openSettings);
document.querySelector("#openSettingsTop").addEventListener("click", openSettings);
document.querySelector("#closeSettings").addEventListener("click", () => settingsDialog.close());
document.querySelector("#cancelSettings").addEventListener("click", () => settingsDialog.close());
document.querySelector("#refreshModels").addEventListener("click", () => loadModels(true));
providerInput.addEventListener("change", updateProviderFields);
modelSelect.addEventListener("change", () => {
  modelLabel.textContent = `${currentConfig.provider} · ${modelSelect.value}`;
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  settingsError.textContent = "";
  const submitButton = settingsForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: providerInput.value,
        apiKey: apiKeyInput.value,
        clearKey: clearKeyInput.checked,
        baseUrl: baseUrlInput.value,
        model: settingsModel.value,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save settings.");
    apiKeyInput.value = "";
    settingsDialog.close();
    await loadConfig();
  } catch (error) {
    settingsError.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || send.disabled) return;
  addMessage("user", text);
  input.value = "";
  input.style.height = "auto";
  send.disabled = true;
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, model: modelSelect.value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");
    addMessage("assistant", data.message || "");
  } catch (error) {
    addMessage("assistant", `Error: ${error.message}`);
  } finally {
    send.disabled = false;
    input.focus();
  }
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
});
document.querySelector("#newChat").addEventListener("click", () => {
  messages = [];
  saveMessages();
  renderMessages();
  input.focus();
});

renderMessages();
loadConfig().then(() => loadModels());
