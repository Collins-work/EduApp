const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

const flashcards = [
  {
    question: "What is Newton's Second Law?",
    answer: "Force equals mass times acceleration (F = ma).",
  },
  {
    question: "What does DNA stand for?",
    answer: "Deoxyribonucleic acid.",
  },
  {
    question: "Derivative of x^2?",
    answer: "2x",
  },
];

const quizzes = [
  {
    question: "Which process turns liquid water into vapor?",
    answer: "evaporation",
    synonyms: ["vaporization"],
    choices: ["Condensation", "Evaporation", "Sublimation", "Precipitation"],
  },
  {
    question: "Who wrote 'Romeo and Juliet'?",
    answer: "william shakespeare",
    synonyms: ["shakespeare"],
    choices: ["Charles Dickens", "William Shakespeare", "Jane Austen", "Homer"],
  },
  {
    question: "What is 9 * 7?",
    answer: "63",
    synonyms: ["sixty three"],
    choices: ["56", "63", "72", "49"],
  },
];

let currentFlash = null;
let currentQuiz = null;
let quizScore = 0;
let quizTotal = 0;

const flashQuestion = document.getElementById("flashcard-question");
const flashAnswer = document.getElementById("flashcard-answer");
const nextCardBtn = document.getElementById("next-card");
const showAnswerBtn = document.getElementById("show-answer");

const quizQuestion = document.getElementById("quiz-question");
const quizChoices = document.getElementById("quiz-choices");
const answerInput = document.getElementById("answer-input");
const submitAnswerBtn = document.getElementById("submit-answer");
const newQuizBtn = document.getElementById("new-quiz");
const feedback = document.getElementById("quiz-feedback");
const sendResultsBtn = document.getElementById("send-results");

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
}

function loadFlashcard() {
  currentFlash = pickRandom(flashcards);
  flashQuestion.textContent = currentFlash.question;
  flashAnswer.textContent = currentFlash.answer;
  flashAnswer.classList.add("hidden");
}

function renderQuizChoices(quiz) {
  quizChoices.innerHTML = "";
  const letters = ["A", "B", "C", "D"];
  quiz.choices.forEach((choice, i) => {
    const item = document.createElement("div");
    item.className = "choice-pill";
    item.textContent = `${letters[i]}. ${choice}`;
    quizChoices.appendChild(item);
  });
}

function loadQuiz() {
  currentQuiz = pickRandom(quizzes);
  quizQuestion.textContent = currentQuiz.question;
  renderQuizChoices(currentQuiz);
  answerInput.value = "";
  feedback.textContent = "";
}

function checkAnswer(input) {
  const normalizedInput = normalizeText(input);
  const allAnswers = [currentQuiz.answer, ...(currentQuiz.synonyms || [])].map(normalizeText);

  if (currentQuiz.choices?.length) {
    const letters = ["a", "b", "c", "d"];
    const idx = currentQuiz.choices.findIndex(
      (choice) => normalizeText(choice) === normalizeText(currentQuiz.answer),
    );
    if (idx >= 0) {
      allAnswers.push(letters[idx]);
      allAnswers.push(String(idx + 1));
    }
  }

  return allAnswers.some((answer) => answer === normalizedInput || answer.includes(normalizedInput));
}

nextCardBtn.addEventListener("click", loadFlashcard);
showAnswerBtn.addEventListener("click", () => flashAnswer.classList.remove("hidden"));

newQuizBtn.addEventListener("click", loadQuiz);

submitAnswerBtn.addEventListener("click", () => {
  if (!currentQuiz) {
    return;
  }

  const answer = answerInput.value;
  if (!answer.trim()) {
    feedback.textContent = "Enter an answer first.";
    return;
  }

  quizTotal += 1;
  if (checkAnswer(answer)) {
    quizScore += 1;
    feedback.textContent = `Correct. Score: ${quizScore}/${quizTotal}`;
  } else {
    feedback.textContent = `Not correct. Answer: ${currentQuiz.answer}. Score: ${quizScore}/${quizTotal}`;
  }
});

sendResultsBtn.addEventListener("click", () => {
  const payload = {
    type: "quiz_result",
    score: quizScore,
    total: quizTotal,
    sentAt: new Date().toISOString(),
  };

  if (tg) {
    tg.sendData(JSON.stringify(payload));
    tg.close();
    return;
  }

  feedback.textContent = "Open this page inside Telegram to submit score to chat.";
});

loadFlashcard();
loadQuiz();
