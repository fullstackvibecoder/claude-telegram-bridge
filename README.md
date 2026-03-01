# Claude Telegram Bridge

A Telegram bot that bridges to the Claude Agent SDK, letting you work on your projects remotely from your phone.

Send a message in Telegram, and Claude Code reads/edits/runs code in your project directory on your server.

## Setup

### 1. Create a Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow prompts
3. Copy the bot token

### 2. Get Your Telegram User ID

Message [@userinfobot](https://t.me/userinfobot) to get your numeric user ID.

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
- `TELEGRAM_BOT_TOKEN` — from BotFather
- `ALLOWED_USER_IDS` — your Telegram user ID(s)
- `ANTHROPIC_API_KEY` — your Anthropic API key
- `PROJECTS` — comma-separated `name:/path/to/repo` pairs
- `DEFAULT_PROJECT` — which project to start in

### 4. Install and Run

```bash
npm install
npm run dev    # Development (hot reload)
npm run build  # Production build
npm start      # Production run
```

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and help |
| `/projects` | List available projects |
| `/project <name>` | Switch active project |
| `/status` | Current session info |
| `/reset` | Clear conversation history |

Any other text message is forwarded to Claude Code as a prompt, targeting the active project directory.

## How It Works

```
You (Telegram) → grammy bot → Claude Agent SDK → your project files
                                   ↓
                             reads, edits, runs code
                                   ↓
                             result → Telegram
```

- **Auth**: Only Telegram user IDs in `ALLOWED_USER_IDS` can interact
- **Sessions**: Conversation context persists per user (use `/reset` to clear)
- **Project switching**: `/project finito` changes Claude's working directory
- **Long outputs**: Automatically chunked into 4096-char Telegram messages
- **Tool updates**: Real-time status messages show what Claude is doing (reading files, running commands, etc.)

## Deployment

The bot uses long polling (no webhook setup needed). Run it on any server with Node.js 22+.

### Docker

```bash
docker build -t claude-telegram-bridge .
docker run --env-file .env claude-telegram-bridge
```

### Railway / Fly.io

Set env vars in the dashboard and deploy. The health check endpoint is at `GET /health` on the configured port.
