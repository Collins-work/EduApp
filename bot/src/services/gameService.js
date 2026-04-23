const { readJson, writeJson } = require("./storage");

const GAMES_FILE = "games.json";
const GAME_LEADERBOARD_FILE = "gameLeaderboard.json";

function normalizeKey(input, fallback = "unknown") {
    const cleaned = String(input || "").toLowerCase().trim().replace(/\s+/g, "-");
    return cleaned || fallback;
}

function listGames() {
    return readJson(GAMES_FILE, []);
}

function addGame(name, url) {
    const key = normalizeKey(name);
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
    const key = normalizeKey(name);
    const games = listGames();
    const before = games.length;
    const filtered = games.filter((game) => game.name !== key && game.title.toLowerCase() !== String(name).toLowerCase());

    if (filtered.length === before) {
        return false;
    }

    writeJson(GAMES_FILE, filtered);
    return true;
}

function findGame(name) {
    const key = normalizeKey(name);
    return listGames().find((game) => game.name === key || game.title.toLowerCase() === String(name).toLowerCase()) || null;
}

function getGameLeaderboard() {
    return readJson(GAME_LEADERBOARD_FILE, { users: {} });
}

function resetGameLeaderboard() {
    writeJson(GAME_LEADERBOARD_FILE, { users: {} });
}

function migrateLegacyBoard(board) {
    if (!board || typeof board !== "object" || !board.users || typeof board.users !== "object") {
        return { users: {} };
    }

    Object.keys(board.users).forEach((id) => {
        const entry = board.users[id] || {};
        if (entry.totals && entry.games) {
            return;
        }

        const legacyScore = Number(entry.score || 0);
        board.users[id] = {
            id: entry.id || Number(id),
            username: entry.username || "",
            firstName: entry.firstName || "Player",
            totals: {
                points: legacyScore,
                wins: 0,
                losses: 0,
                draws: 0,
                plays: legacyScore > 0 ? 1 : 0,
            },
            games: {
                "legacy:points": {
                    game: "legacy",
                    mode: "points",
                    type: "points",
                    points: legacyScore,
                    wins: 0,
                    losses: 0,
                    draws: 0,
                    plays: legacyScore > 0 ? 1 : 0,
                },
            },
        };
    });

    return board;
}

function ensureUser(board, user) {
    const id = String(user.id);
    if (!board.users[id]) {
        board.users[id] = {
            id: user.id,
            username: user.username || "",
            firstName: user.first_name || "Player",
            totals: {
                points: 0,
                wins: 0,
                losses: 0,
                draws: 0,
                plays: 0,
            },
            games: {},
        };
    }

    const entry = board.users[id];
    entry.username = user.username || entry.username;
    entry.firstName = user.first_name || entry.firstName;
    entry.totals = entry.totals || { points: 0, wins: 0, losses: 0, draws: 0, plays: 0 };
    entry.games = entry.games || {};
    return entry;
}

function ensureGameRecord(userEntry, game, mode, type) {
    const gameKey = normalizeKey(game, "unknown");
    const modeKey = normalizeKey(mode, "default");
    const compositeKey = `${gameKey}:${modeKey}`;

    if (!userEntry.games[compositeKey]) {
        userEntry.games[compositeKey] = {
            game: gameKey,
            mode: modeKey,
            type,
            points: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            plays: 0,
        };
    }

    return userEntry.games[compositeKey];
}

function addGameResult(user, result = {}) {
    const board = migrateLegacyBoard(getGameLeaderboard());
    const userEntry = ensureUser(board, user);

    const game = normalizeKey(result.game, "unknown");
    const mode = normalizeKey(result.mode, "default");
    const score = Number(result.score || 0);
    const outcome = normalizeKey(result.outcome, "none");
    const type = game === "chess" ? "record" : "points";

    const gameRecord = ensureGameRecord(userEntry, game, mode, type);
    gameRecord.plays += 1;
    userEntry.totals.plays += 1;

    if (type === "record") {
        if (outcome === "win") {
            gameRecord.wins += 1;
            userEntry.totals.wins += 1;
        } else if (outcome === "loss") {
            gameRecord.losses += 1;
            userEntry.totals.losses += 1;
        } else {
            gameRecord.draws += 1;
            userEntry.totals.draws += 1;
        }
    } else {
        gameRecord.points += score;
        userEntry.totals.points += score;
    }

    writeJson(GAME_LEADERBOARD_FILE, board);
    return gameRecord;
}

function addGameScore(user, scoreToAdd = 1) {
    return addGameResult(user, {
        game: "legacy",
        mode: "points",
        score: Number(scoreToAdd || 0),
    });
}

function renderGameLeaderboard(limit = 10) {
    const board = migrateLegacyBoard(getGameLeaderboard());
    const entries = Object.values(board.users);
    if (!entries.length) {
        return "No game scores yet.";
    }

    const pointsRows = entries
        .slice()
        .sort((a, b) => (b.totals?.points || 0) - (a.totals?.points || 0))
        .slice(0, limit)
        .map((entry, index) => {
            const displayName = entry.username ? `@${entry.username}` : entry.firstName;
            return `${index + 1}. ${displayName}: ${entry.totals?.points || 0} pts`;
        });

    const chessRows = entries
        .filter((entry) => Object.values(entry.games || {}).some((record) => record.game === "chess"))
        .slice()
        .sort((a, b) => {
            const aWins = a.totals?.wins || 0;
            const bWins = b.totals?.wins || 0;
            if (bWins !== aWins) {
                return bWins - aWins;
            }
            return (a.totals?.losses || 0) - (b.totals?.losses || 0);
        })
        .slice(0, limit)
        .map((entry, index) => {
            const displayName = entry.username ? `@${entry.username}` : entry.firstName;
            const wins = entry.totals?.wins || 0;
            const losses = entry.totals?.losses || 0;
            const draws = entry.totals?.draws || 0;
            return `${index + 1}. ${displayName}: W${wins} L${losses} D${draws}`;
        });

    const lines = ["Points Leaderboard:"];
    lines.push(...(pointsRows.length ? pointsRows : ["No points games yet."]));
    lines.push("", "Chess Record Leaderboard:");
    lines.push(...(chessRows.length ? chessRows : ["No chess records yet."]));

    return lines.join("\n");
}

module.exports = {
    addGame,
    addGameResult,
    addGameScore,
    findGame,
    getGameLeaderboard,
    listGames,
    removeGame,
    renderGameLeaderboard,
    resetGameLeaderboard,
};
