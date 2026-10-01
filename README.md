# Personal AI Assistant

A small, real-model personal AI assistant with a provider-agnostic backend.

## Providers

- OpenRouter
- OpenAI-compatible APIs
- Ollama (local models)

## Run on Windows

1. Install [Node.js 20 or newer](https://nodejs.org/).
2. Open PowerShell in the project folder.
3. Start the app:
   ```powershell
   npm start
   ```
   Keep this PowerShell window open while using the app.
4. Open the URL printed by the server in Chrome or Edge. It normally uses **http://localhost:3000**. If that port is busy, the app automatically tries the next ports (up to 20 higher) and prints the URL it selected.
5. Click **Settings**, choose a provider, and enter its API key. The app saves it to the local `.env` file, which is excluded from Git.

The app has no npm package dependencies, so `npm install` is not needed. For automatic server restarts while editing, use `npm run dev` instead.

API keys stay on the local server and are never returned to the browser. To fill the model picker automatically, install and configure the [OpenCode CLI](https://opencode.ai/docs/cli/) so `opencode models` works from PowerShell. The picker reads the model list and the configured default from OpenCode. Without the CLI, enter a model ID manually in Settings.

## Other platforms

Install Node.js 20+ and run `npm start`. Add your provider key in Settings, then open the URL printed by the server. If the selected port is busy, the app automatically tries the following ports.

## Next steps

Streaming responses, tools/actions, web search, long-term memory, authentication, and a richer model picker can be added on top of this provider layer.
