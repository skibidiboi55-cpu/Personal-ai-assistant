const messagesEl = document.querySelector("#messages");
const form = document.querySelector("#composer");
const input = document.querySelector("#input");
const send = document.querySelector("#send");
const modelSelect = document.querySelector("#model");
const modelLabel = document.querySelector("#modelLabel");
const statusText = document.querySelector("#statusText");
const dot = document.querySelector("#dot");
const conversationTitle = document.querySelector("#conversationTitle");
const conversationList = document.querySelector("#conversationList");
const conversationSearch = document.querySelector("#conversationSearch");
const settingsDialog = document.querySelector("#settingsDialog");
const settingsForm = document.querySelector("#settingsForm");
const providerInput = document.querySelector("#providerInput");
const apiKeyLabel = document.querySelector("#apiKeyLabel");
const apiKeyInput = document.querySelector("#apiKeyInput");
const apiKeyNote = document.querySelector("#apiKeyNote");
const baseUrlInput = document.querySelector("#baseUrlInput");
const baseUrlLabel = document.querySelector("#baseUrlLabel");
const settingsModel = document.querySelector("#settingsModel");
const settingsModelSearch = document.querySelector("#settingsModelSearch");
const modelDiscoveryStatus = document.querySelector("#modelDiscoveryStatus");
const settingsError = document.querySelector("#settingsError");
const clearKeyInput = document.querySelector("#clearKeyInput");
const clearKeyLabel = document.querySelector(".clear-key");
const modelProviderNote = document.querySelector("#modelProviderNote");
const personalInstructions = document.querySelector("#personalInstructions");
const fileInput = document.querySelector("#fileInput");
const attachmentList = document.querySelector("#attachmentList");
const composerStatus = document.querySelector("#composerStatus");
const researchToggle = document.querySelector("#researchToggle");
const researchAvailability = document.querySelector("#researchAvailability");
const voiceButton = document.querySelector("#voiceButton");
const sidebar = document.querySelector("#sidebar");
const sidebarScrim = document.querySelector("#sidebarScrim");

const conversationsStorageKey = "personal-ai-conversations-v1";
const activeConversationStorageKey = "personal-ai-active-conversation";
const legacyMessagesStorageKey = "personal-ai-messages";
const instructionsStorageKey = "personal-ai-instructions";
const acceptedExtensions = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "log", "xml", "yaml", "yml",
  "js", "jsx", "ts", "tsx", "py", "html", "htm", "css", "scss", "sql", "sh", "ps1",
  "go", "rs", "java", "c", "h", "cpp", "toml", "ini", "conf",
]);
const imageMimeByExtension = new Map([
  ["png", "image/png"], ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"],
  ["gif", "image/gif"], ["webp", "image/webp"],
]);
const acceptedImageTypes = new Set(imageMimeByExtension.values());
const pdfMimeType = "application/pdf";
const maxFileBytes = 160 * 1024;
const maxAttachmentBytes = 420 * 1024;
const maxImageBytes = 600 * 1024;
const maxImageAttachmentBytes = 900 * 1024;
const maxBinaryAttachmentsPerPrompt = 5;
const maxImagePromptChars = 1_200_000;
const maxPromptChars = 600_000;

let currentConfig = { provider: "opencode", model: "openrouter/auto", baseUrl: "" };
let discoveredModels = [];
let openCodeDefaultModel = null;
let pendingAttachments = [];
let isSending = false;
let activeAbortController = null;
let recognition = null;
let activeSpeechButton = null;

function createId() {
  return window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cleanMessages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((message) => message && ["user", "assistant"].includes(message.role) && typeof message.content === "string")
    .slice(-300)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 300_000),
      error: message.error === true,
      attachments: Array.isArray(message.attachments)
        ? message.attachments
            .filter((file) => file && typeof file.name === "string" && (
              typeof file.content === "string" || (file.kind === "image" && acceptedImageTypes.has(file.mimeType) && typeof file.dataBase64 === "string")
              || (file.kind === "pdf" && file.mimeType === pdfMimeType && typeof file.dataBase64 === "string")
            ))
            .slice(0, 5)
            .map((file) => file.kind === "image" || file.kind === "pdf"
              ? {
                  name: file.name.slice(0, 180),
                  kind: file.kind,
                  mimeType: file.mimeType,
                  dataBase64: file.dataBase64.slice(0, Math.ceil(maxImageBytes / 3) * 4 + 8),
                  size: Math.min(maxImageBytes, Number(file.size) || 0),
                }
              : { name: file.name.slice(0, 180), content: file.content.slice(0, maxFileBytes) })
        : [],
    }));
}

function makeConversation(messages = [], id = createId()) {
  const now = Date.now();
  return {
    id,
    title: titleFromMessages(messages) || "New chat",
    titleManuallySet: false,
    createdAt: now,
    updatedAt: now,
    model: "",
    messages: cleanMessages(messages),
  };
}

function titleFromMessages(messages) {
  const firstUser = messages.find((message) => message.role === "user")?.content?.trim();
  if (!firstUser) return "";
  const oneLine = firstUser.replace(/\s+/g, " ");
  return oneLine.length > 48 ? `${oneLine.slice(0, 46).trimEnd()}…` : oneLine;
}

function loadConversations() {
  try {
    const saved = JSON.parse(localStorage.getItem(conversationsStorageKey) || "null");
    if (Array.isArray(saved)) {
      return saved
        .filter((item) => item && typeof item.id === "string")
        .map((item) => ({
          id: item.id.slice(0, 100),
          title: typeof item.title === "string" ? item.title.slice(0, 180) : "New chat",
          titleManuallySet: item.titleManuallySet === true,
          createdAt: Number(item.createdAt) || Date.now(),
          updatedAt: Number(item.updatedAt) || Number(item.createdAt) || Date.now(),
          model: typeof item.model === "string" ? item.model.slice(0, 180) : "",
          messages: cleanMessages(item.messages),
        }));
    }
    const legacyMessages = JSON.parse(localStorage.getItem(legacyMessagesStorageKey) || "[]");
    if (Array.isArray(legacyMessages) && legacyMessages.length) {
      const legacyId = localStorage.getItem("personal-ai-conversation-id");
      return [makeConversation(legacyMessages, typeof legacyId === "string" ? legacyId : createId())];
    }
  } catch {
    // A corrupted browser save should not prevent starting a fresh chat.
  }
  return [makeConversation()];
}

let conversations = loadConversations();
let activeConversationId = localStorage.getItem(activeConversationStorageKey);
if (!conversations.some((conversation) => conversation.id === activeConversationId)) {
  activeConversationId = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id;
}
if (!activeConversationId) {
  const conversation = makeConversation();
  conversations.push(conversation);
  activeConversationId = conversation.id;
}
let messages = activeConversation()?.messages || [];

function activeConversation() {
  return conversations.find((conversation) => conversation.id === activeConversationId) || null;
}

function saveState() {
  const conversation = activeConversation();
  if (conversation) {
    conversation.messages = messages;
    conversation.updatedAt = Date.now();
    if (!conversation.titleManuallySet) conversation.title = titleFromMessages(messages) || conversation.title || "New chat";
    if (modelSelect.value) conversation.model = modelSelect.value;
  }
  try {
    localStorage.setItem(conversationsStorageKey, JSON.stringify(conversations));
    localStorage.setItem(activeConversationStorageKey, activeConversationId || "");
  } catch {
    setComposerStatus("Browser storage is full. Export your chats or remove large attachments.", 8000);
  }
}

function setComposerStatus(message, resetAfter = 0) {
  composerStatus.textContent = message;
  if (resetAfter) {
    window.clearTimeout(setComposerStatus.timer);
    setComposerStatus.timer = window.setTimeout(() => {
      composerStatus.textContent = "Enter to send · Shift+Enter for a new line";
    }, resetAfter);
  }
}

function stopSpeech() {
  const button = activeSpeechButton;
  activeSpeechButton = null;
  if (button) button.textContent = "Listen";
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

function speakMessage(text, button) {
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
    setComposerStatus("Read aloud is not available in this browser.", 5000);
    return;
  }
  if (activeSpeechButton === button) {
    stopSpeech();
    return;
  }
  stopSpeech();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = navigator.language || "en-US";
  activeSpeechButton = button;
  button.textContent = "Stop speaking";
  const reset = () => {
    if (activeSpeechButton !== button) return;
    activeSpeechButton = null;
    button.textContent = "Listen";
  };
  utterance.onend = reset;
  utterance.onerror = reset;
  window.speechSynthesis.speak(utterance);
}

function providerPrefix(provider) {
  if (provider === "opencode") return "";
  if (provider === "openai-compatible") return "openai/";
  return `${provider}/`;
}

function modelsForProvider(provider) {
  if (provider === "opencode") return discoveredModels;
  const prefix = providerPrefix(provider);
  const matching = discoveredModels.filter((id) => id.startsWith(prefix));
  return matching.length ? matching : discoveredModels;
}

function populateChatModels(preferredModel = currentConfig.model) {
  const choices = modelsForProvider(currentConfig.provider);
  const selected = preferredModel || activeConversation()?.model || openCodeDefaultModel || currentConfig.model;
  const values = [...choices];
  if (selected && !values.includes(selected)) values.unshift(selected);
  modelSelect.replaceChildren();
  if (!values.length) values.push(selected || "");
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
  const query = settingsModelSearch.value.trim().toLocaleLowerCase();
  const choices = modelsForProvider(providerInput.value).filter((id) => !query || id.toLocaleLowerCase().includes(query));
  const selected = preferredModel || openCodeDefaultModel || currentConfig.model;
  const values = [...choices];
  if (!query && selected && !values.includes(selected)) values.unshift(selected);
  settingsModel.replaceChildren();
  if (!values.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = query ? "No matching models" : "No models found";
    option.disabled = true;
    option.selected = true;
    settingsModel.append(option);
    return;
  }
  for (const id of values) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id === openCodeDefaultModel ? `${id} · OpenCode default` : id;
    settingsModel.append(option);
  }
  settingsModel.value = selected || "";
}

function updateProviderFields() {
  const isOpenCode = providerInput.value === "opencode";
  const customProvider = providerInput.value !== "openrouter" && !isOpenCode;
  baseUrlInput.classList.toggle("base-url-hidden", !customProvider);
  baseUrlLabel.classList.toggle("base-url-hidden", !customProvider);
  baseUrlInput.placeholder = providerInput.value === "ollama"
    ? "http://127.0.0.1:11434/v1"
    : "https://api.openai.com/v1";
  const needsKey = providerInput.value !== "ollama" && !isOpenCode;
  apiKeyLabel.classList.toggle("base-url-hidden", !needsKey);
  apiKeyInput.disabled = !needsKey;
  apiKeyInput.classList.toggle("base-url-hidden", !needsKey);
  apiKeyInput.placeholder = needsKey ? "Paste your provider key" : isOpenCode ? "Uses your OpenCode CLI sign-in" : "Ollama does not require a key";
  apiKeyNote.textContent = isOpenCode
    ? "Uses the provider already signed in to your OpenCode CLI. No separate API key is needed."
    : "Saved in the local server’s .env file. It is never sent back to the browser.";
  apiKeyNote.classList.toggle("base-url-hidden", !needsKey && !isOpenCode);
  clearKeyInput.disabled = !needsKey;
  clearKeyLabel.classList.toggle("base-url-hidden", !needsKey);
  modelProviderNote.textContent = isOpenCode
    ? "Models and the default come from your OpenCode CLI sign-in."
    : "Choose a model available from the selected provider. API keys stay on this server.";
  populateSettingsModels();
}

settingsModelSearch.addEventListener("input", () => {
  populateSettingsModels(settingsModel.value || activeConversation()?.model || currentConfig.model);
});

async function loadModels(refresh = false) {
  modelDiscoveryStatus.textContent = "Looking for OpenCode CLI models…";
  try {
    const response = await fetch(`/api/models${refresh ? "?refresh=1" : ""}`);
    const result = await response.json();
    discoveredModels = Array.isArray(result.models) ? result.models : [];
    openCodeDefaultModel = result.defaultModel || null;
    if (result.available) {
      const loginStatus = result.authenticated ? " · CLI signed in" : " · run opencode auth login to sign in";
      modelDiscoveryStatus.textContent = `${discoveredModels.length} OpenCode models found${openCodeDefaultModel ? ` · default: ${openCodeDefaultModel}` : ""}${loginStatus}`;
    } else {
      modelDiscoveryStatus.textContent = result.error || "OpenCode CLI models unavailable. Check Settings or run Refresh.";
    }
    populateChatModels(activeConversation()?.model || currentConfig.model);
    populateSettingsModels(settingsModel.value || currentConfig.model);
    renderHistory();
  } catch {
    modelDiscoveryStatus.textContent = "Could not contact the local model list. Make sure the app server is running, then refresh.";
  }
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    currentConfig = await response.json();
    updateResearchAvailability();
    statusText.textContent = currentConfig.configured
      ? "Model ready"
      : currentConfig.provider === "opencode" ? "Sign in with OpenCode CLI" : "Add an API key in Settings";
    dot.style.background = currentConfig.configured ? "#7cffaa" : "#ffbd66";
    providerInput.value = currentConfig.provider;
    baseUrlInput.value = currentConfig.baseUrl || "";
    populateChatModels(activeConversation()?.model || currentConfig.model);
    populateSettingsModels(activeConversation()?.model || currentConfig.model);
    modelLabel.textContent = `${currentConfig.provider} · ${modelSelect.value || currentConfig.model}`;
  } catch {
    statusText.textContent = "Server unavailable";
    dot.style.background = "#ff7070";
  }
}

function updateResearchAvailability() {
  const available = currentConfig.provider === "opencode";
  researchToggle.disabled = !available;
  if (!available) researchToggle.checked = false;
  researchAvailability.textContent = available
    ? "OpenCode search setup may be required; searches can incur fees."
    : "Available with the OpenCode CLI provider only.";
}

function renderInline(container, text) {
  const tokenPattern = /(\[[^\]]+\]\(https?:\/\/[^\s)]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*)/g;
  for (const token of text.split(tokenPattern)) {
    if (!token) continue;
    const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (linkMatch) {
      try {
        const url = new URL(linkMatch[2]);
        if (url.protocol === "https:" || url.protocol === "http:") {
          const link = document.createElement("a");
          link.href = url.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = linkMatch[1];
          container.append(link);
          continue;
        }
      } catch {}
    }
    if (token.startsWith("`") && token.endsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      container.append(code);
    } else if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      container.append(strong);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      const emphasis = document.createElement("em");
      emphasis.textContent = token.slice(1, -1);
      container.append(emphasis);
    } else {
      container.append(document.createTextNode(token));
    }
  }
}

function isBlockStart(line) {
  return /^\s*```/.test(line) || /^#{1,4}\s/.test(line) || /^\s*>/.test(line) || /^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line);
}

function renderMarkdown(text) {
  const fragment = document.createDocumentFragment();
  const lines = String(text).replace(/\r/g, "").split("\n");
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    const fence = line.match(/^\s*```\s*([\w.+-]*)/);
    if (fence) {
      index++;
      const codeLines = [];
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) codeLines.push(lines[index++]);
      if (index < lines.length) index++;
      const block = document.createElement("div");
      block.className = "code-block";
      const language = document.createElement("span");
      language.className = "code-lang";
      language.textContent = fence[1] || "code";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "code-copy";
      copy.textContent = "Copy code";
      copy.dataset.copyCode = "true";
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = codeLines.join("\n");
      pre.append(code);
      block.append(language, copy, pre);
      fragment.append(block);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const element = document.createElement(`h${heading[1].length}`);
      renderInline(element, heading[2]);
      fragment.append(element);
      index++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote = document.createElement("blockquote");
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        const paragraph = document.createElement("p");
        renderInline(paragraph, lines[index++].replace(/^\s*>\s?/, ""));
        quote.append(paragraph);
      }
      fragment.append(quote);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const list = document.createElement("ul");
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        const item = document.createElement("li");
        renderInline(item, lines[index++].replace(/^\s*[-*+]\s+/, ""));
        list.append(item);
      }
      fragment.append(list);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const list = document.createElement("ol");
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        const item = document.createElement("li");
        renderInline(item, lines[index++].replace(/^\s*\d+[.)]\s+/, ""));
        list.append(item);
      }
      fragment.append(list);
      continue;
    }
    const paragraphLines = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) paragraphLines.push(lines[index++]);
    if (!paragraphLines.length) { index++; continue; }
    const paragraph = document.createElement("p");
    paragraphLines.forEach((paragraphLine, lineIndex) => {
      if (lineIndex) paragraph.append(document.createElement("br"));
      renderInline(paragraph, paragraphLine);
    });
    fragment.append(paragraph);
  }
  return fragment;
}

function createWelcome() {
  const welcome = document.createElement("div");
  welcome.className = "welcome";
  const mark = document.createElement("div");
  mark.className = "welcome-mark";
  mark.textContent = "✳";
  const heading = document.createElement("h2");
  heading.textContent = "What can I help with?";
  const note = document.createElement("p");
  note.textContent = "Ask a question, bring a file, or start with an idea.";
  const suggestions = [
    ["Make a plan", "Break a goal into clear next steps."],
    ["Explain something", "Get a clear explanation at your level."],
    ["Work with a file", "Attach notes, code, an image, or a PDF."],
    ["Write or revise", "Draft a message, outline, or first version."],
  ];
  const grid = document.createElement("div");
  grid.className = "starter-grid";
  for (const [title, description] of suggestions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "starter";
    button.dataset.starter = title;
    const strong = document.createElement("strong");
    strong.textContent = title;
    const detail = document.createElement("span");
    detail.textContent = description;
    button.append(strong, detail);
    grid.append(button);
  }
  welcome.append(mark, heading, note, grid);
  return welcome;
}

function renderMessages() {
  messagesEl.replaceChildren();
  if (!messages.length) {
    messagesEl.append(createWelcome());
    return;
  }
  for (const message of messages) {
    const row = document.createElement("article");
    row.className = `message ${message.role}${message.error ? " error" : ""}`;
    const role = document.createElement("div");
    role.className = "role";
    role.textContent = message.role === "user" ? "You" : "AI";
    role.setAttribute("aria-hidden", "true");
    const body = document.createElement("div");
    body.className = "message-body";
    const bubble = document.createElement("div");
    bubble.className = message.role === "assistant" ? "bubble markdown" : "bubble";
    if (message.role === "assistant") bubble.append(renderMarkdown(message.content));
    else bubble.textContent = message.content;
    body.append(bubble);
    if (message.attachments?.length) {
      for (const file of message.attachments.filter((item) => item.kind === "image" && item.dataBase64)) {
        const preview = document.createElement("img");
        preview.className = "message-image";
        preview.src = `data:${file.mimeType};base64,${file.dataBase64}`;
        preview.alt = `Attached image: ${file.name}`;
        preview.loading = "lazy";
        body.append(preview);
      }
      const chips = document.createElement("div");
      chips.className = "file-chips";
      for (const file of message.attachments) {
        const chip = document.createElement("span");
        chip.className = "file-chip";
        chip.textContent = `${file.kind === "image" ? "▧" : file.kind === "pdf" ? "PDF" : "▤"} ${file.name}`;
        chips.append(chip);
      }
      body.append(chips);
    }
    if (message.role === "assistant" && !message.error && message.content) {
      const actions = document.createElement("div");
      actions.className = "message-actions";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = "Copy answer";
      copy.dataset.copyMessage = "true";
      copy.dataset.messageIndex = String(messages.indexOf(message));
      const listen = document.createElement("button");
      listen.type = "button";
      listen.textContent = "Listen";
      listen.dataset.speakMessage = "true";
      listen.dataset.messageIndex = String(messages.indexOf(message));
      actions.append(copy, listen);
      body.append(actions);
    }
    row.append(role, body);
    messagesEl.append(row);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderHistory() {
  const query = conversationSearch.value.trim().toLocaleLowerCase();
  const visible = [...conversations]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((conversation) => !query || `${conversation.title} ${conversation.messages.map((message) => `${message.content} ${(message.attachments || []).map((file) => file.name).join(" ")}`).join(" ")}`.toLocaleLowerCase().includes(query));
  conversationList.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = query ? "No conversations match your search." : "Your conversations will appear here.";
    conversationList.append(empty);
    return;
  }
  for (const conversation of visible) {
    const item = document.createElement("div");
    item.className = `conversation-item${conversation.id === activeConversationId ? " active" : ""}`;
    const open = document.createElement("button");
    open.type = "button";
    open.className = "conversation-main";
    open.dataset.openConversation = conversation.id;
    const title = document.createElement("span");
    title.className = "conversation-title";
    title.textContent = conversation.title || "New chat";
    const lastUser = [...conversation.messages].reverse().find((message) => message.role === "user");
    const preview = document.createElement("span");
    preview.className = "conversation-preview";
    preview.textContent = lastUser?.content.replace(/\s+/g, " ").slice(0, 64) || "No messages yet";
    open.append(title, preview);
    const actions = document.createElement("div");
    actions.className = "conversation-actions";
    const rename = document.createElement("button");
    rename.type = "button";
    rename.textContent = "✎";
    rename.title = "Rename conversation";
    rename.setAttribute("aria-label", `Rename ${conversation.title}`);
    rename.dataset.renameConversation = conversation.id;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "Delete conversation";
    remove.setAttribute("aria-label", `Delete ${conversation.title}`);
    remove.dataset.deleteConversation = conversation.id;
    actions.append(rename, remove);
    item.append(open, actions);
    conversationList.append(item);
  }
}

function setActiveConversation(id) {
  const conversation = conversations.find((item) => item.id === id);
  if (!conversation) return;
  activeConversationId = id;
  messages = conversation.messages;
  if (conversation.model) populateChatModels(conversation.model);
  else populateChatModels(currentConfig.model);
  conversationTitle.textContent = conversation.title === "New chat" && !messages.length ? "What can I help with?" : conversation.title;
  renderHistory();
  renderMessages();
  closeMobileSidebar();
  localStorage.setItem(activeConversationStorageKey, activeConversationId);
}

function createConversation() {
  const conversation = makeConversation();
  conversation.model = modelSelect.value || currentConfig.model;
  conversations.push(conversation);
  setActiveConversation(conversation.id);
  saveState();
  renderHistory();
  input.focus();
}

function addMessageToConversation(conversationId, role, content, extras = {}) {
  const conversation = conversations.find((item) => item.id === conversationId);
  if (!conversation) return;
  conversation.messages.push({ role, content, error: extras.error === true, attachments: extras.attachments || [] });
  conversation.updatedAt = Date.now();
  if (!conversation.titleManuallySet) conversation.title = titleFromMessages(conversation.messages) || conversation.title || "New chat";
  if (activeConversationId === conversationId) {
    messages = conversation.messages;
    conversationTitle.textContent = conversation.title || "What can I help with?";
    renderMessages();
  }
  try {
    localStorage.setItem(conversationsStorageKey, JSON.stringify(conversations));
    localStorage.setItem(activeConversationStorageKey, activeConversationId || "");
  } catch {
    setComposerStatus("Browser storage is full. Export your chats or remove large attachments.", 8000);
  }
  renderHistory();
  return conversation.messages.at(-1);
}

function addMessage(role, content, extras = {}) {
  addMessageToConversation(activeConversationId, role, content, extras);
}

function updateStreamingMessage(conversationId, message) {
  const conversation = conversations.find((item) => item.id === conversationId);
  if (conversation) conversation.updatedAt = Date.now();
  if (activeConversationId === conversationId) {
    const messageIndex = conversation?.messages.indexOf(message) ?? -1;
    const row = messageIndex >= 0 ? messagesEl.children[messageIndex] : null;
    const bubble = row?.querySelector(".bubble");
    if (bubble) bubble.textContent = message.content;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  window.clearTimeout(updateStreamingMessage.timer);
  updateStreamingMessage.timer = window.setTimeout(() => {
    try { localStorage.setItem(conversationsStorageKey, JSON.stringify(conversations)); }
    catch { setComposerStatus("Browser storage is full. Export your chats or remove large attachments.", 8000); }
  }, 700);
}

async function readEventStream(response, onToken) {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = await response.json();
    if (data.message) onToken(data.message);
    if (data.error) throw new Error(data.error);
    return data;
  }
  if (!response.body) throw new Error("This browser could not read the streamed response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = {};
  function dispatch(block) {
    let eventName = "message";
    const dataLines = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return;
    let data;
    try { data = JSON.parse(dataLines.join("\n")); }
    catch { return; }
    if (eventName === "token" && typeof data.text === "string") onToken(data.text);
    else if (eventName === "done") result = data;
    else if (eventName === "error") throw new Error(data.error || "The model request failed.");
  }
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let boundary;
    while ((boundary = buffer.match(/\r?\n\r?\n/))) {
      const index = boundary.index;
      dispatch(buffer.slice(0, index));
      buffer = buffer.slice(index + boundary[0].length);
    }
    if (done) break;
  }
  if (buffer.trim()) dispatch(buffer);
  return result;
}

function attachmentPrompt(file) {
  if (file.kind === "image") return `\n\n[Attached image: ${file.name}]`;
  if (file.kind === "pdf") return `\n\n[Attached PDF: ${file.name}]`;
  return `\n\n[Attached file: ${file.name}]\n${file.content}`;
}

function apiMessages(sourceMessages = messages) {
  const instructions = (localStorage.getItem(instructionsStorageKey) || "").trim();
  const selectedMessages = sourceMessages.slice(-40).map((message, messageIndex) => ({
    role: message.role,
    content: `${message.content}${(message.attachments || []).map(attachmentPrompt).join("")}`,
    binaries: message.role === "user"
      ? (message.attachments || []).filter((file) => (
          (file.kind === "image" && acceptedImageTypes.has(file.mimeType)) || (file.kind === "pdf" && file.mimeType === pdfMimeType)
        ) && typeof file.dataBase64 === "string")
          .map((file, index) => ({ key: `${messageIndex}:${index}`, name: file.name, kind: file.kind, mimeType: file.mimeType, dataBase64: file.dataBase64 }))
      : [],
  }));
  let binaryChars = 0;
  let binaryCount = 0;
  const includedBinaries = new Set();
  for (let messageIndex = selectedMessages.length - 1; messageIndex >= 0; messageIndex--) {
    const item = selectedMessages[messageIndex];
    for (let binaryIndex = item.binaries.length - 1; binaryIndex >= 0; binaryIndex--) {
      const binary = item.binaries[binaryIndex];
      if (binaryCount >= maxBinaryAttachmentsPerPrompt || binaryChars + binary.dataBase64.length > maxImagePromptChars) continue;
      binaryChars += binary.dataBase64.length;
      binaryCount++;
      includedBinaries.add(binary.key);
    }
  }
  for (const item of selectedMessages) {
    const omitted = item.binaries.filter((binary) => !includedBinaries.has(binary.key));
    item.images = item.binaries.filter((binary) => includedBinaries.has(binary.key) && binary.kind === "image");
    item.pdfs = item.binaries.filter((binary) => includedBinaries.has(binary.key) && binary.kind === "pdf");
    delete item.binaries;
    if (omitted.length) item.content += `\n\n[${omitted.length} older image or PDF attachment(s) were left out to keep this request within size limits.]`;
  }
  let charBudget = maxPromptChars;
  const recent = [];
  for (let index = selectedMessages.length - 1; index >= 0; index--) {
    const item = selectedMessages[index];
    if (item.content.length > charBudget) {
      if (!recent.length) item.content = item.content.slice(-charBudget);
      else break;
    }
    charBudget -= item.content.length;
    recent.unshift(item);
  }
  if (instructions) recent.unshift({ role: "system", content: `Personal instructions from the user:\n${instructions.slice(0, 4000)}` });
  return recent;
}

function createFileAttachment(file, content) {
  return { id: createId(), name: file.name.replace(/[\r\n]/g, " ").slice(0, 180), content };
}

function createImageAttachment(file, mimeType, dataBase64) {
  return {
    id: createId(),
    name: file.name.replace(/[\r\n]/g, " ").slice(0, 180),
    kind: "image",
    mimeType,
    dataBase64,
    size: file.size,
  };
}

function createPdfAttachment(file, dataBase64) {
  return {
    id: createId(),
    name: file.name.replace(/[\r\n]/g, " ").slice(0, 180),
    kind: "pdf",
    mimeType: pdfMimeType,
    dataBase64,
    size: file.size,
  };
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const comma = dataUrl.indexOf(",");
      if (comma < 0) reject(new Error("Could not encode image."));
      else resolve(dataUrl.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}

function renderPendingAttachments() {
  attachmentList.replaceChildren();
  attachmentList.hidden = pendingAttachments.length === 0;
  for (const file of pendingAttachments) {
    const pill = document.createElement("div");
    pill.className = "attachment-pill";
    const name = document.createElement("span");
    const size = file.kind === "image" ? file.size : new Blob([file.content]).size;
    const icon = file.kind === "image" ? "▧ " : file.kind === "pdf" ? "PDF · " : "";
    name.textContent = `${icon}${file.name} · ${Math.ceil(size / 1024)} KB`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${file.name}`);
    remove.dataset.removeAttachment = file.id;
    pill.append(name, remove);
    attachmentList.append(pill);
  }
}

async function addSelectedFiles(fileList) {
  for (const file of Array.from(fileList || [])) {
    const extension = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "";
    const mimeType = acceptedImageTypes.has(file.type) ? file.type : imageMimeByExtension.get(extension);
    const isImage = Boolean(mimeType);
    const isPdf = extension === "pdf" || file.type === pdfMimeType;
    if (!isImage && !isPdf && !acceptedExtensions.has(extension) && !file.type.startsWith("text/")) {
      setComposerStatus(`${file.name}: choose a text/code file, PDF, PNG, JPEG, GIF, or WebP image.`, 6000);
      continue;
    }
    if (pendingAttachments.length >= 5) {
      setComposerStatus("Attach up to 5 files or images to one message.", 6000);
      continue;
    }
    if (isImage || isPdf) {
      if (isPdf && currentConfig.provider !== "opencode") {
        setComposerStatus("PDF reading currently requires the OpenCode CLI provider.", 6000);
        continue;
      }
      if (file.size > maxImageBytes) {
        setComposerStatus(`${file.name}: images and PDFs must be 600 KB or smaller.`, 6000);
        continue;
      }
      const currentBinaryBytes = pendingAttachments.filter((item) => item.kind === "image" || item.kind === "pdf").reduce((sum, item) => sum + item.size, 0);
      if (currentBinaryBytes + file.size > maxImageAttachmentBytes) {
        setComposerStatus("Images and PDFs attached to one message must total 900 KB or less.", 6000);
        continue;
      }
      try {
        const dataBase64 = await readFileAsBase64(file);
        pendingAttachments.push(isPdf ? createPdfAttachment(file, dataBase64) : createImageAttachment(file, mimeType, dataBase64));
      } catch (error) {
        setComposerStatus(`${file.name}: ${error.message}`, 6000);
      }
      continue;
    }
    if (file.size > maxFileBytes) {
      setComposerStatus(`${file.name}: files must be 160 KB or smaller.`, 6000);
      continue;
    }
    const currentBytes = pendingAttachments.filter((item) => item.kind !== "image" && item.kind !== "pdf").reduce((sum, item) => sum + new Blob([item.content]).size, 0);
    if (currentBytes + file.size > maxAttachmentBytes) {
      setComposerStatus("Text files attached to one message must total 420 KB or less.", 6000);
      continue;
    }
    try {
      const content = await file.text();
      if (content.includes("\u0000")) {
        setComposerStatus(`${file.name}: this file does not appear to be plain text.`, 6000);
        continue;
      }
      pendingAttachments.push(createFileAttachment(file, content));
    } catch {
      setComposerStatus(`Could not read ${file.name}.`, 6000);
    }
  }
  fileInput.value = "";
  renderPendingAttachments();
  if (pendingAttachments.length) setComposerStatus("Attachments are sent to your selected model only when you send this message.", 7000);
}

async function openSettings() {
  settingsError.textContent = "";
  apiKeyInput.value = "";
  clearKeyInput.checked = false;
  providerInput.value = currentConfig.provider;
  baseUrlInput.value = currentConfig.baseUrl || "";
  settingsModel.value = activeConversation()?.model || modelSelect.value || currentConfig.model;
  settingsModelSearch.value = "";
  personalInstructions.value = localStorage.getItem(instructionsStorageKey) || "";
  updateProviderFields();
  if (!discoveredModels.length) await loadModels();
  settingsDialog.showModal();
}

function closeMobileSidebar() {
  sidebar.classList.remove("open");
  sidebarScrim.classList.remove("open");
}

function exportText(filename, content, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFilename(value) {
  return (value || "conversation").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "conversation";
}

function exportConversation(conversation = activeConversation()) {
  if (!conversation) return;
  const content = [
    `# ${conversation.title || "New chat"}`,
    "",
    `Exported ${new Date().toLocaleString()}`,
    "",
    ...conversation.messages.flatMap((message) => [
      `## ${message.role === "user" ? "You" : "Assistant"}`,
      "",
      message.content,
      ...(message.attachments || []).map((file) => file.kind === "image"
        ? [`### Attached image: ${file.name}`, "", `Image data is stored in this browser (${file.mimeType}).`, ""]
        : file.kind === "pdf"
          ? [`### Attached PDF: ${file.name}`, "", "PDF data is stored in this browser and is not included in this Markdown export.", ""]
          : [`### Attached file: ${file.name}`, "", "```text", file.content, "```", ""]).flat(),
      "",
    ]),
  ].join("\n");
  exportText(`${safeFilename(conversation.title)}.md`, content, "text/markdown;charset=utf-8");
}

function renameConversation(id) {
  const conversation = conversations.find((item) => item.id === id);
  if (!conversation) return;
  const title = window.prompt("Rename this conversation", conversation.title);
  if (title === null) return;
  const cleaned = title.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!cleaned) return;
  conversation.title = cleaned;
  conversation.titleManuallySet = true;
  conversation.updatedAt = Date.now();
  saveState();
  conversationTitle.textContent = conversation.title;
  renderHistory();
}

function deleteConversation(id) {
  const conversation = conversations.find((item) => item.id === id);
  if (!conversation || !window.confirm(`Delete “${conversation.title}”? This only removes its copy from this browser.`)) return;
  conversations = conversations.filter((item) => item.id !== id);
  if (!conversations.length) conversations.push(makeConversation());
  const next = conversations.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  setActiveConversation(next.id);
  saveState();
  renderHistory();
}

function toggleVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setComposerStatus("Voice dictation is not available in this browser. Try current Chrome or Edge.", 6000);
    return;
  }
  if (recognition) {
    recognition.stop();
    return;
  }
  recognition = new SpeechRecognition();
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;
  let finalTranscript = "";
  voiceButton.classList.add("listening");
  voiceButton.setAttribute("aria-pressed", "true");
  setComposerStatus("Listening… click the microphone when you’re done.");
  recognition.onresult = (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const transcript = event.results[index][0].transcript;
      if (event.results[index].isFinal) finalTranscript += transcript;
      else interim += transcript;
    }
    const prefix = input.value.trim() ? `${input.value.trimEnd()} ` : "";
    input.value = `${prefix}${finalTranscript}${interim}`;
    input.dispatchEvent(new Event("input"));
  };
  recognition.onerror = (event) => {
    if (event.error !== "aborted" && event.error !== "no-speech") setComposerStatus(`Voice input: ${event.error}.`, 5000);
  };
  recognition.onend = () => {
    recognition = null;
    voiceButton.classList.remove("listening");
    voiceButton.setAttribute("aria-pressed", "false");
    setComposerStatus("Enter to send · Shift+Enter for a new line");
    input.focus();
  };
  try { recognition.start(); }
  catch { recognition = null; voiceButton.classList.remove("listening"); setComposerStatus("Could not start voice input. Check your browser microphone permission.", 6000); }
}

document.querySelector("#newChat").addEventListener("click", createConversation);
document.querySelector("#openSettings").addEventListener("click", openSettings);
document.querySelector("#openSettingsTop").addEventListener("click", openSettings);
document.querySelector("#closeSettings").addEventListener("click", () => settingsDialog.close());
document.querySelector("#cancelSettings").addEventListener("click", () => settingsDialog.close());
document.querySelector("#refreshModels").addEventListener("click", () => loadModels(true));
document.querySelector("#exportCurrent").addEventListener("click", () => exportConversation());
document.querySelector("#exportAll").addEventListener("click", () => exportText("personal-ai-conversations.json", JSON.stringify(conversations, null, 2), "application/json;charset=utf-8"));
document.querySelector("#attachButton").addEventListener("click", () => fileInput.click());
document.querySelector("#voiceButton").addEventListener("click", toggleVoiceInput);
researchToggle.addEventListener("change", () => {
  if (researchToggle.checked) {
    setComposerStatus("Web queries go to your configured search provider and may incur charges.", 7000);
  }
});
document.querySelector("#mobileMenu").addEventListener("click", () => { sidebar.classList.add("open"); sidebarScrim.classList.add("open"); });
document.querySelector("#closeSidebar").addEventListener("click", closeMobileSidebar);
sidebarScrim.addEventListener("click", closeMobileSidebar);
conversationSearch.addEventListener("input", renderHistory);
fileInput.addEventListener("change", () => addSelectedFiles(fileInput.files));
providerInput.addEventListener("change", updateProviderFields);
modelSelect.addEventListener("change", () => {
  modelLabel.textContent = `${currentConfig.provider} · ${modelSelect.value}`;
  saveState();
});

conversationList.addEventListener("click", (event) => {
  const openButton = event.target.closest("[data-open-conversation]");
  if (openButton) { setActiveConversation(openButton.dataset.openConversation); return; }
  const renameButton = event.target.closest("[data-rename-conversation]");
  if (renameButton) { renameConversation(renameButton.dataset.renameConversation); return; }
  const deleteButton = event.target.closest("[data-delete-conversation]");
  if (deleteButton) deleteConversation(deleteButton.dataset.deleteConversation);
});

attachmentList.addEventListener("click", (event) => {
  const remove = event.target.closest("[data-remove-attachment]");
  if (!remove) return;
  pendingAttachments = pendingAttachments.filter((file) => file.id !== remove.dataset.removeAttachment);
  renderPendingAttachments();
});

messagesEl.addEventListener("click", async (event) => {
  const copyCode = event.target.closest("[data-copy-code]");
  const copyMessage = event.target.closest("[data-copy-message]");
  const listenMessage = event.target.closest("[data-speak-message]");
  const starter = event.target.closest("[data-starter]");
  if (starter) {
    input.value = starter.dataset.starter === "Work with a file" ? "Please help me understand this file: " : `${starter.dataset.starter}: `;
    input.focus();
    input.dispatchEvent(new Event("input"));
    return;
  }
  if (listenMessage) {
    const index = Number(listenMessage.dataset.messageIndex);
    speakMessage(messages[index]?.content || "", listenMessage);
    return;
  }
  if (copyCode) {
    const code = copyCode.closest(".code-block")?.querySelector("pre code")?.textContent || "";
    try { await navigator.clipboard.writeText(code); copyCode.textContent = "Copied"; }
    catch { copyCode.textContent = "Copy failed"; }
    window.setTimeout(() => { copyCode.textContent = "Copy code"; }, 1600);
  }
  if (copyMessage) {
    const index = Number(copyMessage.dataset.messageIndex);
    const content = messages[index]?.content || "";
    try { await navigator.clipboard.writeText(content); copyMessage.textContent = "Copied"; }
    catch { copyMessage.textContent = "Copy failed"; }
    window.setTimeout(() => { copyMessage.textContent = "Copy answer"; }, 1600);
  }
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
    localStorage.setItem(instructionsStorageKey, personalInstructions.value.trim());
    const conversation = activeConversation();
    if (conversation) conversation.model = result.model || settingsModel.value;
    settingsDialog.close();
    await loadConfig();
    saveState();
  } catch (error) {
    settingsError.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector("#clearHistory").addEventListener("click", () => {
  if (!window.confirm("Delete every saved conversation from this browser? This cannot be undone.")) return;
  conversations = [makeConversation()];
  activeConversationId = conversations[0].id;
  messages = [];
  saveState();
  conversationTitle.textContent = "What can I help with?";
  renderHistory();
  renderMessages();
  settingsDialog.close();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if ((!text && !pendingAttachments.length) || isSending) return;
  const requestConversationId = activeConversationId;
  stopSpeech();
  const attachments = pendingAttachments.map((file) => ({ ...file }));
  const research = researchToggle.checked;
  researchToggle.checked = false;
  const prompt = text || `Please review the attached ${attachments.length === 1 ? "file" : "files"}.`;
  pendingAttachments = [];
  renderPendingAttachments();
  addMessageToConversation(requestConversationId, "user", prompt, { attachments });
  input.value = "";
  input.style.height = "auto";
  const requestContext = apiMessages(conversations.find((item) => item.id === requestConversationId)?.messages || []);
  const requestModel = conversations.find((item) => item.id === requestConversationId)?.model || modelSelect.value;
  const assistantMessage = addMessageToConversation(requestConversationId, "assistant", "Thinking…");
  isSending = true;
  activeAbortController = new AbortController();
  send.disabled = false;
  send.textContent = "■";
  send.setAttribute("aria-label", "Stop generating");
  send.title = "Stop generating";
  setComposerStatus(research ? "Researching the web · press stop to cancel" : "Generating a reply · press stop to cancel");
  let receivedToken = false;
  try {
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: requestContext, model: requestModel, conversationId: requestConversationId, research }),
      signal: activeAbortController.signal,
    });
    await readEventStream(response, (token) => {
      if (!receivedToken && assistantMessage.content === "Thinking…") assistantMessage.content = "";
      receivedToken = true;
      assistantMessage.content += token;
      updateStreamingMessage(requestConversationId, assistantMessage);
    });
    if (!assistantMessage.content || assistantMessage.content === "Thinking…") {
      throw new Error("The model returned no text. Check the selected model and try again.");
    }
  } catch (error) {
    if (activeAbortController?.signal.aborted || error.name === "AbortError") {
      assistantMessage.content = assistantMessage.content === "Thinking…"
        ? "Response stopped."
        : `${assistantMessage.content}\n\n*Response stopped.*`;
    } else if (assistantMessage.content && assistantMessage.content !== "Thinking…") {
      assistantMessage.content += `\n\nRequest error: ${error.message}`;
    } else {
      assistantMessage.content = `I couldn’t complete that request: ${error.message}`;
      assistantMessage.error = true;
    }
  } finally {
    window.clearTimeout(updateStreamingMessage.timer);
    const conversation = conversations.find((item) => item.id === requestConversationId);
    if (conversation) conversation.updatedAt = Date.now();
    try { localStorage.setItem(conversationsStorageKey, JSON.stringify(conversations)); }
    catch { setComposerStatus("Browser storage is full. Export your chats or remove large attachments.", 8000); }
    renderHistory();
    if (activeConversationId === requestConversationId) renderMessages();
    isSending = false;
    activeAbortController = null;
    send.disabled = false;
    send.textContent = "↑";
    send.setAttribute("aria-label", "Send message");
    send.title = "Send message";
    setComposerStatus("Enter to send · Shift+Enter for a new line");
    if (activeConversationId === requestConversationId) input.focus();
  }
});

send.addEventListener("click", (event) => {
  if (!isSending) return;
  event.preventDefault();
  setComposerStatus("Stopping response…");
  activeAbortController?.abort();
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 190)}px`;
});
conversationSearch.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { conversationSearch.value = ""; renderHistory(); }
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    conversationSearch.focus();
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "o") {
    event.preventDefault();
    createConversation();
  }
});

document.querySelector("#newChat").setAttribute("aria-keyshortcuts", "Control+Shift+O Meta+Shift+O");
conversationTitle.textContent = activeConversation()?.title === "New chat" && !messages.length ? "What can I help with?" : activeConversation()?.title || "What can I help with?";
personalInstructions.value = localStorage.getItem(instructionsStorageKey) || "";
renderHistory();
renderMessages();
updateResearchAvailability();
loadConfig().then(() => loadModels());
