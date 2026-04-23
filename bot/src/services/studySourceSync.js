const fs = require("fs");
const path = require("path");
const { writeJson } = require("./storage");

function loadSourceText(sourcePath) {
    if (!sourcePath) {
        return null;
    }

    const resolvedPath = path.isAbsolute(sourcePath) ? sourcePath : path.join(process.cwd(), sourcePath);
    if (!fs.existsSync(resolvedPath)) {
        return null;
    }

    return fs.readFileSync(resolvedPath, "utf8");
}

function parseStudyText(text) {
    const flashcards = [];
    const quizzes = [];

    const lines = String(text || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    for (const line of lines) {
        const normalized = line.replace(/^[-*•]\s*/, "");
        const flashcardMatch = normalized.match(/^card\s*[:\-]\s*(.+?)\s*[|;]\s*(.+)$/i);
        const quizMatch = normalized.match(/^quiz\s*[:\-]\s*(.+?)\s*[|;]\s*(.+)$/i);

        if (flashcardMatch) {
            flashcards.push({ question: flashcardMatch[1].trim(), answer: flashcardMatch[2].trim() });
            continue;
        }

        if (quizMatch) {
            const [answer, ...synonyms] = quizMatch[2]
                .split(";")
                .map((item) => item.trim())
                .filter(Boolean);

            quizzes.push({
                question: quizMatch[1].trim(),
                answer: answer || "",
                synonyms,
                choices: [],
            });
        }
    }

    return { flashcards, quizzes };
}

function syncStudySource(sourcePath) {
    const text = loadSourceText(sourcePath);
    if (!text) {
        return { synced: false, reason: "No source file found." };
    }

    const { flashcards, quizzes } = parseStudyText(text);
    if (!flashcards.length && !quizzes.length) {
        return { synced: false, reason: "No flashcards or quizzes found in source text." };
    }

    if (flashcards.length) {
        writeJson("flashcards.json", flashcards);
    }

    if (quizzes.length) {
        writeJson("quizzes.json", quizzes);
    }

    return {
        synced: true,
        flashcards: flashcards.length,
        quizzes: quizzes.length,
    };
}

module.exports = {
    parseStudyText,
    syncStudySource,
};
