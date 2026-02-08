const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Changes the cache location for Puppeteer.
  // Using a path relative to the project root for better reliability on Render
  cacheDirectory: join(__dirname, '.puppeteer-cache'),
};
