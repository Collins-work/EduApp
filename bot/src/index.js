require("dotenv").config();

const http = require("http");
const { Chess } = require("chess.js");
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
  addGameResult,
  findGame,
  listGames,
  removeGame,
  renderGameLeaderboard,
  resetGameLeaderboard,
} = require("./services/gameService");
const { readJson, writeJson } = require("./services/storage");
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
const pendingGroupChessChallengeByChat = new Map();
const activeChessMatchesById = new Map();
const activeChessMatchByPlayer = new Map();
const globalChessQueue = [];
const globalChessPlayerContext = new Map();
const MULTIPLAYER_CHESS_STATE_FILE = "chessMultiplayer.json";

function loadChessState() {
  const snapshot = readJson(MULTIPLAYER_CHESS_STATE_FILE, {
    pendingChallenges: [],
    activeMatches: [],
    globalQueue: [],
    globalPlayers: [],
  });

  pendingGroupChessChallengeByChat.clear();
  activeChessMatchesById.clear();
  activeChessMatchByPlayer.clear();
  globalChessQueue.splice(0, globalChessQueue.length);
  globalChessPlayerContext.clear();

  (snapshot.pendingChallenges || []).forEach((item) => {
    if (item && typeof item.chatId !== "undefined") {
      pendingGroupChessChallengeByChat.set(item.chatId, item.challenge);
    }
  });

  (snapshot.activeMatches || []).forEach((match) => {
    if (!match || !match.id || !match.players?.w?.id || !match.players?.b?.id || !match.fen) {
      return;
    }

    try {
      const chess = new Chess(match.fen);
      activeChessMatchesById.set(match.id, {
        ...match,
        chess,
      });
      activeChessMatchByPlayer.set(match.players.w.id, match.id);
      activeChessMatchByPlayer.set(match.players.b.id, match.id);
    } catch (_error) {
      // Ignore invalid persisted matches.
    }
  });

  (snapshot.globalQueue || []).forEach((id) => {
    if (id) {
      globalChessQueue.push(id);
    }
  });

  (snapshot.globalPlayers || []).forEach((entry) => {
    if (entry?.id) {
      globalChessPlayerContext.set(entry.id, entry);
    }
  });
}

function persistChessState() {
  const pendingChallenges = [];
  pendingGroupChessChallengeByChat.forEach((challenge, chatId) => {
    pendingChallenges.push({ chatId, challenge });
  });

  const activeMatches = [];
  activeChessMatchesById.forEach((match) => {
    activeMatches.push({
      id: match.id,
      mode: match.mode,
      chatId: match.chatId || null,
      players: match.players,
      createdAt: match.createdAt,
      fen: match.chess.fen(),
    });
  });

  const globalPlayers = [];
  globalChessPlayerContext.forEach((player) => {
    globalPlayers.push(player);
  });

  writeJson(MULTIPLAYER_CHESS_STATE_FILE, {
    pendingChallenges,
    activeMatches,
    globalQueue: [...globalChessQueue],
    globalPlayers,
  });
}

function isGroupOrSupergroup(ctx) {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

function userDisplayName(user) {
  if (!user) {
    return "Unknown";
  }
  if (user.username) {
    return `@${user.username}`;
  }
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || "Player";
}

function generateMatchId() {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function formatBoardFromChess(chess) {
  const rows = chess.board();
  const lines = ["  a b c d e f g h"];
  for (let rankIndex = 0; rankIndex < rows.length; rankIndex += 1) {
    const rank = 8 - rankIndex;
    const row = [String(rank)];
    for (let file = 0; file < 8; file += 1) {
      const piece = rows[rankIndex][file];
      if (!piece) {
        row.push(".");
        continue;
      }
      row.push(piece.color === "w" ? piece.type.toUpperCase() : piece.type.toLowerCase());
    }
    lines.push(row.join(" "));
  }
  return lines.join("\n");
}

function colorForPlayer(match, playerId) {
  if (match.players.w.id === playerId) {
    return "w";
  }
  if (match.players.b.id === playerId) {
    return "b";
  }
  return "";
}

function turnLabel(turn) {
  return turn === "w" ? "White" : "Black";
}

function playerForColor(match, color) {
  return color === "w" ? match.players.w : match.players.b;
}

function parseMoveInput(rawText) {
  const cleaned = String(rawText || "").toLowerCase().trim();
  const match = cleaned.match(/^([a-h][1-8])\s*(?:-|to|\s)\s*([a-h][1-8])$/i) || cleaned.match(/^([a-h][1-8])([a-h][1-8])$/i);
  if (!match) {
    return null;
  }
  return {
    from: match[1].toLowerCase(),
    to: match[2].toLowerCase(),
  };
}

function removeFromGlobalQueue(playerId) {
  const queueIndex = globalChessQueue.findIndex((id) => id === playerId);
  if (queueIndex >= 0) {
    globalChessQueue.splice(queueIndex, 1);
    persistChessState();
  }
}

function endChessMatch(matchId) {
  const match = activeChessMatchesById.get(matchId);
  if (!match) {
    return;
  }
  activeChessMatchesById.delete(matchId);
  activeChessMatchByPlayer.delete(match.players.w.id);
  activeChessMatchByPlayer.delete(match.players.b.id);
  if (match.mode === "global") {
    globalChessPlayerContext.delete(match.players.w.id);
    globalChessPlayerContext.delete(match.players.b.id);
  }
  persistChessState();
}

function chessActionKeyboard(match) {
  const rows = [];
  if (match.mode === "group") {
    rows.push([
      Markup.button.callback("Refresh Board", `chess_refresh|${match.id}`),
      Markup.button.callback("Resign", `chess_resign|${match.id}`),
    ]);
  } else {
    rows.push([Markup.button.callback("Refresh Board", `chess_refresh|${match.id}`)]);
  }
  return Markup.inlineKeyboard(rows);
}

function challengeKeyboard(chatId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Accept Challenge", `chess_accept|${chatId}`)],
  ]);
}

function globalStateText(match) {
  if (match.chess.isCheckmate()) {
    return "Checkmate.";
  }
  if (match.chess.isStalemate()) {
    return "Draw by stalemate.";
  }
  if (match.chess.isInsufficientMaterial()) {
    return "Draw by insufficient material.";
  }
  if (match.chess.isThreefoldRepetition()) {
    return "Draw by repetition.";
  }
  if (match.chess.isDraw()) {
    return "Draw.";
  }
  if (match.chess.inCheck()) {
    return `${turnLabel(match.chess.turn())} is in check.`;
  }
  return "";
}

function finalizeMatchResult(match, resultType, winnerColor = "") {
  if (resultType === "win") {
    const loserColor = winnerColor === "w" ? "b" : "w";
    addGameResult(match.players[winnerColor], {
      game: "chess",
      mode: match.mode,
      outcome: "win",
    });
    addGameResult(match.players[loserColor], {
      game: "chess",
      mode: match.mode,
      outcome: "loss",
    });
    return;
  }

  addGameResult(match.players.w, {
    game: "chess",
    mode: match.mode,
    outcome: "draw",
  });
  addGameResult(match.players.b, {
    game: "chess",
    mode: match.mode,
    outcome: "draw",
  });
}

async function sendMatchUpdate(match, header) {
  const turn = match.chess.turn();
  const turnPlayer = playerForColor(match, turn);
  const boardText = formatBoardFromChess(match.chess);
  const stateLine = globalStateText(match);
  const lines = [
    header,
    "",
    `<pre>${escapeHtml(boardText)}</pre>`,
    stateLine,
    `Turn: ${turnLabel(turn)} (${userDisplayName(turnPlayer)})`,
    "Play moves with /move e2e4",
  ].filter(Boolean);
  const message = lines.join("\n");

  if (match.mode === "group") {
    await bot.telegram.sendMessage(match.chatId, message, {
      parse_mode: "HTML",
      ...chessActionKeyboard(match),
    });
    return;
  }

  await bot.telegram.sendMessage(match.players.w.chatId, message, {
    parse_mode: "HTML",
    ...chessActionKeyboard(match),
  });
  await bot.telegram.sendMessage(match.players.b.chatId, message, {
    parse_mode: "HTML",
    ...chessActionKeyboard(match),
  });
}

function makeMatchSummary(match) {
  const turn = match.chess.turn();
  return [
    `White: ${userDisplayName(match.players.w)}`,
    `Black: ${userDisplayName(match.players.b)}`,
    `Turn: ${turnLabel(turn)} (${userDisplayName(playerForColor(match, turn))})`,
  ].join("\n");
}

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

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderFlashcardMessage(question, count) {
  return [
    "<b>Flashcard Practice</b>",
    count ? `<i>Total cards: ${count}</i>` : "",
    "",
    `<b>Question</b>: ${escapeHtml(question)}`,
    "",
    "Tap <b>Show Answer</b> when you are ready.",
  ]
    .filter(Boolean)
    .join("\n");
}

function flashcardKeyboard(answer) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Reveal Answer", `show_answer|${answer}`)],
    [Markup.button.callback("Next Flashcard", "next_card")],
    [Markup.button.webApp("Open Edu Mini App", getEduAppUrl())],
  ]);
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
    Markup.button.webApp("Open Game Hub", getGameHubUrl()),
  ]);
}

function getGameHubUrl(gameName) {
  try {
    const url = new URL(GAME_HUB_URL);
    if (gameName) {
      url.searchParams.set("game", gameName);
    }
    return url.toString();
  } catch (_error) {
    return GAME_HUB_URL;
  }
}

function gameListKeyboard() {
  const games = listGames();
  if (!games.length) {
    return null;
  }

  const rows = games.map((game) => [
    Markup.button.webApp(`Play ${game.title}`, getGameHubUrl(game.name)),
  ]);

  return Markup.inlineKeyboard(rows);
}

bot.start(async (ctx) => {
  await ctx.reply(
    [
      "Welcome to Edu Game Bot.",
      "",
      "I am here to make learning fun, simple, and interactive for your group.",
      "",
      "Try one of these commands:",
      "/quiz - Get a quick quiz challenge",
      "/flashcard - Review a smart flashcard",
      "/playgame - Open the game dashboard",
      "",
      "If you need help anytime, use /help.",
    ].join("\n"),
    Markup.keyboard([
      [Markup.button.webApp("Launch Edu Mini App", getEduAppUrl())],
      [Markup.button.webApp("Launch Game Hub", getGameHubUrl())],
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
      "/chessgroup - challenge a replied user in group chess",
      "/acceptchess - accept a pending group chess challenge",
      "/globalchess - join global chess matchmaking (private chat)",
      "/leaveglobalchess - leave global chess queue",
      "/move e2e4 - play a chess move in your active multiplayer match",
      "/chessboard - show current multiplayer chess board",
      "/resign - resign your active multiplayer chess match",
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
    renderFlashcardMessage(picked.question, cards.length),
    {
      ...flashcardKeyboard(picked.answer),
      parse_mode: "HTML",
    },
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
    renderFlashcardMessage(picked.question, cards.length),
    {
      ...flashcardKeyboard(picked.answer),
      parse_mode: "HTML",
    },
  );
  await ctx.answerCbQuery();
});

bot.action(/show_answer\|(.+)/, async (ctx) => {
  const answer = ctx.match[1] || "(no answer)";
  await ctx.answerCbQuery();
  await ctx.reply(`<b>Answer</b>: ${escapeHtml(answer)}`, { parse_mode: "HTML" });
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
        [Markup.button.webApp(`Play ${game.title}`, getGameHubUrl(game.name))],
        [Markup.button.webApp("Open Game Hub", getGameHubUrl())],
      ]),
    );
  });
});

bot.command("chessgroup", async (ctx) => {
  if (!isGroupOrSupergroup(ctx)) {
    await ctx.reply("Use /chessgroup in a group or supergroup chat.");
    return;
  }

  const challengerId = Number(ctx.from?.id || 0);
  if (!challengerId) {
    await ctx.reply("Could not identify your account for matchmaking.");
    return;
  }

  if (activeChessMatchByPlayer.has(challengerId)) {
    await ctx.reply("You already have an active chess match. Use /move, /chessboard, or /resign.");
    return;
  }

  const repliedUser = ctx.message?.reply_to_message?.from;
  if (!repliedUser || Number(repliedUser.id) === challengerId) {
    await ctx.reply("Reply to another player's message with /chessgroup to challenge them.");
    return;
  }

  const challengedId = Number(repliedUser.id);
  if (activeChessMatchByPlayer.has(challengedId)) {
    await ctx.reply(`${userDisplayName(repliedUser)} is already in an active chess match.`);
    return;
  }

  const existing = pendingGroupChessChallengeByChat.get(ctx.chat.id);
  if (existing) {
    await ctx.reply("There is already a pending group chess challenge in this chat. Use /acceptchess first.");
    return;
  }

  pendingGroupChessChallengeByChat.set(ctx.chat.id, {
    challenger: {
      id: challengerId,
      first_name: ctx.from.first_name,
      last_name: ctx.from.last_name,
      username: ctx.from.username,
      chatId: ctx.chat.id,
    },
    challenged: {
      id: challengedId,
      first_name: repliedUser.first_name,
      last_name: repliedUser.last_name,
      username: repliedUser.username,
      chatId: ctx.chat.id,
    },
    createdAt: Date.now(),
  });
  persistChessState();

  await ctx.reply(
    `${userDisplayName(repliedUser)}, you were challenged by ${userDisplayName(ctx.from)}. Use /acceptchess or tap Accept Challenge.`,
    challengeKeyboard(ctx.chat.id),
  );
});

bot.command("acceptchess", async (ctx) => {
  if (!isGroupOrSupergroup(ctx)) {
    await ctx.reply("Use /acceptchess in a group or supergroup chat.");
    return;
  }

  const pending = pendingGroupChessChallengeByChat.get(ctx.chat.id);
  if (!pending) {
    await ctx.reply("No pending group chess challenge in this chat.");
    return;
  }

  if (Number(ctx.from?.id || 0) !== pending.challenged.id) {
    await ctx.reply(`Only ${userDisplayName(pending.challenged)} can accept this challenge.`);
    return;
  }

  if (activeChessMatchByPlayer.has(pending.challenger.id) || activeChessMatchByPlayer.has(pending.challenged.id)) {
    pendingGroupChessChallengeByChat.delete(ctx.chat.id);
    persistChessState();
    await ctx.reply("Challenge canceled because one player is already in a match.");
    return;
  }

  pendingGroupChessChallengeByChat.delete(ctx.chat.id);
  const matchId = generateMatchId();
  const match = {
    id: matchId,
    mode: "group",
    chatId: ctx.chat.id,
    chess: new Chess(),
    createdAt: Date.now(),
    players: {
      w: pending.challenger,
      b: pending.challenged,
    },
  };

  activeChessMatchesById.set(matchId, match);
  activeChessMatchByPlayer.set(pending.challenger.id, matchId);
  activeChessMatchByPlayer.set(pending.challenged.id, matchId);
  persistChessState();

  await sendMatchUpdate(match, "Group chess started.");
  await ctx.reply(makeMatchSummary(match));
});

bot.command("globalchess", async (ctx) => {
  if (!isPrivateChat(ctx)) {
    await ctx.reply("Use /globalchess in private chat with the bot for global matchmaking.");
    return;
  }

  const playerId = Number(ctx.from?.id || 0);
  if (!playerId) {
    await ctx.reply("Could not identify your account for matchmaking.");
    return;
  }

  if (activeChessMatchByPlayer.has(playerId)) {
    await ctx.reply("You already have an active chess match. Use /move, /chessboard, or /resign.");
    return;
  }

  if (globalChessQueue.includes(playerId)) {
    await ctx.reply("You are already in the global queue. Use /leaveglobalchess to cancel.");
    return;
  }

  globalChessPlayerContext.set(playerId, {
    id: playerId,
    first_name: ctx.from.first_name,
    last_name: ctx.from.last_name,
    username: ctx.from.username,
    chatId: ctx.chat.id,
  });
  persistChessState();

  if (!globalChessQueue.length) {
    globalChessQueue.push(playerId);
    persistChessState();
    await ctx.reply("You joined global chess queue. I will match you with the next available player.");
    return;
  }

  const opponentId = globalChessQueue.shift();
  if (!opponentId || opponentId === playerId) {
    globalChessQueue.push(playerId);
    persistChessState();
    await ctx.reply("Waiting for another global player...");
    return;
  }

  if (activeChessMatchByPlayer.has(opponentId)) {
    globalChessQueue.push(playerId);
    persistChessState();
    await ctx.reply("Opponent was no longer available. You remain queued.");
    return;
  }

  const playerA = globalChessPlayerContext.get(opponentId);
  const playerB = globalChessPlayerContext.get(playerId);
  if (!playerA || !playerB) {
    globalChessQueue.push(playerId);
    persistChessState();
    await ctx.reply("Could not finalize match right now. Please try /globalchess again.");
    return;
  }

  const matchId = generateMatchId();
  const whiteFirst = Math.random() >= 0.5;
  const match = {
    id: matchId,
    mode: "global",
    chess: new Chess(),
    createdAt: Date.now(),
    players: {
      w: whiteFirst ? playerA : playerB,
      b: whiteFirst ? playerB : playerA,
    },
  };

  activeChessMatchesById.set(matchId, match);
  activeChessMatchByPlayer.set(match.players.w.id, matchId);
  activeChessMatchByPlayer.set(match.players.b.id, matchId);
  persistChessState();

  await sendMatchUpdate(match, "Global chess match found.");
  await bot.telegram.sendMessage(match.players.w.chatId, makeMatchSummary(match));
  await bot.telegram.sendMessage(match.players.b.chatId, makeMatchSummary(match));
});

bot.command("leaveglobalchess", async (ctx) => {
  const playerId = Number(ctx.from?.id || 0);
  if (!playerId) {
    await ctx.reply("Could not identify your account.");
    return;
  }

  if (activeChessMatchByPlayer.has(playerId)) {
    await ctx.reply("You are in an active match. Use /resign if you want to leave it.");
    return;
  }

  if (!globalChessQueue.includes(playerId)) {
    await ctx.reply("You are not currently in the global queue.");
    return;
  }

  removeFromGlobalQueue(playerId);
  globalChessPlayerContext.delete(playerId);
  persistChessState();
  await ctx.reply("You left the global chess queue.");
});

bot.command("chessboard", async (ctx) => {
  const playerId = Number(ctx.from?.id || 0);
  const matchId = activeChessMatchByPlayer.get(playerId);
  if (!matchId) {
    await ctx.reply("You are not in an active multiplayer chess match.");
    return;
  }

  const match = activeChessMatchesById.get(matchId);
  if (!match) {
    activeChessMatchByPlayer.delete(playerId);
    await ctx.reply("Match state was missing. Please start a new match.");
    return;
  }

  await sendMatchUpdate(match, "Current board.");
});

bot.command("move", async (ctx) => {
  const playerId = Number(ctx.from?.id || 0);
  const matchId = activeChessMatchByPlayer.get(playerId);
  if (!matchId) {
    await ctx.reply("You are not in an active multiplayer chess match.");
    return;
  }

  const match = activeChessMatchesById.get(matchId);
  if (!match) {
    activeChessMatchByPlayer.delete(playerId);
    await ctx.reply("Match state was missing. Please start a new match.");
    return;
  }

  const playerColor = colorForPlayer(match, playerId);
  if (!playerColor) {
    await ctx.reply("You are not a player in this match.");
    return;
  }

  if (match.chess.turn() !== playerColor) {
    await ctx.reply(`Not your turn. It is ${turnLabel(match.chess.turn())} to move.`);
    return;
  }

  const payload = String(ctx.message?.text || "").replace("/move", "").trim();
  const parsed = parseMoveInput(payload);
  if (!parsed) {
    await ctx.reply("Invalid move format. Use /move e2e4 or /move e2 e4");
    return;
  }

  const movingPiece = match.chess.get(parsed.from);
  if (!movingPiece || movingPiece.color !== playerColor) {
    await ctx.reply(`No ${turnLabel(playerColor)} piece found on ${parsed.from}.`);
    return;
  }

  const moveResult = match.chess.move({
    from: parsed.from,
    to: parsed.to,
    promotion: "q",
  });
  if (!moveResult) {
    await ctx.reply(`Illegal move: ${parsed.from}${parsed.to}`);
    return;
  }

  persistChessState();

  if (match.chess.isCheckmate()) {
    const winnerColor = moveResult.color;
    const winner = playerForColor(match, winnerColor);
    await sendMatchUpdate(match, `Checkmate. Winner: ${userDisplayName(winner)}`);
    finalizeMatchResult(match, "win", winnerColor);
    endChessMatch(match.id);
    return;
  }

  if (match.chess.isDraw()) {
    await sendMatchUpdate(match, "Game drawn.");
    finalizeMatchResult(match, "draw");
    endChessMatch(match.id);
    return;
  }

  await sendMatchUpdate(
    match,
    `${userDisplayName(ctx.from)} played ${parsed.from}${parsed.to}.`,
  );
});

bot.command("resign", async (ctx) => {
  const playerId = Number(ctx.from?.id || 0);
  const matchId = activeChessMatchByPlayer.get(playerId);
  if (!matchId) {
    await ctx.reply("You are not in an active multiplayer chess match.");
    return;
  }

  const match = activeChessMatchesById.get(matchId);
  if (!match) {
    activeChessMatchByPlayer.delete(playerId);
    await ctx.reply("Match state was missing. Please start a new match.");
    return;
  }

  const playerColor = colorForPlayer(match, playerId);
  if (!playerColor) {
    await ctx.reply("You are not a player in this match.");
    return;
  }

  const winnerColor = playerColor === "w" ? "b" : "w";
  const winner = playerForColor(match, winnerColor);
  await sendMatchUpdate(match, `${userDisplayName(ctx.from)} resigned. Winner: ${userDisplayName(winner)}`);
  finalizeMatchResult(match, "win", winnerColor);
  endChessMatch(match.id);
});

bot.action(/chess_accept\|(-?\d+)/, async (ctx) => {
  const chatId = Number(ctx.match[1]);
  const pending = pendingGroupChessChallengeByChat.get(chatId);
  if (!pending) {
    await ctx.answerCbQuery("No pending challenge.", { show_alert: true });
    return;
  }

  const actorId = Number(ctx.from?.id || 0);
  if (actorId !== pending.challenged.id) {
    await ctx.answerCbQuery("Only challenged player can accept.", { show_alert: true });
    return;
  }

  if (activeChessMatchByPlayer.has(pending.challenger.id) || activeChessMatchByPlayer.has(pending.challenged.id)) {
    pendingGroupChessChallengeByChat.delete(chatId);
    persistChessState();
    await ctx.answerCbQuery("Challenge expired.", { show_alert: true });
    await bot.telegram.sendMessage(chatId, "Challenge canceled because one player is already in a match.");
    return;
  }

  pendingGroupChessChallengeByChat.delete(chatId);
  const matchId = generateMatchId();
  const match = {
    id: matchId,
    mode: "group",
    chatId,
    chess: new Chess(),
    createdAt: Date.now(),
    players: {
      w: pending.challenger,
      b: pending.challenged,
    },
  };

  activeChessMatchesById.set(matchId, match);
  activeChessMatchByPlayer.set(pending.challenger.id, matchId);
  activeChessMatchByPlayer.set(pending.challenged.id, matchId);
  persistChessState();

  await ctx.answerCbQuery("Challenge accepted.");
  await sendMatchUpdate(match, "Group chess started.");
});

bot.action(/chess_refresh\|(m[a-z0-9]+)/, async (ctx) => {
  const matchId = ctx.match[1];
  const match = activeChessMatchesById.get(matchId);
  if (!match) {
    await ctx.answerCbQuery("Match not found.", { show_alert: true });
    return;
  }

  const actorId = Number(ctx.from?.id || 0);
  if (!colorForPlayer(match, actorId)) {
    await ctx.answerCbQuery("Only match players can refresh.", { show_alert: true });
    return;
  }

  await ctx.answerCbQuery("Board refreshed.");
  await sendMatchUpdate(match, "Current board.");
});

bot.action(/chess_resign\|(m[a-z0-9]+)/, async (ctx) => {
  const matchId = ctx.match[1];
  const match = activeChessMatchesById.get(matchId);
  if (!match) {
    await ctx.answerCbQuery("Match not found.", { show_alert: true });
    return;
  }

  const actorId = Number(ctx.from?.id || 0);
  const playerColor = colorForPlayer(match, actorId);
  if (!playerColor) {
    await ctx.answerCbQuery("Only match players can resign.", { show_alert: true });
    return;
  }

  const winnerColor = playerColor === "w" ? "b" : "w";
  const winner = playerForColor(match, winnerColor);
  await ctx.answerCbQuery("You resigned.");
  await sendMatchUpdate(match, `${userDisplayName(ctx.from)} resigned. Winner: ${userDisplayName(winner)}`);
  finalizeMatchResult(match, "win", winnerColor);
  endChessMatch(match.id);
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
        const game = String(payload.game || "unknown").toLowerCase();
        const mode = String(payload.mode || "mini-app").toLowerCase();
        const score = Number(payload.score || 0);
        const outcome = String(payload.outcome || "draw").toLowerCase();

        addGameResult(ctx.from, {
          game,
          mode,
          score,
          outcome,
        });

        const summary = game === "chess"
          ? `${ctx.from.first_name} submitted chess result: ${outcome} (${mode}).`
          : `${ctx.from.first_name} submitted ${game} score: ${score} (${mode}).`;
        await ctx.reply(
          `${summary}\nGame Leaderboard:\n${renderGameLeaderboard()}`,
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
  loadChessState();
  startContentServer();

  await bot.telegram.setMyCommands([
    { command: "quiz", description: "Ask quiz question" },
    { command: "flashcard", description: "Show flashcard" },
    { command: "newcard", description: "Create flashcard in private chat" },
    { command: "newquiz", description: "Create quiz in private chat" },
    { command: "playgame", description: "Open game hub" },
    { command: "chessgroup", description: "Challenge user in group chess" },
    { command: "acceptchess", description: "Accept pending group chess challenge" },
    { command: "globalchess", description: "Join global chess matchmaking" },
    { command: "leaveglobalchess", description: "Leave global chess queue" },
    { command: "move", description: "Play multiplayer chess move" },
    { command: "chessboard", description: "Show active multiplayer chess board" },
    { command: "resign", description: "Resign active chess match" },
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
