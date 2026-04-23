const { readJson, writeJson } = require("./storage");

const GAMES_FILE = "games.json";
const GAME_LEADERBOARD_FILE = "gameLeaderboard.json";

function listGames() {
    return readJson(GAMES_FILE, []);
}

function addGame(name, url) {
    const key = name.toLowerCase().trim().replace(/\s+/g, "-");
    const games = listGames();

    if (games.some((game) => game.name === key)) {
        return null;
    }

    const created = {
        name: key,
        title: name,
        url,
    };

    games.push(created);
    writeJson(GAMES_FILE, games);
    return created;
}

function removeGame(name) {
    const key = name.toLowerCase().trim().replace(/\s+/g, "-");
    const games = listGames();
    const before = games.length;
    const filtered = games.filter((game) => game.name !== key && game.title.toLowerCase() !== name.toLowerCase());

    if (filtered.length === before) {
        return false;
    }

    writeJson(GAMES_FILE, filtered);
    return true;
}

function findGame(name) {
    const key = name.toLowerCase().trim().replace(/\s+/g, "-");
    return listGames().find((game) => game.name === key || game.title.toLowerCase() === name.toLowerCase()) || null;
}

function getGameLeaderboard() {
    return readJson(GAME_LEADERBOARD_FILE, { users: {} });
}

function resetGameLeaderboard() {
    writeJson(GAME_LEADERBOARD_FILE, { users: {} });
}

function addGameScore(user, scoreToAdd = 1) {
    const board = getGameLeaderboard();
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

    writeJson(GAME_LEADERBOARD_FILE, board);
    return board.users[id];
}

function renderGameLeaderboard(limit = 10) {
    const board = getGameLeaderboard();
    const rows = Object.values(board.users)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((entry, index) => {
            const displayName = entry.username ? `@${entry.username}` : entry.firstName;
            return `${index + 1}. ${displayName}: ${entry.score}`;
        });

    if (!rows.length) {
        return "No game scores yet.";
    }

    return rows.join("\n");
}

module.exports = {
    addGame,
    addGameScore,
    findGame,
    listGames,
    removeGame,
    renderGameLeaderboard,
    resetGameLeaderboard,
};
