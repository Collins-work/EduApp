const tg = window.Telegram?.WebApp;
if (tg) {
    tg.ready();
    tg.expand();
}

const fallbackContent = {
    flashcards: [
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
    ],
    quizzes: [
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
    ],
};

const apiSearch = new URLSearchParams(window.location.search);
const apiBase = normalizeApiBase(apiSearch.get("api") || window.EDU_APP_API_URL || "");

const flashQuestion = document.getElementById("flashcard-question");
const flashAnswer = document.getElementById("flashcard-answer");
const nextCardBtn = document.getElementById("next-card");
const showAnswerBtn = document.getElementById("show-answer");
const flashcardCount = document.getElementById("flashcard-count");

const quizQuestion = document.getElementById("quiz-question");
const quizChoices = document.getElementById("quiz-choices");
const answerInput = document.getElementById("answer-input");
const submitAnswerBtn = document.getElementById("submit-answer");
const newQuizBtn = document.getElementById("new-quiz");
const feedback = document.getElementById("quiz-feedback");
const quizCount = document.getElementById("quiz-count");
const sendResultsBtn = document.getElementById("send-results");

const newCardQuestion = document.getElementById("new-card-question");
const newCardAnswer = document.getElementById("new-card-answer");
const createFlashcardBtn = document.getElementById("create-flashcard");
const newQuizQuestion = document.getElementById("new-quiz-question");
const newQuizAnswer = document.getElementById("new-quiz-answer");
const newQuizSynonyms = document.getElementById("new-quiz-synonyms");
const createQuizBtn = document.getElementById("create-quiz");
const contentSource = document.getElementById("content-source");
const miniStatus = document.getElementById("mini-status");

let flashcards = [...fallbackContent.flashcards];
let quizzes = [...fallbackContent.quizzes];
let currentFlashcard = null;
let currentQuiz = null;
let quizScore = 0;
let quizTotal = 0;

function normalizeApiBase(value) {
    const raw = String(value || "").trim();
    if (!raw) {
        return "";
    }

    try {
        return new URL(raw, window.location.href).toString().replace(/\/$/, "");
    } catch (_error) {
        return raw.replace(/\/$/, "");
    }
}

function setMiniStatus(message, tone = "info") {
    miniStatus.textContent = message;
    miniStatus.dataset.tone = tone;
}

function pickRandom(list) {
    if (!Array.isArray(list) || !list.length) {
        return null;
    }

    return list[Math.floor(Math.random() * list.length)];
}

function normalizeText(value) {
    return String(value || "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ");
}

function updateCounters() {
    flashcardCount.textContent = String(flashcards.length);
    quizCount.textContent = String(quizzes.length);
}

function renderFlashcard() {
    currentFlashcard = pickRandom(flashcards);

    if (!currentFlashcard) {
        flashQuestion.textContent = "No flashcards available yet.";
        flashAnswer.textContent = "Create one below or sync the bot content.";
        flashAnswer.classList.remove("hidden");
        return;
    }

    flashQuestion.textContent = currentFlashcard.question;
    flashAnswer.textContent = currentFlashcard.answer;
    flashAnswer.classList.add("hidden");
}

function renderQuizChoices(quiz) {
    quizChoices.innerHTML = "";

    if (!quiz?.choices?.length) {
        quizChoices.innerHTML = '<div class="choice-pill">Type the answer directly.</div>';
        return;
    }

    const letters = ["A", "B", "C", "D", "E", "F"];
    quiz.choices.forEach((choice, index) => {
        const item = document.createElement("div");
        item.className = "choice-pill";
        item.textContent = `${letters[index] || index + 1}. ${choice}`;
        quizChoices.appendChild(item);
    });
}

function renderQuiz() {
    currentQuiz = pickRandom(quizzes);

    if (!currentQuiz) {
        quizQuestion.textContent = "No quizzes available yet.";
        quizChoices.innerHTML = '<div class="choice-pill">Create one below or sync the bot content.</div>';
        feedback.textContent = "";
        return;
    }

    quizQuestion.textContent = currentQuiz.question;
    renderQuizChoices(currentQuiz);
    answerInput.value = "";
    feedback.textContent = "";
}

function renderAll() {
    updateCounters();
    renderFlashcard();
    renderQuiz();
}

function checkAnswer(input) {
    if (!currentQuiz) {
        return false;
    }

    const normalizedInput = normalizeText(input);
    const allAnswers = [currentQuiz.answer, ...(currentQuiz.synonyms || [])].map(normalizeText);

    if (currentQuiz.choices?.length) {
        const letters = ["a", "b", "c", "d", "e", "f"];
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

function sendPayload(payload, successMessage) {
    if (tg) {
        tg.sendData(JSON.stringify(payload));
        tg.close();
        return;
    }

    setMiniStatus(successMessage || "Open this page inside Telegram to send data.", "info");
}

async function loadContent() {
    if (!apiBase) {
        contentSource.textContent = "Demo fallback";
        setMiniStatus("Using bundled demo content until the bot API is connected.", "info");
        renderAll();
        return;
    }

    setMiniStatus("Loading live content from the bot...", "info");

    try {
        const response = await fetch(`${apiBase}/api/edu-content`, {
            headers: {
                Accept: "application/json",
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        flashcards = Array.isArray(data.flashcards) && data.flashcards.length ? data.flashcards : fallbackContent.flashcards;
        quizzes = Array.isArray(data.quizzes) && data.quizzes.length ? data.quizzes : fallbackContent.quizzes;
        contentSource.textContent = data.flashcards?.length || data.quizzes?.length ? "Live from bot" : "Demo fallback";
        setMiniStatus("Live bot content loaded.", "success");
    } catch (_error) {
        flashcards = [...fallbackContent.flashcards];
        quizzes = [...fallbackContent.quizzes];
        contentSource.textContent = "Demo fallback";
        setMiniStatus("Could not reach the bot API, so demo content is shown.", "error");
    }

    renderAll();
}

nextCardBtn.addEventListener("click", renderFlashcard);
showAnswerBtn.addEventListener("click", () => {
    flashAnswer.classList.remove("hidden");
});

newQuizBtn.addEventListener("click", renderQuiz);

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

createFlashcardBtn.addEventListener("click", () => {
    const question = newCardQuestion.value.trim();
    const answer = newCardAnswer.value.trim();

    if (!question || !answer) {
        setMiniStatus("Add both a question and an answer first.", "error");
        return;
    }

    sendPayload(
        {
            type: "create_flashcard",
            question,
            answer,
            sentAt: new Date().toISOString(),
        },
        "Open this page inside Telegram to save the flashcard to the bot.",
    );
});

createQuizBtn.addEventListener("click", () => {
    const question = newQuizQuestion.value.trim();
    const answer = newQuizAnswer.value.trim();
    const synonyms = newQuizSynonyms.value.trim();

    if (!question || !answer) {
        setMiniStatus("Add a quiz question and a correct answer first.", "error");
        return;
    }

    sendPayload(
        {
            type: "create_quiz",
            question,
            answer,
            synonyms,
            sentAt: new Date().toISOString(),
        },
        "Open this page inside Telegram to save the quiz to the bot.",
    );
});

sendResultsBtn.addEventListener("click", () => {
    sendPayload(
        {
            type: "quiz_result",
            score: quizScore,
            total: quizTotal,
            sentAt: new Date().toISOString(),
        },
        "Open this page inside Telegram to submit your quiz score.",
    );
});

loadContent();
