const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

const games = [
  {
    id: "chess",
    title: "Chess Rush",
    description: "Classic tactical board game.",
    url: "https://www.chess.com/play/computer",
  },
  {
    id: "cards",
    title: "Cards Sprint",
    description: "Fast card duel challenges.",
    url: "https://cardgames.io/",
  },
  {
    id: "trivia",
    title: "Trivia Battle",
    description: "Answer as many as possible under pressure.",
    url: "https://www.sporcle.com/",
  },
  {
    id: "strategy",
    title: "Resource Strategy",
    description: "Plan and optimize your economy.",
    url: "https://littlealchemy2.com/",
  },
];

const listRoot = document.getElementById("game-list");
const scoreInput = document.getElementById("score-input");
const submitBtn = document.getElementById("submit-game-score");
const statusText = document.getElementById("status");

function openGame(game) {
  if (tg) {
    tg.openLink(game.url);
  } else {
    window.open(game.url, "_blank", "noopener,noreferrer");
  }
}

games.forEach((game, index) => {
  const card = document.createElement("article");
  card.className = "card";
  card.style.animationDelay = `${index * 60}ms`;

  card.innerHTML = `
    <h2>${game.title}</h2>
    <p>${game.description}</p>
    <button class="btn">Launch</button>
  `;

  card.querySelector("button").addEventListener("click", () => openGame(game));
  listRoot.appendChild(card);
});

submitBtn.addEventListener("click", () => {
  const score = Number(scoreInput.value || 0);
  const payload = {
    type: "game_result",
    score,
    sentAt: new Date().toISOString(),
  };

  if (tg) {
    tg.sendData(JSON.stringify(payload));
    tg.close();
    return;
  }

  statusText.textContent = "Open inside Telegram to submit game score.";
});
