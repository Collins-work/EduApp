const fs = require("fs");
const path = require("path");

function resolvePath(relativePath) {
  return path.join(__dirname, "..", "..", "data", relativePath);
}

function readJson(relativePath, fallback) {
  const filePath = resolvePath(relativePath);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (typeof fallback !== "undefined") {
      return fallback;
    }
    throw error;
  }
}

function writeJson(relativePath, data) {
  const filePath = resolvePath(relativePath);
  const payload = JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, `${payload}\n`, "utf8");
}

module.exports = {
  readJson,
  writeJson,
};
