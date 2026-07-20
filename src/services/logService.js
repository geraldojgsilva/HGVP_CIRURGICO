const fs = require("fs/promises");
const logger = require("./logger");

async function readJsonLines(filePath, limit = 100) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_error) {
          return { raw: line };
        }
      })
      .reverse();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function summarizeErrors(entries) {
  const byMessage = {};
  for (const entry of entries) {
    const key = entry.error?.message || entry.message || "unknown";
    byMessage[key] = (byMessage[key] || 0) + 1;
  }

  return {
    total: entries.length,
    by_message: Object.entries(byMessage)
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count)
  };
}

async function getErrorLog(limit) {
  const entries = await readJsonLines(logger.errorLogPath, limit);
  return {
    file: logger.errorLogPath,
    summary: summarizeErrors(entries),
    data: entries
  };
}

module.exports = { getErrorLog };
