// src/services/catalogueService.js
const puppeteer = require("puppeteer");
const fetch = require("node-fetch");
const { PDFDocument } = require("pdf-lib");
const { 
  generateWelcomePage, 
  generateAboutPage, 
  generateTemplate1, 
  generateTemplate2, 
  generateBulkTemplate1,
  generateBulkTemplate2,
  generateCustomizationPage,
  generateContactPage,
  collectionNames
} = require("../../templates/catalogueTemplates");

// Global progress tracking for catalogue generation
// key: userId, value: { progress: number, currentAction: string }
const catalogueProgress = new Map();

// All static assets used across catalogue/bulk-catalogue templates.
const CATALOGUE_STATIC_URLS = [
  'https://res.cloudinary.com/dumkblp3v/raw/upload/v1770554569/papyrus_cwxj89.ttf',
  'https://res.cloudinary.com/dumkblp3v/raw/upload/v1770554592/NonOphelieDisplay-Regular-BF67107f6e3063a_aqqjn2.ttf',
  'https://res.cloudinary.com/dumkblp3v/image/upload/v1770548513/linesright_hk7t3j.svg',
  'https://res.cloudinary.com/dumkblp3v/image/upload/v1770548513/linesleft_gx8o8w.svg',
  'https://res.cloudinary.com/dumkblp3v/image/upload/v1770548487/candlestick_ljryjs.svg',
  'https://res.cloudinary.com/dumkblp3v/image/upload/v1770548513/lamp_svjx60.svg',
  'https://res.cloudinary.com/dumkblp3v/image/upload/v1770618965/Vector_iajl4o.svg',
  'https://res.cloudinary.com/dumkblp3v/image/upload/v1770548599/heroimage_ueotan.jpg',
  'https://res.cloudinary.com/dumkblp3v/image/upload/v1770548514/logo_wq2xws.svg',
  'https://res.cloudinary.com/dumkblp3v/image/upload/v1770548517/topcandle_mduuda.svg',
  'https://res.cloudinary.com/dumkblp3v/image/upload/v1770548487/bottomcandle_y5u5y5.svg',
  'https://res.cloudinary.com/dumkblp3v/image/upload/v1770548486/candlelogo_c3qvmb.svg',
  'https://res.cloudinary.com/dumkblp3v/image/upload/v1767176149/unnamed-7_j6fal6.webp',
];

// Map<originalCloudinaryUrl, base64DataUrl> — populated at startup
let catalogueAssetCache = new Map();

async function _fetchAsBase64(url) {
  try {
    const res = await fetch(url, {
      timeout: 30000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    let contentType = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
    if (url.endsWith('.svg') && !contentType.includes('svg')) contentType = 'image/svg+xml';
    if (url.endsWith('.ttf')) contentType = 'font/truetype';
    return `data:${contentType};base64,${Buffer.from(buffer).toString('base64')}`;
  } catch (err) {
    console.warn(`⚠️  Asset prefetch failed for ${url.split('/').pop()}: ${err.message} (Will attempt to auto-heal later)`);
    return null;
  }
}

async function prefetchCatalogueAssets() {
  console.log(`🖼️  Pre-fetching ${CATALOGUE_STATIC_URLS.length} catalogue assets...`);
  const results = await Promise.all(
    CATALOGUE_STATIC_URLS.map(async (url) => [url, await _fetchAsBase64(url)])
  );
  let successCount = 0;
  for (const [url, dataUrl] of results) {
    if (dataUrl) { catalogueAssetCache.set(url, dataUrl); successCount++; }
  }
  console.log(`✅  Catalogue assets ready: ${successCount}/${CATALOGUE_STATIC_URLS.length} inlined.`);
}

/**
 * Inline all known cached assets AND also inline any extra product image URLs
 * that were fetched on-demand.
 * 
 * [AUTO-HEALING]: If a core static asset is missing from the cache (e.g. failed at startup),
 * this function will attempt to fetch it on-demand before inlining.
 */
async function inlineCatalogueAssets(html, extraCache = new Map()) {
  let result = html;

  // 1. Handle Static Core Assets (fonts, logos, etc.)
  for (const url of CATALOGUE_STATIC_URLS) {
    let dataUrl = catalogueAssetCache.get(url);
    
    // Auto-heal: If missing, try to fetch it now
    if (!dataUrl) {
      console.log(`🔄 Auto-healing missing asset: ${url.split('/').pop()}`);
      dataUrl = await _fetchAsBase64(url);
      if (dataUrl) {
        catalogueAssetCache.set(url, dataUrl);
      }
    }

    if (dataUrl) {
      result = result.split(url).join(dataUrl);
    }
  }

  // 2. Handle Dynamic Product Images
  for (const [url, dataUrl] of extraCache) {
    result = result.split(url).join(dataUrl);
  }

  return result;
}

/**
 * Fast Optimization: Instead of downloading all images to Node.js as base64 (which can take minutes),
 * we inject Cloudinary transformation parameters to create optimized, lightweight URLs.
 * Puppeteer's native Chrome engine will then load these in parallel over HTTP/2, saving huge amounts of time.
 */
async function prefetchProductImages(products) {
  const cache = new Map();
  const optimizeCloudinaryUrl = (url) => {
    if (!url || !url.includes('cloudinary.com')) return url;
    if (url.includes('/upload/w_') || url.includes('/upload/q_')) return url;
    // High-quality but strongly optimized for A4 PDF layout memory
    const transformations = 'w_600,h_600,c_fill,f_auto,q_auto:good';
    return url.replace('/upload/', `/upload/${transformations}/`);
  };

  products.forEach(p => {
    if (p.imageUrl) {
      cache.set(p.imageUrl, optimizeCloudinaryUrl(p.imageUrl));
    }
  });

  // Return mapped URLs instantly, skipping all slow Node-side fetches
  return cache;
}

/**
 * Launch a puppeteer browser page with safe settings for PDF generation.
 * Uses domcontentloaded — all assets are pre-inlined so no network is needed.
 */
async function _launchBrowser() {
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: puppeteer.executablePath(),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--font-render-hinting=none",
    ],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);
  page.setDefaultNavigationTimeout(120000);

  // Block unnecessary external requests — allow base64 and Cloudinary fallback
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const rt = req.resourceType();
    const url = req.url();
    // Allow data base64 and cloudinary fallbacks!
    if (rt === 'document' || url.startsWith('data:') || url.includes('res.cloudinary.com')) {
      req.continue();
    } else {
      req.abort();
    }
  });

  return { browser, page };
}

// ------------------------------------------
// CATALOGUE HTML BUILDER (matches original logic exactly)
// ------------------------------------------

/**
 * Builds an ordered array of HTML page strings for the consumer catalogue.
 * - Products are grouped by category (using collectionNames for display)
 * - Full pages of 5 get the category heading
 * - Leftover (orphan) products are grouped together intelligently:
 *   same-category orphans are kept together, with the dominant category as label
 */
function buildCataloguePages(products) {
  const pages = [];

  console.log("📄 Adding welcome page...");
  pages.push(generateWelcomePage());

  console.log("📄 Adding about us page...");
  pages.push(generateAboutPage());

  // Group products by category
  const productsByCategory = {};
  products.forEach(p => {
    const cat = p.category || 'other';
    if (!productsByCategory[cat]) productsByCategory[cat] = [];
    productsByCategory[cat].push(p);
  });

  let templateToggle = true; // Start with template 1
  const orphanProducts = []; // Collect orphaned products

  // Generate pages for each category
  Object.keys(productsByCategory).forEach(category => {
    const categoryProducts = productsByCategory[category];
    const collectionTitle = collectionNames[category] || category.charAt(0).toUpperCase() + category.slice(1);

    const fullPages = Math.floor(categoryProducts.length / 5);
    const orphanCount = categoryProducts.length % 5;

    // Full pages get the category heading
    for (let i = 0; i < fullPages; i++) {
      const chunk = categoryProducts.slice(i * 5, (i + 1) * 5);
      const pageHtml = templateToggle
        ? generateTemplate1(chunk, collectionTitle)
        : generateTemplate2(chunk, collectionTitle);
      pages.push(pageHtml);
      templateToggle = !templateToggle;
    }

    // Collect orphan products with their category info
    if (orphanCount > 0) {
      const orphans = categoryProducts.slice(fullPages * 5);
      orphans.forEach(product => {
        orphanProducts.push({ product, category, collectionTitle });
      });
    }
  });

  // Process orphan products at the end
  if (orphanProducts.length > 0) {
    console.log(`📝 Processing ${orphanProducts.length} orphaned products...`);

    // Group orphans by category
    const orphansByCategory = {};
    orphanProducts.forEach(({ product, category, collectionTitle }) => {
      if (!orphansByCategory[category]) {
        orphansByCategory[category] = { products: [], collectionTitle };
      }
      orphansByCategory[category].products.push(product);
    });

    // Sort categories by count (descending) to prioritize larger groups
    const sortedOrphanCategories = Object.keys(orphansByCategory).sort(
      (a, b) => orphansByCategory[b].products.length - orphansByCategory[a].products.length
    );

    // Build pages — keep same-category orphans together
    const orphanPages = [];
    const remainingOrphans = {};
    sortedOrphanCategories.forEach(cat => {
      remainingOrphans[cat] = {
        products: [...orphansByCategory[cat].products],
        collectionTitle: orphansByCategory[cat].collectionTitle
      };
    });

    while (sortedOrphanCategories.some(cat => remainingOrphans[cat].products.length > 0)) {
      const currentPage = [];

      for (const category of sortedOrphanCategories) {
        if (!remainingOrphans[category] || remainingOrphans[category].products.length === 0) continue;

        const needed = 5 - currentPage.length;
        const toTake = Math.min(remainingOrphans[category].products.length, needed);

        for (let i = 0; i < toTake; i++) {
          currentPage.push({
            product: remainingOrphans[category].products.shift(),
            category,
            collectionTitle: remainingOrphans[category].collectionTitle
          });
        }

        if (currentPage.length === 5) break;
      }

      // Count products per category on THIS page directly for accuracy
      const pageCatCounts = {};
      currentPage.forEach(item => {
        pageCatCounts[item.category] = (pageCatCounts[item.category] || 0) + 1;
      });

      // Pick the category with the most products on this page as the label
      let pageLabel = currentPage[0]?.collectionTitle || 'Our Collection';
      let maxCount = 0;
      Object.entries(pageCatCounts).forEach(([cat, count]) => {
        if (count > maxCount) {
          maxCount = count;
          pageLabel = orphansByCategory[cat]?.collectionTitle || cat;
        }
      });

      orphanPages.push({
        products: currentPage.map(o => o.product),
        label: pageLabel
      });
    }

    orphanPages.forEach((pageData, idx) => {
      const pageHtml = templateToggle
        ? generateTemplate1(pageData.products, pageData.label)
        : generateTemplate2(pageData.products, pageData.label);
      pages.push(pageHtml);
      templateToggle = !templateToggle;
      console.log(`   Orphan Page ${idx + 1}: "${pageData.label}" (${pageData.products.length} products)`);
    });
  }

  console.log("📄 Adding customization page...");
  pages.push(generateCustomizationPage());

  console.log("📄 Adding contact page...");
  pages.push(generateContactPage());

  console.log(`📋 Total pages: ${pages.length}`);
  return pages;
}

/**
 * Builds an ordered array of HTML page strings for the bulk catalogue.
 */
function buildBulkCataloguePages(products) {
  const pages = [];

  console.log("📄 Adding welcome page...");
  pages.push(generateWelcomePage());

  console.log("📄 Adding about us page...");
  pages.push(generateAboutPage());

  let templateToggle = true;
  const orphanProducts = [];

  // Group products by category
  const productsByCategory = {};
  products.forEach(p => {
    const cat = p.category || 'bulk';
    if (!productsByCategory[cat]) productsByCategory[cat] = [];
    productsByCategory[cat].push(p);
  });

  Object.keys(productsByCategory).forEach(category => {
    const categoryProducts = productsByCategory[category];
    const collectionTitle = "Bulk"; // Fixed title for bulk catalogue

    const fullPages = Math.floor(categoryProducts.length / 5);
    const orphanCount = categoryProducts.length % 5;

    for (let i = 0; i < fullPages; i++) {
      const chunk = categoryProducts.slice(i * 5, (i + 1) * 5);
      const pageHtml = templateToggle
        ? generateBulkTemplate1(chunk, collectionTitle)
        : generateBulkTemplate2(chunk, collectionTitle);
      pages.push(pageHtml);
      templateToggle = !templateToggle;
    }

    if (orphanCount > 0) {
      const orphans = categoryProducts.slice(fullPages * 5);
      orphans.forEach(product => {
        orphanProducts.push({ product, category, collectionTitle });
      });
    }
  });

  // Process orphan bulk products
  if (orphanProducts.length > 0) {
    console.log(`📝 Processing ${orphanProducts.length} orphaned bulk products...`);
    const currentPage = [];
    orphanProducts.forEach(({ product }) => {
      currentPage.push(product);
      if (currentPage.length === 5) {
        const pageHtml = templateToggle
          ? generateBulkTemplate1([...currentPage], "Bulk")
          : generateBulkTemplate2([...currentPage], "Bulk");
        pages.push(pageHtml);
        templateToggle = !templateToggle;
        currentPage.length = 0;
      }
    });
    if (currentPage.length > 0) {
      const pageHtml = templateToggle
        ? generateBulkTemplate1(currentPage, "Bulk")
        : generateBulkTemplate2(currentPage, "Bulk");
      pages.push(pageHtml);
    }
  }

  console.log("📄 Adding customization page...");
  pages.push(generateCustomizationPage());

  console.log("📄 Adding contact page...");
  pages.push(generateContactPage());

  console.log(`📋 Total bulk pages: ${pages.length}`);
  return pages;
}

// ------------------------------------------
// PDF RENDERING ENGINE
// ------------------------------------------

/**
 * Renders an array of HTML strings through Puppeteer and merges into one PDF.
 */
async function renderPagesToPdf(htmlPages, productImageCache, userId, progressStart = 20, progressEnd = 95) {
  const { browser, page } = await _launchBrowser();
  const pdfDocs = [];
  const total = htmlPages.length;

  try {
    for (let i = 0; i < total; i++) {
      const progress = progressStart + Math.round((i / total) * (progressEnd - progressStart));
      if (userId) catalogueProgress.set(userId, { progress, currentAction: `Rendering page ${i + 1} of ${total}...` });

      const inlined = await inlineCatalogueAssets(htmlPages[i], productImageCache);
      
      // 'load' ensures Puppeteer waits for all Cloudinary image <img src=".."> tags to fully download natively
      await page.setContent(inlined, { waitUntil: 'load' });
      await new Promise(r => setTimeout(r, 100)); // tiny 100ms render buffer for layout settling
      
      pdfDocs.push(await page.pdf({ format: "A4", printBackground: true }));
    }
  } finally {
    await browser.close();
  }

  if (userId) catalogueProgress.set(userId, { progress: progressEnd, currentAction: "Merging document..." });

  const mergedPdf = await PDFDocument.create();
  for (const pdfBytes of pdfDocs) {
    const doc = await PDFDocument.load(pdfBytes);
    const copiedPages = await mergedPdf.copyPages(doc, doc.getPageIndices());
    copiedPages.forEach(p => mergedPdf.addPage(p));
  }

  if (userId) catalogueProgress.delete(userId);
  return await mergedPdf.save();
}

/**
 * Real-time PDF generation engine for consumer catalogues.
 */
async function generateMultiPageCatalogue(products, userId) {
  if (userId) catalogueProgress.set(userId, { progress: 5, currentAction: "Initializing catalogue..." });

  if (userId) catalogueProgress.set(userId, { progress: 8, currentAction: "Fetching product images..." });
  const productImageCache = await prefetchProductImages(products);

  if (userId) catalogueProgress.set(userId, { progress: 15, currentAction: "Building page structure..." });
  const htmlPages = buildCataloguePages(products);

  return renderPagesToPdf(htmlPages, productImageCache, userId);
}

/**
 * Real-time PDF generation engine for bulk/wholesale catalogues.
 */
async function generateMultiPageBulkCatalogue(products, userId) {
  if (userId) catalogueProgress.set(userId, { progress: 5, currentAction: "Initializing bulk catalogue..." });

  if (userId) catalogueProgress.set(userId, { progress: 8, currentAction: "Fetching product images..." });
  const productImageCache = await prefetchProductImages(products);

  if (userId) catalogueProgress.set(userId, { progress: 15, currentAction: "Building page structure..." });
  const htmlPages = buildBulkCataloguePages(products);

  return renderPagesToPdf(htmlPages, productImageCache, userId);
}

module.exports = {
  catalogueProgress,
  prefetchCatalogueAssets,
  generateMultiPageCatalogue,
  generateMultiPageBulkCatalogue,
};
