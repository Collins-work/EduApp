const tg = window.Telegram?.WebApp;
if (tg) {
    tg.ready();
    tg.expand();
}

const games = [
    {
        id: "chess",
        title: "Chess Rush",
        description: "Play a full board game against a bot right inside Telegram.",
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

const pieceMap = {
    wp: "♙",
    wn: "♘",
    wb: "♗",
    wr: "♖",
    wq: "♕",
    wk: "♔",
    bp: "♟",
    bn: "♞",
    bb: "♝",
    br: "♜",
    bq: "♛",
    bk: "♚",
};

const files = ["a", "b", "c", "d", "e", "f", "g", "h"];

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
const playPanel = document.querySelector(".play-panel");
const chessPanel = document.getElementById("chess-panel");
const chessBoardEl = document.getElementById("chess-board");
const newChessGameBtn = document.getElementById("new-chess-game");

let activeGameId = "";
let roundIndex = 0;
let gameScore = 0;
let lockedRound = false;
let chess = null;
let selectedSquare = "";
let chessReady = false;
const cardById = new Map();

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) {
            if (typeof window.Chess === "function") {
                resolve();
                return;
            }

            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(new Error(`Failed script: ${src}`)), { once: true });
            return;
        }

        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed script: ${src}`));
        document.head.appendChild(script);
    });
}

async function ensureChessEngine() {
    if (typeof window.Chess === "function") {
        return true;
    }

    const candidates = [
        "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/chess.min.js",
        "https://unpkg.com/chess.js@1.4.0/dist/chess.min.js",
    ];

    for (const src of candidates) {
        try {
            await loadScript(src);
            if (typeof window.Chess === "function") {
                return true;
            }
        } catch (_error) {
            // Try next CDN.
        }
    }

    return false;
}

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

function squareColor(fileIndex, rankIndex) {
    return (fileIndex + rankIndex) % 2 === 0 ? "dark" : "light";
}

function makeSquare(fileIndex, rankIndex) {
    return `${files[fileIndex]}${8 - rankIndex}`;
}

function renderChessBoard() {
    if (!chessBoardEl || !chess) {
        return;
    }

    chessBoardEl.innerHTML = "";

    for (let rank = 0; rank < 8; rank += 1) {
        for (let file = 0; file < 8; file += 1) {
            const square = makeSquare(file, rank);
            const piece = chess.get(square);
            const key = piece ? `${piece.color}${piece.type}` : "";

            const button = document.createElement("button");
            button.type = "button";
            button.className = `sq ${squareColor(file, rank)}`;
            if (selectedSquare === square) {
                button.classList.add("selected");
            }
            button.dataset.square = square;
            button.textContent = key ? pieceMap[key] : "";

            button.addEventListener("click", () => onSquareClick(square));
            chessBoardEl.appendChild(button);
        }
    }
}

function playBotMove() {
    if (!chess || chess.isGameOver() || chess.turn() !== "b") {
        return;
    }

    const moves = chess.moves({ verbose: true });
    if (!moves.length) {
        return;
    }

    const picked = moves[Math.floor(Math.random() * moves.length)];
    chess.move({ from: picked.from, to: picked.to, promotion: "q" });
}

function endStateMessage() {
    if (!chess) {
        return "";
    }

    if (chess.isCheckmate()) {
        return chess.turn() === "w" ? "Checkmate. Bot wins." : "Checkmate. You win!";
    }

    if (chess.isStalemate()) {
        return "Draw by stalemate.";
    }

    if (chess.isDraw()) {
        return "Draw.";
    }

    if (chess.isCheck()) {
        return chess.turn() === "w" ? "Your king is in check." : "Bot is in check.";
    }

    return "";
}

function onSquareClick(square) {
    if (!chess || chess.turn() !== "w" || chess.isGameOver()) {
        return;
    }

    const piece = chess.get(square);

    if (!selectedSquare) {
        if (piece && piece.color === "w") {
            selectedSquare = square;
            renderChessBoard();
        }
        return;
    }

    if (selectedSquare === square) {
        selectedSquare = "";
        renderChessBoard();
        return;
    }

    const attempted = chess.move({ from: selectedSquare, to: square, promotion: "q" });

    if (!attempted) {
        if (piece && piece.color === "w") {
            selectedSquare = square;
        } else {
            selectedSquare = "";
        }
        renderChessBoard();
        return;
    }

    selectedSquare = "";
    gameScore += 1;
    if (attempted.captured) {
        gameScore += 2;
    }
    updateScoreInput();

    playBotMove();
    renderChessBoard();

    const summary = endStateMessage() || "Move made. Keep playing.";
    setStatus(summary);
}

async function startChessGame() {
    chessReady = await ensureChessEngine();
    if (!chessReady || typeof window.Chess !== "function") {
        setStatus("Chess engine failed to load in Telegram WebView. Try re-opening the mini app.");
        return false;
    }

    chess = new window.Chess();
    selectedSquare = "";
    gameScore = 0;
    updateScoreInput();
    renderChessBoard();
    setStatus("Chess started. You play White.");
    return true;
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

function setModeForGame() {
    const isChess = activeGameId === "chess";
    playPanel.classList.toggle("hidden", isChess);
    chessPanel.classList.toggle("hidden", !isChess);

    if (requestedGameId) {
        document.body.classList.add("game-mode");
    }
}

async function selectGame(gameId) {
    const selected = games.find((game) => game.id === gameId);
    if (!selected) {
        return false;
    }

    activeGameId = selected.id;
    roundIndex = 0;
    gameScore = 0;
    updateScoreInput();

    activeGameTitle.textContent = selected.title;
    activeGameDescription.textContent = selected.description;

    setModeForGame();
    markActiveCard();

    if (selected.id === "chess") {
        return startChessGame();
    }

    renderRound();
    return true;
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

        card.querySelector("button").addEventListener("click", () => {
            void selectGame(game.id);
        });
        listRoot.appendChild(card);
        cardById.set(game.id, card);
    });
}

nextRoundBtn.addEventListener("click", () => {
    if (!activeGameId || activeGameId === "chess") {
        setStatus("Choose a non-chess game first.");
        return;
    }

    roundIndex += 1;
    renderRound();
    setStatus("New round ready.");
});

newChessGameBtn.addEventListener("click", () => {
    if (activeGameId !== "chess") {
        return;
    }

    void startChessGame();
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
    void selectGame(requestedGameId).then((ok) => {
        if (ok) {
            setStatus(`Loaded ${requestedGameId} from bot command.`);
        }
    });
} else {
    setStatus("Select a game card to start playing.");
}
