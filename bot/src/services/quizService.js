const { readJson, writeJson } = require("./storage");
const { isFlexibleMatch } = require("../utils/fuzzy");

const LEADERBOARD_FILE = "leaderboard.json";
const FLASHCARDS_FILE = "flashcards.json";
const QUIZZES_FILE = "quizzes.json";

function listFlashcards() {
  return readJson(FLASHCARDS_FILE, []);
}

function addFlashcard(question, answer) {
  const cards = listFlashcards();
  cards.push({ question, answer });
  writeJson(FLASHCARDS_FILE, cards);
  return cards[cards.length - 1];
}

function listQuizzes() {
  return readJson(QUIZZES_FILE, []);
}

function addQuiz(question, answer) {
  const quizzes = listQuizzes();
  const [primary, ...rest] = answer
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);

  quizzes.push({
    question,
    answer: primary || "",
    synonyms: rest,
    choices: [],
  });

  writeJson(QUIZZES_FILE, quizzes);
  return quizzes[quizzes.length - 1];
}

function evaluateAnswer(quiz, userAnswer) {
  const validAnswers = [quiz.answer, ...(quiz.synonyms || [])].filter(Boolean);

  if (!validAnswers.length) {
    return false;
  }

  if (Array.isArray(quiz.choices) && quiz.choices.length > 0) {
    const letterMap = ["a", "b", "c", "d", "e", "f"];
    const answerIndex = quiz.choices.findIndex(
      (choice) => choice.toLowerCase().trim() === quiz.answer.toLowerCase().trim(),
    );
    if (answerIndex >= 0) {
      validAnswers.push(letterMap[answerIndex]);
      validAnswers.push(letterMap[answerIndex].toUpperCase());
      validAnswers.push(`${answerIndex + 1}`);
    }
  }

  return isFlexibleMatch(userAnswer, validAnswers);
}

function getLeaderboard() {
  return readJson(LEADERBOARD_FILE, { users: {} });
}

function resetLeaderboard() {
  writeJson(LEADERBOARD_FILE, { users: {} });
}

function addScore(user, scoreToAdd = 1) {
  const board = getLeaderboard();
  const id = String(user.id);

  if (!board.users[id]) {
    board.users[id] = {
      id: user.id,
      username: user.username || "",
      firstName: user.first_name || "Player",
      score: 0,
    };
  }

  board.users[id].username = user.username || board.users[id].username;
  board.users[id].firstName = user.first_name || board.users[id].firstName;
  board.users[id].score += scoreToAdd;

  writeJson(LEADERBOARD_FILE, board);
  return board.users[id];
}

function renderLeaderboard(limit = 10) {
  const board = getLeaderboard();
  const rows = Object.values(board.users)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry, index) => {
      const displayName = entry.username ? `@${entry.username}` : entry.firstName;
      return `${index + 1}. ${displayName}: ${entry.score}`;
    });

  if (!rows.length) {
    return "No scores yet.";
  }

  return rows.join("\n");
}

module.exports = {
  addFlashcard,
  addQuiz,
  addScore,
  evaluateAnswer,
  listFlashcards,
  listQuizzes,
  renderLeaderboard,
  resetLeaderboard,
};
