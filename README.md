# Personal AI Assistant

A small, real-model personal AI assistant with a provider-agnostic backend.

## Providers

- OpenRouter
- OpenAI-compatible APIs
- Ollama (local models)

## Run

1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Put your provider API key in `.env`.
4. Run `npm start`.
5. Open `http://localhost:3000`.

API keys stay server-side and are never placed in the browser bundle.

## Next steps

Streaming responses, tools/actions, web search, long-term memory, authentication, and a richer model picker can be added on top of this provider layer.
