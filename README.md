# Personal AI Assistant

A small, real-model personal AI assistant with a provider-agnostic backend.

## Providers

- OpenRouter
- OpenAI-compatible APIs
- Ollama (local models)

## Run on Windows

1. Install [Node.js 20 or newer](https://nodejs.org/).
2. Open PowerShell in the project folder.
3. Copy the example settings file and add your provider key:
   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```
   For OpenRouter, paste your key after `OPENROUTER_API_KEY=` and save the file.
4. Start the app:
   ```powershell
   npm start
   ```
   Keep this PowerShell window open while using the app.
5. Open the URL printed by the server in Chrome or Edge. It normally uses **http://localhost:3000**. If that port is busy, the app automatically tries the next ports (up to 20 higher) and prints the URL it selected.

The app has no npm package dependencies, so `npm install` is not needed. For automatic server restarts while editing, use `npm run dev` instead.

API keys are read by the server from `.env`. They are never included in the frontend or sent to the browser.

## Other platforms

Install Node.js 20+, copy `.env.example` to `.env`, add your provider key, and run `npm start`. Open the URL printed by the server in your browser. If the selected port is busy, the app automatically tries the following ports.

## Next steps

Streaming responses, tools/actions, web search, long-term memory, authentication, and a richer model picker can be added on top of this provider layer.
