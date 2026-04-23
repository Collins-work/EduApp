const tg = window.Telegram?.WebApp;
if (tg) {
    tg.ready();
    tg.expand();
}

const games = [
    {
        id: "chess",
        title: "Chess Rush",
        description: "Solve short tactical choices.",
    },
    {
        id: "cards",
        title: "Cards Sprint",
        description: "Spot the strongest hand quickly.",
    },
    {
        id: "trivia",
        title: "Trivia Battle",
        description: "Pick the correct answer under pressure.",
    },
    {
        id: "strategy",
        title: "Strategy Builder",
        description: "Choose the best resource move.",
    },
];

const roundsByGame = {
    chess: [
        {
            prompt: "White to move: what wins material fastest?",
            options: ["Develop a knight", "Take the hanging queen", "Castle short", "Push a pawn"],
            correctIndex: 1,
            points: 6,
            explain: "Taking the free queen is the highest-value tactical move.",
        },
        {
            prompt: "You can force checkmate in one. Best move?",
            options: ["Deliver check immediately", "Trade queens", "Defend a pawn", "Retreat bishop"],
            correctIndex: 0,
            points: 6,
            explain: "When mate is available, calculate and finish it.",
        },
    ],
    cards: [
        {
            prompt: "Which poker hand ranks highest?",
            options: ["Straight", "Three of a kind", "Flush", "Full house"],
            correctIndex: 3,
            points: 5,
            explain: "Full house outranks a flush and straight.",
        },
        {
            prompt: "Quick count: your cards are 9, 7, and 5. Total?",
            options: ["19", "20", "21", "22"],
            correctIndex: 2,
            points: 4,
            explain: "9 + 7 + 5 = 21.",
        },
    ],
    trivia: [
        {
            prompt: "Which planet is called the Red Planet?",
            options: ["Venus", "Mars", "Jupiter", "Mercury"],
            correctIndex: 1,
            points: 4,
            explain: "Mars is known as the Red Planet.",
        },
        {
            prompt: "What is the capital of France?",
            options: ["Paris", "Lyon", "Marseille", "Nice"],
            correctIndex: 0,
            points: 4,
            explain: "Paris is the capital city of France.",
        },
    ],
    strategy: [
        {
            prompt: "You have 10 resources. Best split for growth + defense?",
            options: ["10 offense, 0 economy", "8 economy, 2 defense", "5 economy, 5 defense", "0 economy, 10 defense"],
            correctIndex: 2,
            points: 5,
            explain: "Balanced investment usually survives while scaling.",
        },
        {
            prompt: "Enemy is stronger now. Best short-term decision?",
            options: ["All-out attack", "Scout then defend", "Ignore and expand", "Sell all defense"],
            correctIndex: 1,
            points: 5,
            explain: "Scouting plus defense keeps options open.",
        },
    ],
};

const params = new URLSearchParams(window.location.search);
const requestedGameId = String(params.get("game") || "").toLowerCase().trim();

const listRoot = document.getElementById("game-list");
const scoreInput = document.getElementById("score-input");
const submitBtn = document.getElementById("submit-game-score");
const statusText = document.getElementById("status");
const activeGameTitle = document.getElementById("active-game-title");
const activeGameDescription = document.getElementById("active-game-description");
const roundLabel = document.getElementById("round-label");
const gamePrompt = document.getElementById("game-prompt");
const optionsRoot = document.getElementById("game-options");
const nextRoundBtn = document.getElementById("next-round");

let activeGameId = "";
let roundIndex = 0;
let gameScore = 0;
let lockedRound = false;
const cardById = new Map();

function setStatus(message) {
    statusText.textContent = message;
}

function updateScoreInput() {
    scoreInput.value = String(gameScore);
}

function getRoundPool(gameId) {
    return roundsByGame[gameId] || [];
}

function getCurrentRound() {
    const pool = getRoundPool(activeGameId);
    if (!pool.length) {
        return null;
    }

    return pool[roundIndex % pool.length];
}

function renderRound() {
    const round = getCurrentRound();
    optionsRoot.innerHTML = "";

    if (!round) {
        roundLabel.textContent = "Round unavailable";
        gamePrompt.textContent = "This game has no configured rounds yet.";
        return;
    }

    roundLabel.textContent = `Round ${roundIndex + 1}`;
    gamePrompt.textContent = round.prompt;
    lockedRound = false;

    round.options.forEach((option, index) => {
        const button = document.createElement("button");
        button.className = "option-btn";
        button.textContent = option;

        button.addEventListener("click", () => {
            if (lockedRound) {
                return;
            }

            lockedRound = true;
            const correct = index === round.correctIndex;

            if (correct) {
                button.classList.add("correct");
                gameScore += round.points;
                updateScoreInput();
                setStatus(`Correct. +${round.points} points. ${round.explain}`);
            } else {
                button.classList.add("wrong");
                const allButtons = optionsRoot.querySelectorAll(".option-btn");
                if (allButtons[round.correctIndex]) {
                    allButtons[round.correctIndex].classList.add("correct");
                }
                setStatus(`Not correct. ${round.explain}`);
            }
        });

        optionsRoot.appendChild(button);
    });
}

function markActiveCard() {
    cardById.forEach((card, id) => {
        card.classList.toggle("active", id === activeGameId);
    });
}

function selectGame(gameId) {
    const selected = games.find((game) => game.id === gameId);
    if (!selected) {
        return;
    }

    activeGameId = selected.id;
    roundIndex = 0;
    gameScore = 0;
    updateScoreInput();

    activeGameTitle.textContent = selected.title;
    activeGameDescription.textContent = selected.description;
    markActiveCard();
    renderRound();
}

function buildGameCards() {
    games.forEach((game, index) => {
        const card = document.createElement("article");
        card.className = "card";
        card.style.animationDelay = `${index * 60}ms`;

        card.innerHTML = `
      <h2>${game.title}</h2>
      <p>${game.description}</p>
      <button class="btn">Play In Telegram</button>
    `;

        card.querySelector("button").addEventListener("click", () => selectGame(game.id));
        listRoot.appendChild(card);
        cardById.set(game.id, card);
    });
}

nextRoundBtn.addEventListener("click", () => {
    if (!activeGameId) {
        setStatus("Choose a game first.");
        return;
    }

    roundIndex += 1;
    renderRound();
    setStatus("New round ready.");
});

submitBtn.addEventListener("click", () => {
    const score = Number(scoreInput.value || 0);
    const payload = {
        type: "game_result",
        game: activeGameId || "unknown",
        score,
        sentAt: new Date().toISOString(),
    };

    if (tg) {
        tg.sendData(JSON.stringify(payload));
        tg.close();
        return;
    }

    setStatus("Open inside Telegram to submit game score.");
});

buildGameCards();
if (requestedGameId && games.some((game) => game.id === requestedGameId)) {
    selectGame(requestedGameId);
    setStatus(`Loaded ${requestedGameId} from bot command.`);
} else {
    setStatus("Select a game card to start playing.");
}
