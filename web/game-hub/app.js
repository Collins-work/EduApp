const tg = window.Telegram?.WebApp;
if (tg) {
    tg.ready();
    tg.expand();
}

const games = [
    { id: "chess", title: "Chess Rush", description: "Play a full board game against a bot right inside Telegram." },
    { id: "cards", title: "Cards Sprint", description: "Deal quick hands and beat the bot in-card totals." },
    { id: "trivia", title: "Trivia Reflex", description: "Memorize a color sequence and replay it." },
    { id: "strategy", title: "Strategy Builder", description: "Split budget across economy, defense, and tech." },
];

const pieceMap = {
    wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔",
    bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚",
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
const gameStage = document.getElementById("game-stage");
const actionPrimary = document.getElementById("action-primary");
const actionSecondary = document.getElementById("action-secondary");
const playPanel = document.querySelector(".play-panel");
const chessPanel = document.getElementById("chess-panel");
const chessBoardEl = document.getElementById("chess-board");
const newChessGameBtn = document.getElementById("new-chess-game");

let activeGameId = "";
let gameScore = 0;
let chess = null;
let selectedSquare = "";
const cardById = new Map();

let memorySeq = [];
let memoryInput = [];
let strategyState = { econ: 5, defense: 5, tech: 5, budget: 15 };

function setStatus(message) {
    statusText.textContent = message;
}

function updateScoreInput() {
    scoreInput.value = String(gameScore);
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function squareColor(fileIndex, rankIndex) {
    return (fileIndex + rankIndex) % 2 === 0 ? "dark" : "light";
}

function makeSquare(fileIndex, rankIndex) {
    return `${files[fileIndex]}${8 - rankIndex}`;
}

function renderChessBoard() {
    if (!chess || !chessBoardEl) {
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
        selectedSquare = piece && piece.color === "w" ? square : "";
        renderChessBoard();
        return;
    }

    selectedSquare = "";
    gameScore += attempted.captured ? 3 : 1;
    updateScoreInput();
    playBotMove();
    renderChessBoard();
    setStatus("Chess move made.");
}

function startChessGame() {
    if (typeof window.Chess !== "function") {
        setStatus("Chess engine failed to load. Re-open mini app.");
        return false;
    }

    chess = new window.Chess();
    selectedSquare = "";
    gameScore = 0;
    updateScoreInput();
    renderChessBoard();
    setStatus("Chess started. You are White.");
    return true;
}

function suit() {
    return ["♠", "♥", "♦", "♣"][randomInt(0, 3)];
}

function rankLabel(value) {
    if (value === 1) return "A";
    if (value === 11) return "J";
    if (value === 12) return "Q";
    if (value === 13) return "K";
    return String(value);
}

function makeHand() {
    return Array.from({ length: 3 }, () => ({ value: randomInt(1, 13), suit: suit() }));
}

function renderCardsBoard(userHand, botHand) {
    const userSum = userHand.reduce((sum, c) => sum + c.value, 0);
    const botSum = botHand.reduce((sum, c) => sum + c.value, 0);

    gameStage.innerHTML = `
    <div class="cards-board">
      <p class="muted">Your hand</p>
      <div class="hand-row">${userHand.map((c) => `<div class="mini-card">${rankLabel(c.value)}${c.suit}</div>`).join("")}</div>
      <p class="muted">Bot hand</p>
      <div class="hand-row">${botHand.map((c) => `<div class="mini-card dim">${rankLabel(c.value)}${c.suit}</div>`).join("")}</div>
      <p class="muted">You: ${userSum} vs Bot: ${botSum}</p>
    </div>
  `;

    if (userSum > botSum) {
        gameScore += 5;
        setStatus("You win the hand. +5 points.");
    } else if (userSum === botSum) {
        gameScore += 2;
        setStatus("Draw hand. +2 points.");
    } else {
        setStatus("Bot wins this hand.");
    }
    updateScoreInput();
}

function startCardsRound() {
    const userHand = makeHand();
    const botHand = makeHand();
    renderCardsBoard(userHand, botHand);
}

function randomSeq(length = 4) {
    const keys = ["r", "g", "b", "y"];
    return Array.from({ length }, () => keys[randomInt(0, keys.length - 1)]);
}

function renderMemoryBoard(showSequence) {
    gameStage.innerHTML = `
    <div class="memory-board">
      <p class="muted">Memorize and replay the color sequence.</p>
      <div id="memory-seq" class="memory-seq"></div>
      <div id="memory-input" class="memory-input"></div>
    </div>
  `;

    const seqRoot = document.getElementById("memory-seq");
    const inputRoot = document.getElementById("memory-input");

    if (showSequence) {
        memorySeq.forEach((key) => {
            const dot = document.createElement("div");
            dot.className = `dot ${key}`;
            seqRoot.appendChild(dot);
        });
    } else {
        seqRoot.innerHTML = '<p class="muted">Sequence hidden. Tap colors below.</p>';
    }

    ["r", "g", "b", "y"].forEach((key) => {
        const btn = document.createElement("button");
        btn.className = `dot-btn dot ${key}`;
        btn.addEventListener("click", () => {
            memoryInput.push(key);
            if (memoryInput.length === memorySeq.length) {
                const ok = memoryInput.every((v, i) => v === memorySeq[i]);
                if (ok) {
                    gameScore += 6;
                    setStatus("Correct sequence. +6 points.");
                } else {
                    setStatus("Wrong sequence. Try again.");
                }
                updateScoreInput();
            }
        });
        inputRoot.appendChild(btn);
    });
}

function startTriviaRound() {
    memorySeq = randomSeq(4);
    memoryInput = [];
    renderMemoryBoard(true);
    setStatus("Memorize now...");
    setTimeout(() => {
        renderMemoryBoard(false);
        setStatus("Now replay the sequence.");
    }, 1500);
}

function clampStrategy() {
    const total = strategyState.econ + strategyState.defense + strategyState.tech;
    if (total <= strategyState.budget) {
        return;
    }
    const overflow = total - strategyState.budget;
    strategyState.tech = Math.max(0, strategyState.tech - overflow);
}

function renderStrategyBoard() {
    gameStage.innerHTML = `
    <div class="strategy-board">
      <p class="budget">Budget: ${strategyState.budget} points</p>
      <div class="alloc">
        <label>Economy: <span id="econ-val">${strategyState.econ}</span></label>
        <input id="econ" type="range" min="0" max="15" value="${strategyState.econ}" />
      </div>
      <div class="alloc">
        <label>Defense: <span id="def-val">${strategyState.defense}</span></label>
        <input id="def" type="range" min="0" max="15" value="${strategyState.defense}" />
      </div>
      <div class="alloc">
        <label>Tech: <span id="tech-val">${strategyState.tech}</span></label>
        <input id="tech" type="range" min="0" max="15" value="${strategyState.tech}" />
      </div>
    </div>
  `;

    const econ = document.getElementById("econ");
    const def = document.getElementById("def");
    const tech = document.getElementById("tech");

    function syncValues() {
        strategyState.econ = Number(econ.value);
        strategyState.defense = Number(def.value);
        strategyState.tech = Number(tech.value);
        clampStrategy();
        econ.value = String(strategyState.econ);
        def.value = String(strategyState.defense);
        tech.value = String(strategyState.tech);
        document.getElementById("econ-val").textContent = String(strategyState.econ);
        document.getElementById("def-val").textContent = String(strategyState.defense);
        document.getElementById("tech-val").textContent = String(strategyState.tech);
    }

    [econ, def, tech].forEach((el) => el.addEventListener("input", syncValues));
}

function runStrategyTurn() {
    const eventBonus = randomInt(-2, 3);
    const turnScore = strategyState.econ * 0.4 + strategyState.defense * 0.35 + strategyState.tech * 0.45 + eventBonus;
    const gained = Math.max(0, Math.round(turnScore));
    gameScore += gained;
    updateScoreInput();
    setStatus(`Turn completed. +${gained} points.`);
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

function configureActions() {
    if (activeGameId === "cards") {
        actionPrimary.textContent = "Deal Hand";
        actionSecondary.textContent = "Clear";
        actionPrimary.onclick = startCardsRound;
        actionSecondary.onclick = () => {
            gameStage.innerHTML = "";
            setStatus("Cards board cleared.");
        };
        return;
    }

    if (activeGameId === "trivia") {
        actionPrimary.textContent = "Start Sequence";
        actionSecondary.textContent = "Reset";
        actionPrimary.onclick = startTriviaRound;
        actionSecondary.onclick = () => {
            memorySeq = [];
            memoryInput = [];
            gameStage.innerHTML = "";
            setStatus("Sequence reset.");
        };
        return;
    }

    if (activeGameId === "strategy") {
        actionPrimary.textContent = "Run Turn";
        actionSecondary.textContent = "Reset Plan";
        actionPrimary.onclick = runStrategyTurn;
        actionSecondary.onclick = () => {
            strategyState = { econ: 5, defense: 5, tech: 5, budget: 15 };
            renderStrategyBoard();
            setStatus("Allocation reset.");
        };
        return;
    }

    actionPrimary.textContent = "Start";
    actionSecondary.textContent = "Reset";
    actionPrimary.onclick = null;
    actionSecondary.onclick = null;
}

function selectGame(gameId) {
    const selected = games.find((g) => g.id === gameId);
    if (!selected) {
        return false;
    }

    activeGameId = selected.id;
    gameScore = 0;
    updateScoreInput();
    activeGameTitle.textContent = selected.title;
    activeGameDescription.textContent = selected.description;
    markActiveCard();
    setModeForGame();

    if (activeGameId === "chess") {
        return startChessGame();
    }

    configureActions();
    if (activeGameId === "cards") {
        startCardsRound();
    } else if (activeGameId === "trivia") {
        startTriviaRound();
    } else if (activeGameId === "strategy") {
        renderStrategyBoard();
        setStatus("Adjust sliders, then run turn.");
    }

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
            selectGame(game.id);
        });
        listRoot.appendChild(card);
        cardById.set(game.id, card);
    });
}

newChessGameBtn.addEventListener("click", () => {
    if (activeGameId === "chess") {
        startChessGame();
    }
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
if (requestedGameId && games.some((g) => g.id === requestedGameId)) {
    const ok = selectGame(requestedGameId);
    if (ok) {
        setStatus(`Loaded ${requestedGameId} from bot command.`);
    }
} else {
    setStatus("Select a game card to start.");
}
