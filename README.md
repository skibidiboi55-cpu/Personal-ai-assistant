# Personal AI Assistant

A local-first assistant with model choice, a searchable chat library, optional voice dictation, and text-file context.

## What it can do

- Use OpenCode CLI with its existing sign-in, or connect OpenRouter, another OpenAI-compatible API, or Ollama.
- Discover models from OpenCode and choose a model per conversation. Search the Settings model list by provider or model ID to find models in large catalogs.
- Keep, search, rename, delete, and export conversations in this browser.
- Save personal instructions in this browser and include them with your prompts.
- Attach up to five small text/code files or PNG, JPEG, GIF, WebP, and PDF files. Images and PDFs are limited to 600 KB each and 900 KB total per request; PDF reading requires OpenCode CLI.
- Read assistant Markdown and code blocks safely, and copy answers or code with one click.
- Dictate a message in supported browsers after pressing the microphone button.
- Listen to an answer using browser speech synthesis after pressing **Listen**.
- Turn on **Search the web for this reply** for OpenCode web research. It resets after each send; web search needs a configured OpenCode search provider and may incur provider or workspace charges.

## Run on Windows

1. Install [Node.js 20 or newer](https://nodejs.org/).
2. Open PowerShell in the project folder.
3. Run:
   ```powershell
   npm start
   ```
   Keep this window open while using the app. There are no npm package dependencies, so `npm install` is not needed.
4. Open the URL printed by the server in Chrome or Edge. It normally uses **http://localhost:3000**. If that port is busy, the app tries the next 20 ports and prints the URL it selected.
5. In Settings, choose **OpenCode CLI** to use the account already signed in through OpenCode. If needed, sign in once from PowerShell with `opencode auth login`, then click **Refresh** in Settings. No separate API key is required for this provider.

For automatic restarts while editing, run `npm run dev` instead.

## Your data and credentials

Conversation history and personal instructions are stored in this browser’s local storage. Use **Export all** in the sidebar to download a backup, or **Export this chat** to save one conversation as Markdown. **Clear all chats** removes the locally saved conversation history.

When you send a message, its text and attached file, image, or PDF contents are sent to the selected model provider to generate a reply. Attachments are read in the browser and are not sent until you send the message. Attachments are stored in this browser along with their conversation. OpenCode needs a vision-capable model to interpret images; OpenAI-compatible providers must support standard image inputs. PDF reading uses OpenCode’s read-only file tool and is limited to the attached PDFs. Microphone access starts only after you press the dictation button; speech recognition is handled by the browser. Read-aloud starts only when you press **Listen** and uses browser speech synthesis.

OpenCode sign-in stays in OpenCode’s local credential store. The assistant calls the local CLI with a chat-only agent by default. For PDF messages, it stages temporary local copies for the request and removes them afterward; the PDF agent can read only those staged PDF paths, and cannot use shell or file-editing tools. If you explicitly turn on web search for a reply, it uses a separate agent allowed to search and read web pages; it cannot use shell or file-editing tools. Search queries and pages are sent to your configured OpenCode search provider. OpenCode search setup depends on the provider you choose, and some providers charge per search. See [OpenCode web search setup](https://opencode.ai/v2/docs/websearch/) and check your provider’s billing before enabling it.

For other providers, API keys are stored in the local server’s `.env` file and are never returned to the browser. The server binds to `127.0.0.1` so it is reachable from this computer only. API requests also reject cross-site browser origins, and the app sets browser security headers to reduce cross-origin request and framing risks.

## Other platforms

Install Node.js 20 or newer, run `npm start`, and open the URL printed by the server.
