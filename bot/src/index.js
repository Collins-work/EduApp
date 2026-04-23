require("dotenv").config();

const http = require("http");
const { Telegraf, Markup } = require("telegraf");
const {
  addFlashcard,
  addQuiz,
  addScore,
  evaluateAnswer,
  listFlashcards,
  listQuizzes,
  renderLeaderboard,
  resetLeaderboard,
} = require("./services/quizService");
const {
  addGame,
  addGameScore,
  findGame,
  listGames,
  removeGame,
  renderGameLeaderboard,
  resetGameLeaderboard,
} = require("./services/gameService");
const { syncStudySource } = require("./services/studySourceSync");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID || 0);
const EDU_APP_URL = process.env.EDU_APP_URL || "https://your-edu-app.vercel.app";
const GAME_HUB_URL = process.env.GAME_HUB_URL || "https://your-game-hub.vercel.app";
const EDU_APP_API_URL = process.env.EDU_APP_API_URL || "";
const PORT = Number(process.env.PORT || 0);
const NOTEBOOKLM_SOURCE_PATH = process.env.NOTEBOOKLM_SOURCE_PATH || "";

if (!BOT_TOKEN) {
  throw new Error("Missing BOT_TOKEN in environment.");
}

if (!ADMIN_ID) {
  throw new Error("Missing ADMIN_ID in environment.");
}

const bot = new Telegraf(BOT_TOKEN);
const pendingQuizByChat = new Map();
const pendingQuizByUser = new Map();
const pendingFlashcardByUser = new Map();

function isAdmin(ctx) {
  return Number(ctx.from?.id) === ADMIN_ID;
}

function requireAdmin(ctx) {
  if (!isAdmin(ctx)) {
    ctx.reply("This command is restricted to the configured ADMIN_ID.");
    return false;
  }
  return true;
}

function parsePipePayload(text, command) {
  const cleaned = text.replace(command, "").trim();
  const split = cleaned.split("|");
  if (split.length < 2) {
    return null;
  }

  const left = split[0].trim();
  const right = split.slice(1).join("|").trim();

  if (!left || !right) {
    return null;
  }

  return { left, right };
}

function formatQuizPrompt(quiz) {
  const lines = [`Quiz: ${quiz.question}`];
  if (quiz.choices?.length) {
    const letters = ["A", "B", "C", "D", "E", "F"];
    quiz.choices.forEach((choice, idx) => {
      lines.push(`${letters[idx] || idx + 1}. ${choice}`);
    });
  }
  lines.push("Reply with your answer in chat.");
  return lines.join("\n");
}

function formatFlashcardPrompt(question) {
  return [
    `Flashcard question saved: ${question}`,
    "Now send the answer for this flashcard.",
  ].join("\n");
}

function formatQuizPromptForCreation(question) {
  return [
    `Quiz question saved: ${question}`,
    "Now send the correct answer. You can add synonyms separated by semicolons if you want.",
  ].join("\n");
}

function isPrivateChat(ctx) {
  return ctx.chat?.type === "private";
}

function getEduAppUrl() {
  try {
    const url = new URL(EDU_APP_URL);
    if (EDU_APP_API_URL) {
      url.searchParams.set("api", EDU_APP_API_URL);
    }
    return url.toString();
  } catch (_error) {
    return EDU_APP_URL;
  }
}

function eduAppButtons() {
  return Markup.inlineKeyboard([
    Markup.button.webApp("Open Edu Mini App", getEduAppUrl()),
  ]);
}

function gameHubButtons() {
  return Markup.inlineKeyboard([
    Markup.button.webApp("Open Game Hub", GAME_HUB_URL),
  ]);
}

function gameListKeyboard() {
  const games = listGames();
  if (!games.length) {
    return null;
  }

  const rows = games.map((game) => [
    Markup.button.url(`Play ${game.title}`, game.url),
  ]);

  return Markup.inlineKeyboard(rows);
}

bot.start(async (ctx) => {
  await ctx.reply(
    "Edu Game Bot is ready for group learning and fun. Use /quiz, /flashcard, /playgame.",
    Markup.keyboard([
      [Markup.button.webApp("Launch Edu Mini App", getEduAppUrl())],
      [Markup.button.webApp("Launch Game Hub", GAME_HUB_URL)],
    ]).resize(),
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    [
      "Group Commands:",
      "/quiz - Ask a random quiz question",
      "/flashcard - Show a flashcard",
      "/playgame - Open game dashboard",
      "/playchess, /playcards, /playtrivia, /playstrategy - launch specific games",
      "/leaderboard - Quiz leaderboard",
      "/gameleaderboard - Game leaderboard",
      "",
      "Admin Commands:",
      "/addcard question|answer",
      "/addquiz question|answer",
      "/addgame name|url",
      "/removegame name",
      "/resetquiz",
      "/resetleaderboard",
      "",
      "Study Creation Commands:",
      "/newcard - Create a flashcard in a private chat",
      "/newquiz - Create a quiz in a private chat",
      "/cancelcard - Cancel a pending private flashcard",
      "/cancelquiz - Cancel a pending private quiz",
    ].join("\n"),
  );
});

bot.command("quiz", async (ctx) => {
  const quizzes = listQuizzes();
  if (!quizzes.length) {
    await ctx.reply("No quizzes available yet.");
    return;
  }

  const picked = quizzes[Math.floor(Math.random() * quizzes.length)];
  pendingQuizByChat.set(ctx.chat.id, {
    quiz: picked,
    askedAt: Date.now(),
  });

  await ctx.reply(formatQuizPrompt(picked), eduAppButtons());
});

bot.command("flashcard", async (ctx) => {
  const cards = listFlashcards();
  if (!cards.length) {
    await ctx.reply("No flashcards available yet.");
    return;
  }

  const picked = cards[Math.floor(Math.random() * cards.length)];
  await ctx.reply(
    `Flashcard: ${picked.question}`,
    Markup.inlineKeyboard([
      [Markup.button.callback("Show Answer", `show_answer|${picked.answer}`)],
      [Markup.button.callback("Next Card", "next_card")],
      [Markup.button.webApp("Open Edu Mini App", getEduAppUrl())],
    ]),
  );
});

bot.action("next_card", async (ctx) => {
  const cards = listFlashcards();
  if (!cards.length) {
    await ctx.answerCbQuery("No flashcards available.");
    return;
  }

  const picked = cards[Math.floor(Math.random() * cards.length)];
  await ctx.editMessageText(
    `Flashcard: ${picked.question}`,
    Markup.inlineKeyboard([
      [Markup.button.callback("Show Answer", `show_answer|${picked.answer}`)],
      [Markup.button.callback("Next Card", "next_card")],
      [Markup.button.webApp("Open Edu Mini App", getEduAppUrl())],
    ]),
  );
  await ctx.answerCbQuery();
});

bot.action(/show_answer\|(.+)/, async (ctx) => {
  const answer = ctx.match[1] || "(no answer)";
  await ctx.answerCbQuery();
  await ctx.reply(`Answer: ${answer}`);
});

bot.command("leaderboard", async (ctx) => {
  await ctx.reply(`Quiz Leaderboard:\n${renderLeaderboard()}`);
});

bot.command("gameleaderboard", async (ctx) => {
  await ctx.reply(`Game Leaderboard:\n${renderGameLeaderboard()}`);
});

bot.command("addcard", async (ctx) => {
  if (!requireAdmin(ctx)) {
    return;
  }

  const payload = parsePipePayload(ctx.message.text, "/addcard");
  if (!payload) {
    await ctx.reply("Usage: /addcard question|answer");
    return;
  }

  const created = addFlashcard(payload.left, payload.right);
  await ctx.reply(`Flashcard added: ${created.question}`);
});

bot.command("newcard", async (ctx) => {
  if (!isPrivateChat(ctx)) {
    await ctx.reply("Please use /newcard in a private chat with the bot.");
    return;
  }

  pendingFlashcardByUser.set(ctx.from.id, {
    stage: "question",
  });

  await ctx.reply("Send the flashcard question.");
});

bot.command("newquiz", async (ctx) => {
  if (!isPrivateChat(ctx)) {
    await ctx.reply("Please use /newquiz in a private chat with the bot.");
    return;
  }

  pendingQuizByUser.set(ctx.from.id, {
    stage: "question",
  });

  await ctx.reply("Send the quiz question.");
});

bot.command("cancelcard", async (ctx) => {
  const removed = pendingFlashcardByUser.delete(ctx.from.id);
  await ctx.reply(
    removed ? "Pending flashcard creation canceled." : "No pending flashcard creation found.",
  );
});

bot.command("cancelquiz", async (ctx) => {
  const removed = pendingQuizByUser.delete(ctx.from.id);
  await ctx.reply(
    removed ? "Pending quiz creation canceled." : "No pending quiz creation found.",
  );
});

bot.command("addquiz", async (ctx) => {
  if (!requireAdmin(ctx)) {
    return;
  }

  const payload = parsePipePayload(ctx.message.text, "/addquiz");
  if (!payload) {
    await ctx.reply("Usage: /addquiz question|answer");
    return;
  }

  const created = addQuiz(payload.left, payload.right);
  await ctx.reply(`Quiz added: ${created.question}`);
});

bot.command("resetquiz", async (ctx) => {
  if (!requireAdmin(ctx)) {
    return;
  }

  resetLeaderboard();
  pendingQuizByChat.clear();
  await ctx.reply("Quiz scores and active questions were reset.");
});

bot.command("addgame", async (ctx) => {
  if (!requireAdmin(ctx)) {
    return;
  }

  const payload = parsePipePayload(ctx.message.text, "/addgame");
  if (!payload) {
    await ctx.reply("Usage: /addgame name|url");
    return;
  }

  const created = addGame(payload.left, payload.right);
  if (!created) {
    await ctx.reply("Game already exists.");
    return;
  }

  await ctx.reply(`Game added: ${created.title} (${created.url})`);
});

bot.command("removegame", async (ctx) => {
  if (!requireAdmin(ctx)) {
    return;
  }

  const name = ctx.message.text.replace("/removegame", "").trim();
  if (!name) {
    await ctx.reply("Usage: /removegame name");
    return;
  }

  const removed = removeGame(name);
  await ctx.reply(removed ? `Removed game: ${name}` : "Game not found.");
});

bot.command("resetleaderboard", async (ctx) => {
  if (!requireAdmin(ctx)) {
    return;
  }

  resetGameLeaderboard();
  await ctx.reply("Game leaderboard reset.");
});

bot.command("syncstudy", async (ctx) => {
  if (!requireAdmin(ctx)) {
    return;
  }

  const result = syncStudySource(NOTEBOOKLM_SOURCE_PATH);
  if (!result.synced) {
    await ctx.reply(
      [
        "Study sync failed.",
        result.reason,
        "Set NOTEBOOKLM_SOURCE_PATH to an exported NotebookLM notes file, Google Doc text export, or Markdown file.",
      ].join("\n"),
    );
    return;
  }

  await ctx.reply(
    `Study source synced. Flashcards: ${result.flashcards}, quizzes: ${result.quizzes}.`,
  );
});

bot.command("playgame", async (ctx) => {
  const kb = gameListKeyboard();
  if (!kb) {
    await ctx.reply("No games registered yet.");
    return;
  }

  await ctx.reply("Game Hub: choose a game", kb);
  await ctx.reply("Or open the full game dashboard:", gameHubButtons());
});

["chess", "cards", "trivia", "strategy"].forEach((gameName) => {
  bot.command(`play${gameName}`, async (ctx) => {
    const game = findGame(gameName);
    if (!game) {
      await ctx.reply(`Game not found: ${gameName}`);
      return;
    }

    await ctx.reply(
      `Launching ${game.title}`,
      Markup.inlineKeyboard([
        [Markup.button.url(`Open ${game.title}`, game.url)],
        [Markup.button.webApp("Open Game Hub", GAME_HUB_URL)],
      ]),
    );
  });
});

bot.on("message", async (ctx, next) => {
  const dataRaw = ctx.message?.web_app_data?.data;
  if (dataRaw) {
    try {
      const payload = JSON.parse(dataRaw);
      const safeType = payload.type || "unknown";

      if (safeType === "create_flashcard") {
        const question = String(payload.question || "").trim();
        const answer = String(payload.answer || "").trim();

        if (!question || !answer) {
          await ctx.reply("Flashcard creation needs both a question and an answer.");
          return;
        }

        const created = addFlashcard(question, answer);
        await ctx.reply(`Flashcard added: ${created.question}`);
        return;
      }

      if (safeType === "create_quiz") {
        const question = String(payload.question || "").trim();
        const answer = String(payload.answer || "").trim();
        const synonyms = String(payload.synonyms || "").trim();

        if (!question || !answer) {
          await ctx.reply("Quiz creation needs both a question and an answer.");
          return;
        }

        const created = addQuiz(question, [answer, synonyms].filter(Boolean).join(";"));
        await ctx.reply(`Quiz added: ${created.question}`);
        return;
      }

      if (safeType === "quiz_result") {
        const score = Number(payload.score || 0);
        addScore(ctx.from, score);
        await ctx.reply(
          `${ctx.from.first_name} submitted quiz score: ${score}.\nQuiz Leaderboard:\n${renderLeaderboard()}`,
        );
        return;
      }

      if (safeType === "game_result") {
        const score = Number(payload.score || 0);
        addGameScore(ctx.from, score);
        await ctx.reply(
          `${ctx.from.first_name} submitted game score: ${score}.\nGame Leaderboard:\n${renderGameLeaderboard()}`,
        );
        return;
      }

      await ctx.reply(`Received WebApp payload type: ${safeType}`);
      return;
    } catch (_error) {
      await ctx.reply("Could not parse WebApp data payload.");
      return;
    }
  }

  const text = ctx.message?.text;
  const pendingFlashcard = pendingFlashcardByUser.get(ctx.from?.id);
  if (pendingFlashcard && typeof text === "string" && !text.startsWith("/")) {
    const trimmedText = text.trim();
    if (!trimmedText) {
      await ctx.reply("Please send a non-empty message.");
      return;
    }

    if (pendingFlashcard.stage === "question") {
      pendingFlashcard.question = trimmedText;
      pendingFlashcard.stage = "answer";
      pendingFlashcardByUser.set(ctx.from.id, pendingFlashcard);
      await ctx.reply(formatFlashcardPrompt(trimmedText));
      return;
    }

    if (pendingFlashcard.stage === "answer") {
      const created = addFlashcard(pendingFlashcard.question, trimmedText);
      pendingFlashcardByUser.delete(ctx.from.id);
      await ctx.reply(`Flashcard added: ${created.question}`);
      return;
    }
  }

  const pendingQuiz = pendingQuizByUser.get(ctx.from?.id);
  if (pendingQuiz && typeof text === "string" && !text.startsWith("/")) {
    const trimmedText = text.trim();
    if (!trimmedText) {
      await ctx.reply("Please send a non-empty message.");
      return;
    }

    if (pendingQuiz.stage === "question") {
      pendingQuiz.question = trimmedText;
      pendingQuiz.stage = "answer";
      pendingQuizByUser.set(ctx.from.id, pendingQuiz);
      await ctx.reply(formatQuizPromptForCreation(trimmedText));
      return;
    }

    if (pendingQuiz.stage === "answer") {
      const created = addQuiz(pendingQuiz.question, trimmedText);
      pendingQuizByUser.delete(ctx.from.id);
      await ctx.reply(`Quiz added: ${created.question}`);
      return;
    }
  }

  if (typeof text === "string" && !text.startsWith("/")) {
    const active = pendingQuizByChat.get(ctx.chat.id);
    if (!active) {
      await next();
      return;
    }

    const ok = evaluateAnswer(active.quiz, text);
    if (ok) {
      addScore(ctx.from, 1);
      pendingQuizByChat.delete(ctx.chat.id);
      await ctx.reply(
        `Correct, ${ctx.from.first_name}. +1 point\nQuiz Leaderboard:\n${renderLeaderboard()}`,
      );
      return;
    }

    await ctx.reply("Not quite. Try again, or ask for /quiz for a new one.");
    return;
  }

  await next();
});

function startContentServer() {
  if (!PORT) {
    return null;
  }

  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (requestUrl.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (requestUrl.pathname === "/api/edu-content") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          flashcards: listFlashcards(),
          quizzes: listQuizzes(),
        }),
      );
      return;
    }

    if (requestUrl.pathname === "/api/flashcards") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ flashcards: listFlashcards() }));
      return;
    }

    if (requestUrl.pathname === "/api/quizzes") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ quizzes: listQuizzes() }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(PORT, () => {
    console.log(`Content API listening on port ${PORT}.`);
  });

  return server;
}

bot.catch((error, ctx) => {
  console.error("Bot error", error, "in update", ctx.updateType);
});

(async () => {
  startContentServer();

  await bot.telegram.setMyCommands([
    { command: "quiz", description: "Ask quiz question" },
    { command: "flashcard", description: "Show flashcard" },
    { command: "newcard", description: "Create flashcard in private chat" },
    { command: "newquiz", description: "Create quiz in private chat" },
    { command: "playgame", description: "Open game hub" },
    { command: "leaderboard", description: "Quiz leaderboard" },
    { command: "gameleaderboard", description: "Game leaderboard" },
    { command: "syncstudy", description: "Sync study source file" },
    { command: "cancelcard", description: "Cancel flashcard creation" },
    { command: "cancelquiz", description: "Cancel quiz creation" },
    { command: "help", description: "Show all commands" },
  ]);

  await bot.telegram.setChatMenuButton({
    menu_button: {
      type: "web_app",
      text: "Open Edu App",
      web_app: { url: getEduAppUrl() },
    },
  });

  await bot.launch({
    allowed_updates: ["message", "callback_query"],
  });

  console.log("Bot started.");
})();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
