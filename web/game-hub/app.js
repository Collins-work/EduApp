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
        description: "Beat the bot by reading the hand faster and picking the lead card.",
    },
    {
        id: "trivia",
        title: "Trivia Reflex",
        description: "Answer fast before the timer runs out.",
    },
    {
        id: "strategy",
        title: "Strategy Builder",
        description: "Split budget across economy, defense, and tech.",
    },
];

const pieceMap = {
    wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔",
    bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚",
};

const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
const triviaQuestions = [
    {
        question: "Which planet is called the Red Planet?",
        options: ["Venus", "Mars", "Jupiter", "Mercury"],
        answer: 1,
        points: 4,
        hint: "It is the fourth planet from the sun.",
    },
    {
        question: "What is the capital of France?",
        options: ["Paris", "Lyon", "Marseille", "Nice"],
        answer: 0,
        points: 4,
        hint: "It is also called the City of Light.",
    },
    {
        question: "Which gas do plants mostly absorb?",
        options: ["Oxygen", "Nitrogen", "Carbon dioxide", "Helium"],
        answer: 2,
        points: 4,
        hint: "It is the gas used in photosynthesis.",
    },
    {
        question: "What is 7 x 8?",
        options: ["54", "56", "58", "60"],
        answer: 1,
        points: 4,
        hint: "Think 7 groups of 8.",
    },
];

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
let selectedSquare = "";
let chessState = null;
let chessBotMoveTimer = null;
let chessBotThinking = false;
let chessResult = {
    mode: "vs-bot",
    outcome: "draw",
    finished: false,
};
let cardsState = null;
let triviaState = null;
let strategyState = { econ: 5, defense: 5, tech: 5, budget: 15 };
let strategyTurn = 0;
const cardById = new Map();
let triviaTimer = null;
let triviaDeadline = 0;

const chessPieceValue = {
    p: 1,
    n: 3,
    b: 3,
    r: 5,
    q: 9,
    k: 100,
};

function setStatus(message) {
    statusText.textContent = message;
}

function updateScoreInput() {
    scoreInput.value = String(gameScore);
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}

function hasChessEngine() {
    return typeof window.Chess === "function";
}

function squareColor(fileIndex, rankIndex) {
    return (fileIndex + rankIndex) % 2 === 0 ? "dark" : "light";
}

function makeSquare(fileIndex, rankIndex) {
    return `${files[fileIndex]}${8 - rankIndex}`;
}

function scoreMove(move) {
    const capturedScore = move.captured ? (chessPieceValue[move.captured] || 0) * 5 : 0;
    const promotionScore = move.promotion ? (chessPieceValue[move.promotion] || 0) * 2 : 0;
    const centerBonus = ["d4", "d5", "e4", "e5"].includes(move.to) ? 1 : 0;
    return capturedScore + promotionScore + centerBonus + randomInt(-1, 1);
}

function chooseChessBotMove() {
    const moves = chessState.engine.moves({ verbose: true });
    if (!moves.length) {
        return null;
    }

    let bestMove = moves[0];
    let bestScore = -Infinity;
    moves.forEach((move) => {
        let score = scoreMove(move);
        if (move.flags.includes("k") || move.flags.includes("q")) {
            score += 2;
        }

        chessState.engine.move({ from: move.from, to: move.to, promotion: "q" });
        if (chessState.engine.isCheckmate()) {
            score += 1000;
        } else if (chessState.engine.inCheck()) {
            score += 3;
        }
        chessState.engine.undo();

        if (score > bestScore) {
            bestScore = score;
            bestMove = move;
        }
    });

    return bestMove;
}

function clearChessBotTimer() {
    if (!chessBotMoveTimer) {
        return;
    }
    clearTimeout(chessBotMoveTimer);
    chessBotMoveTimer = null;
}

function finishChessResult(outcome, statusMessage) {
    chessResult.finished = true;
    chessResult.outcome = outcome;
    gameScore = outcome === "win" ? 1 : 0;
    updateScoreInput();
    setStatus(statusMessage);
}

function resolveChessGameState(afterBotMove = false) {
    if (!chessState) {
        return false;
    }

    if (chessState.engine.isCheckmate()) {
        const winner = chessState.engine.turn() === "w" ? "b" : "w";
        finishChessResult(
            winner === "w" ? "win" : "loss",
            winner === "w" ? "Checkmate. You win." : "Checkmate. Bot wins.",
        );
        return true;
    }

    if (chessState.engine.isStalemate()) {
        finishChessResult("draw", "Draw by stalemate.");
        return true;
    }

    if (chessState.engine.isInsufficientMaterial()) {
        finishChessResult("draw", "Draw by insufficient material.");
        return true;
    }

    if (chessState.engine.isThreefoldRepetition()) {
        finishChessResult("draw", "Draw by repetition.");
        return true;
    }

    if (chessState.engine.isDraw()) {
        finishChessResult("draw", "Draw.");
        return true;
    }

    if (chessState.engine.inCheck()) {
        if (afterBotMove) {
            setStatus("Your king is in check.");
        } else {
            setStatus("Bot king is in check.");
        }
        return false;
    }

    chessResult.finished = false;
    return false;
}

function scheduleChessBotMove() {
    clearChessBotTimer();
    chessBotThinking = true;
    renderChessBoard();

    const delayMs = randomInt(1200, 2600);
    chessBotMoveTimer = setTimeout(() => {
        chessBotMoveTimer = null;
        if (!chessState || chessState.engine.turn() !== "b" || chessResult.finished) {
            chessBotThinking = false;
            renderChessBoard();
            return;
        }

        const botMove = chooseChessBotMove();
        if (botMove) {
            chessState.engine.move({ from: botMove.from, to: botMove.to, promotion: "q" });
        }

        chessBotThinking = false;
        resolveChessGameState(true);
        renderChessBoard();
    }, delayMs);
}

function chessStatusText() {
    if (!chessState) {
        return "Chess not started.";
    }

    if (chessResult.finished) {
        return `Game over: ${chessResult.outcome}`;
    }

    if (chessState.engine.turn() === "b") {
        return chessBotThinking ? "Bot is thinking..." : "Bot is preparing a move...";
    }

    if (chessState.engine.inCheck()) {
        return "You are in check.";
    }
    return "Your move.";
}

function renderChessBoard() {
    if (!chessState || !chessBoardEl) {
        return;
    }

    chessBoardEl.innerHTML = "";
    const boardRows = chessState.engine.board();
    for (let rank = 0; rank < 8; rank += 1) {
        for (let file = 0; file < 8; file += 1) {
            const square = makeSquare(file, rank);
            const piece = boardRows[rank][file];
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

    setStatus(chessStatusText());
}

function onSquareClick(square) {
    if (!chessState || chessState.engine.turn() !== "w" || chessResult.finished || chessBotThinking) {
        return;
    }

    const piece = chessState.engine.get(square);
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

    const legalTargets = chessState.engine.moves({ square: selectedSquare, verbose: true }).map((move) => move.to);
    if (!legalTargets.includes(square)) {
        selectedSquare = piece && piece.color === "w" ? square : "";
        renderChessBoard();
        return;
    }

    chessState.engine.move({ from: selectedSquare, to: square, promotion: "q" });
    selectedSquare = "";

    if (resolveChessGameState(false)) {
        renderChessBoard();
        return;
    }

    scheduleChessBotMove();
}

function startChessGame() {
    if (!hasChessEngine()) {
        setStatus("Chess engine failed to load. Refresh the page.");
        return false;
    }

    clearChessBotTimer();
    chessState = {
        engine: new window.Chess(),
    };
    chessBotThinking = false;
    selectedSquare = "";
    chessResult = {
        mode: "vs-bot",
        outcome: "draw",
        finished: false,
    };
    gameScore = 0;
    updateScoreInput();
    renderChessBoard();
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
    return Array.from({ length: 4 }, () => ({ value: randomInt(1, 13), suit: suit() }));
}

function renderCardsBoard(userHand, botHand) {
    const userSum = userHand.reduce((sum, c) => sum + c.value, 0);
    const botSum = botHand.reduce((sum, c) => sum + c.value, 0);
    const lead = userSum - botSum;

    gameStage.innerHTML = `
    <div class="cards-board">
      <p class="muted">Rules: higher total wins. Tap Deal Hand to play another round.</p>
      <div class="hand-row">${userHand.map((c) => `<div class="mini-card">${rankLabel(c.value)}${c.suit}</div>`).join("")}</div>
      <p class="muted">Bot hand</p>
      <div class="hand-row">${botHand.map((c) => `<div class="mini-card dim">${rankLabel(c.value)}${c.suit}</div>`).join("")}</div>
      <p class="muted">Lead: ${lead > 0 ? "+" : ""}${lead}</p>
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
    cardsState = { userHand, botHand };
    renderCardsBoard(userHand, botHand);
}

function renderTriviaBoard(question, revealAnswer = false) {
    gameStage.innerHTML = `
    <div class="trivia-board">
      <p class="muted">Fast reflex round. Answer before the timer runs out.</p>
      <p class="budget">Time left: <span id="trivia-time">0</span>s</p>
      <div class="mini-card" style="min-height: 96px; font-size: 1rem; align-items: start; padding: 14px; text-align: left;">
        ${question.question}
      </div>
      <div class="options">
        ${question.options.map((option, index) => `<button class="option-btn" data-choice="${index}">${option}</button>`).join("")}
      </div>
      <p class="muted">Hint: ${question.hint}</p>
      ${revealAnswer ? `<p class="muted">Correct answer: ${question.options[question.answer]}</p>` : ""}
    </div>
  `;

    document.querySelectorAll("[data-choice]").forEach((button) => {
        button.addEventListener("click", () => handleTriviaChoice(Number(button.dataset.choice)));
    });
}

function startTriviaRound() {
    if (triviaTimer) {
        clearInterval(triviaTimer);
    }

    triviaState = {
        question: triviaQuestions[randomInt(0, triviaQuestions.length - 1)],
        locked: false,
    };

    triviaDeadline = Date.now() + 6000;
    renderTriviaBoard(triviaState.question, false);
    setStatus("Answer fast.");

    triviaTimer = setInterval(() => {
        const left = Math.max(0, Math.ceil((triviaDeadline - Date.now()) / 1000));
        const timerEl = document.getElementById("trivia-time");
        if (timerEl) {
            timerEl.textContent = String(left);
        }

        if (left <= 0) {
            clearInterval(triviaTimer);
            triviaTimer = null;
            if (!triviaState.locked) {
                triviaState.locked = true;
                gameScore = Math.max(0, gameScore - 1);
                updateScoreInput();
                renderTriviaBoard(triviaState.question, true);
                setStatus(`Time's up. -1 point. ${triviaState.question.options[triviaState.question.answer]} was correct.`);
            }
        }
    }, 200);
}

function handleTriviaChoice(choiceIndex) {
    if (!triviaState || triviaState.locked) {
        return;
    }

    triviaState.locked = true;
    if (triviaTimer) {
        clearInterval(triviaTimer);
        triviaTimer = null;
    }

    const correct = choiceIndex === triviaState.question.answer;
    if (correct) {
        gameScore += triviaState.question.points;
        updateScoreInput();
        renderTriviaBoard(triviaState.question, true);
        setStatus(`Correct. +${triviaState.question.points} points.`);
    } else {
        gameScore = Math.max(0, gameScore - 1);
        updateScoreInput();
        renderTriviaBoard(triviaState.question, true);
        setStatus(`Wrong. -1 point. ${triviaState.question.options[triviaState.question.answer]} was correct.`);
    }
}

function renderStrategyBoard() {
    gameStage.innerHTML = `
    <div class="strategy-board">
      <p class="budget">Budget: ${strategyState.budget} points</p>
      <p class="muted">Goal: survive pressure and grow the economy.</p>
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
      <div class="mini-card dim" id="strategy-readout" style="min-height: 64px; font-size: 0.95rem; text-align: left; padding: 12px;">
        Ready to run.
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
        const total = strategyState.econ + strategyState.defense + strategyState.tech;
        if (total > strategyState.budget) {
            const overflow = total - strategyState.budget;
            strategyState.tech = clamp(strategyState.tech - overflow, 0, 15);
        }
        econ.value = String(strategyState.econ);
        def.value = String(strategyState.defense);
        tech.value = String(strategyState.tech);
        document.getElementById("econ-val").textContent = String(strategyState.econ);
        document.getElementById("def-val").textContent = String(strategyState.defense);
        document.getElementById("tech-val").textContent = String(strategyState.tech);
        const readout = document.getElementById("strategy-readout");
        if (readout) {
            readout.textContent = `Balance now: economy ${strategyState.econ}, defense ${strategyState.defense}, tech ${strategyState.tech}.`;
        }
    }

    [econ, def, tech].forEach((el) => el.addEventListener("input", syncValues));
    syncValues();
}

function runStrategyTurn() {
    const pressure = 8 + strategyTurn * 2;
    const total = strategyState.econ + strategyState.defense + strategyState.tech;
    const growth = strategyState.econ * 0.7 + strategyState.tech * 0.6;
    const stability = strategyState.defense * 0.9;
    const score = Math.max(0, Math.round(growth + stability - pressure / 2 + randomInt(-1, 2)));

    gameScore += score;
    strategyTurn += 1;
    updateScoreInput();

    const readout = document.getElementById("strategy-readout");
    if (readout) {
        readout.textContent = `Pressure ${pressure}. Total allocation ${total}. Gained ${score} points this turn.`;
    }

    setStatus(`Strategy turn ${strategyTurn} completed. +${score} points.`);
}

function resetStrategy() {
    strategyState = { econ: 5, defense: 5, tech: 5, budget: 15 };
    strategyTurn = 0;
    renderStrategyBoard();
    setStatus("Strategy reset.");
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
        actionSecondary.textContent = "Explain";
        actionPrimary.onclick = startCardsRound;
        actionSecondary.onclick = () => setStatus("Each round deals four cards. Highest total wins.");
        return;
    }

    if (activeGameId === "trivia") {
        actionPrimary.textContent = "Start Reflex";
        actionSecondary.textContent = "Reset";
        actionPrimary.onclick = startTriviaRound;
        actionSecondary.onclick = () => {
            if (triviaTimer) {
                clearInterval(triviaTimer);
                triviaTimer = null;
            }
            triviaState = null;
            gameStage.innerHTML = '<p class="muted">Tap Start Reflex to begin.</p>';
            setStatus("Trivia reset.");
        };
        return;
    }

    if (activeGameId === "strategy") {
        actionPrimary.textContent = "Run Turn";
        actionSecondary.textContent = "Reset Plan";
        actionPrimary.onclick = runStrategyTurn;
        actionSecondary.onclick = resetStrategy;
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
        gameStage.innerHTML = '<p class="muted">Tap Start Reflex to begin.</p>';
        setStatus("Trivia is ready.");
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
