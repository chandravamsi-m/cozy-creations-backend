const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Use local cache only if explicitly set (like on Render via dashboard)
  // This prevents local development from being forced into the .puppeteer-cache folder
  cacheDirectory: process.env.PUPPETEER_CACHE_DIR 
    ? (process.env.PUPPETEER_CACHE_DIR.startsWith('/') || process.env.PUPPETEER_CACHE_DIR.includes(':') 
        ? process.env.PUPPETEER_CACHE_DIR 
        : join(__dirname, process.env.PUPPETEER_CACHE_DIR))
    : undefined,
};
