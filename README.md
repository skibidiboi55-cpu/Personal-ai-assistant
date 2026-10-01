# Personal AI Assistant

A small, real-model personal AI assistant with a provider-agnostic backend.

## Providers

- OpenCode CLI sign-in (no separate API key)
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
5. Choose **OpenCode CLI** in Settings to use the account and models already configured in OpenCode. If you have not signed in yet, run `opencode auth login` once in PowerShell and then click **Refresh** in Settings. No API key is entered into this app.
6. To use another provider instead, choose it in Settings and enter its API key. The app saves that key to the local `.env` file, which is excluded from Git.

The app has no npm package dependencies, so `npm install` is not needed. For automatic server restarts while editing, use `npm run dev` instead.

OpenCode sign-in stays in OpenCode's local credential store. This app runs the CLI on the local server and never sends its saved credentials to the browser. Chat requests use a restricted OpenCode agent with tools disabled. For other providers, API keys stay on the local server and are never returned to the browser. To fill the model picker automatically, install and configure the [OpenCode CLI](https://opencode.ai/v2/docs/cli) so `opencode models` works from PowerShell. The picker reads the model list and configured default from OpenCode.

## Other platforms

Install Node.js 20+ and run `npm start`. Select OpenCode CLI to reuse its local sign-in, or add a provider key in Settings. Open the URL printed by the server. If the selected port is busy, the app automatically tries the following ports.

## Next steps

Streaming responses, tools/actions, web search, long-term memory, authentication, and a richer model picker can be added on top of this provider layer.
