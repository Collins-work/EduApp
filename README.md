# Edu App + Telegram Bot

This workspace contains:

- `bot/` - Telegram bot backend (Node.js + Telegraf)
- `web/edu-app/` - Educational Mini App (flashcards + quizzes)
- `web/game-hub/` - Game Hub dashboard

## 1) Bot Setup

### Install and run

```bash
cd bot
npm install
copy .env.example .env
# Edit .env with your values
npm run start
```

Required environment values in `.env`:

- `BOT_TOKEN` from BotFather
- `ADMIN_ID` Telegram numeric user ID with admin privileges in bot logic
- `EDU_APP_URL` HTTPS URL for `web/edu-app`
- `GAME_HUB_URL` HTTPS URL for `web/game-hub`
- `NOTEBOOKLM_SOURCE_PATH` local path to a NotebookLM export, Google Docs text export, or Markdown file containing study cards
- `NOTEBOOKLM_SOURCE_URL` optional placeholder if you want to keep the original source URL in your config

## 2) Deploy Frontends (Vercel)

Deploy each web app folder independently as static sites:

- `web/edu-app` -> e.g. `https://my-edu-app.vercel.app`
- `web/game-hub` -> e.g. `https://my-game-hub.vercel.app`

After deployment, update `.env` values in `bot/.env`.

## 3) BotFather Configuration

For your bot:

1. `/setdomain` -> set your Mini App domain (for example `https://my-edu-app.vercel.app` and `https://my-game-hub.vercel.app` domain as needed).
2. `/newapp` -> register the educational mini app URL.
3. `/newgame` -> register each game URL if you want Telegram game metadata entries.
4. `/setmenubutton` -> set a persistent menu button to your Edu Mini App URL.
5. Disable privacy mode if you want broader command handling in group chats (`/setprivacy`).

## 4) Group Chat Usage

Add bot to group as a member, then use:

- `/quiz`
- `/flashcard`
- `/playgame`
- `/playchess`
- `/playcards`
- `/playtrivia`
- `/playstrategy`
- `/leaderboard`
- `/gameleaderboard`

Admin-only commands (must match `ADMIN_ID`):

- `/addcard question|answer`
- `/newcard` in a private chat to create a flashcard step-by-step
- `/addquiz question|answer`
- `/resetquiz`
- `/addgame name|url`
- `/removegame name`
- `/resetleaderboard`
- `/cancelcard` to stop a pending private flashcard setup

Flashcards created this way are saved to `bot/data/flashcards.json`, so `/flashcard` in group chat will use them immediately.

## 5) Mini App Result Flow

Both frontends call `Telegram.WebApp.sendData(...)`:

- Edu app sends `{"type":"quiz_result","score":number}`
- Game hub sends `{"type":"game_result","score":number}`

Bot receives this as `web_app_data` and posts leaderboard updates back to chat.

## 6) Optional Content Import

NotebookLM does not expose a public bot-friendly API, so the bot links to it through an export/sync file. If you do not want to use that flow, the admin can create flashcards manually in a private chat with `/newcard`. The supported NotebookLM workflow is still:

1. Export your NotebookLM study notes, or copy them into a Google Doc/Markdown file.
2. Format lines like `Card: question | answer` and `Quiz: question | answer; synonym1; synonym2`.
3. Set `NOTEBOOKLM_SOURCE_PATH` in `.env` to that file.
4. Run `/syncstudy` as the admin to refresh the bot data.

That sync writes into:

- `bot/data/flashcards.json`
- `bot/data/quizzes.json`

Current implementation is file-based and ready for that extension. If you later move the source to a web-hosted export, the same parser can be reused with a download step.
