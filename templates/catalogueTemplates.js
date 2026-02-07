const fs = require('fs');
const path = require('path');

// Read and encode SVG assets as base64
const assetsPath = path.join(__dirname, 'assets');

const linesRightSvg = fs.readFileSync(path.join(assetsPath, 'linesright.svg'), 'utf8');
const linesLeftSvg = fs.readFileSync(path.join(assetsPath, 'linesleft.svg'), 'utf8');
const candlestickSvg = fs.readFileSync(path.join(assetsPath, 'candlestick.svg'), 'utf8');

// Convert SVG to base64 data URIs
const linesRightDataUri = `data:image/svg+xml;base64,${Buffer.from(linesRightSvg).toString('base64')}`;
const linesLeftDataUri = `data:image/svg+xml;base64,${Buffer.from(linesLeftSvg).toString('base64')}`;
const candlestickDataUri = `data:image/svg+xml;base64,${Buffer.from(candlestickSvg).toString('base64')}`;

// Collection name mapping
const collectionNames = {
  flower: "Flower",
  animal: "Animal",
  festive: "Festive",
  glassJar: "Glass Jar",
  special: "Special",
};

// Helper to optimize Cloudinary image URLs for PDF generation
const optimizeCloudinaryUrl = (url) => {
  if (!url || !url.includes('cloudinary.com')) return url;
  
  // Insert transformation parameters after /upload/
  // w_300,h_300 = resize to 300x300px
  // c_fill = crop to fill dimensions
  // f_auto = automatic format
  // q_auto:good = automatic quality (good balance)
  const transformations = 'w_300,h_300,c_fill,f_auto,q_auto:good';
  return url.replace('/upload/', `/upload/${transformations}/`);
};

// Helper to format product name with line break and dynamic font size
const formatProductName = (name) => {
  const formatted = name.replace(/ candles?/i, '<br>candles');
  // Calculate font size based on name length
  const baseLength = 20; // Expected average length
  const fontSize = name.length > baseLength ? Math.max(20, 30 - Math.floor((name.length - baseLength) / 3)) : 30;
  return { formatted, fontSize };
};

// Helper to build product description
const buildDescription = (product) => {
  const weight = product.weightGrams || '?';
  const burnTime = product.burnTimeHours || '?';
  return `| Natural Soy Wax |<br>Aromatherapy Candle | Perfect<br>for Home Decor & Gifting<br>(${weight}g - ${burnTime}hrs)`;
};

// Helper to build badge text
const buildBadge = (product) => {
  const pack = product.quantityPack || 1;
  const price = product.price || 0;
  return `Pack of ${pack} - ₹${price}/ + courier`;
};

// Template 1: Right-side decorative lines
function generateTemplate1(products, collectionTitle) {
  const productsHtml = products.slice(0, 5).map(p => {
    const { formatted: productName, fontSize } = formatProductName(p.name);
    const optimizedImageUrl = optimizeCloudinaryUrl(p.imageUrl);
    return `
    <div class="card">
      <div class="product-image-container">
        <img src="${optimizedImageUrl}" alt="${p.name}">
      </div>
      <h2 style="font-size: ${fontSize}px;">${productName}</h2>
      <div class="badge">${buildBadge(p)}</div>
      <div class="description">${buildDescription(p)}</div>
    </div>
  `;
  }).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cozy Catalogue - ${collectionTitle}</title>
  <style>
    :root {
      --bg-color: #FFC592;
      --card-bg: #4F3629;
      --badge-bg: #FFC727;
      --text-white: #ffffff;
      --text-dark: #000000;
    }
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      background-color: #e5e5e5;
      display: flex;
      justify-content: center;
      padding: 0;
      font-family: 'Non Ophelie Display Trial', serif;
    }
    .a4-page {
      width: 210mm;
      height: 297mm;
      background-color: var(--bg-color);
      position: relative;
      overflow: hidden;
      padding: 30px 40px;
      display: flex;
      flex-direction: column;
    }
    .decorative-lines {
      position: absolute;
      top: 0;
      right: 0;
      width: 500px;
      z-index: 1;
      pointer-events: none;
    }
    header {
      position: relative;
      z-index: 2;
      margin-bottom: 20px;
    }
    h1 {
      font-size: 48px;
      color: #4d372c;
      line-height: 1.1;
      font-weight: 400;
      margin-bottom: 8px;
    }
    .product-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      position: relative;
      z-index: 2;
      max-width: 900px;
      margin-top: 18px;
    }
    .product-grid .card:nth-child(1) { grid-column: 1 / 2; }
    .product-grid .card:nth-child(2) { grid-column: 2 / 3; }
    .product-grid .card:nth-child(3) { grid-column: 1 / 2; margin-top: 120px; }
    .product-grid .card:nth-child(4) { grid-column: 2 / 3; margin-top: 120px; }
    .product-grid .card:nth-child(5) { grid-column: 3 / 4; margin-top: 120px; }
    .card {
      background-color: var(--card-bg);
      border-radius: 40px;
      padding: 80px 8px 8px 8px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      color: var(--text-white);
      width: 100%;
      position: relative;
      margin-top: 100px;
    }
    .product-image-container {
      width: 85%;
      aspect-ratio: 1 / 1;
      background-color: #c8c0b4;
      border-radius: 20px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      position: absolute;
      top: -110px;
      left: 50%;
      transform: translateX(-50%);
      box-shadow: 0 4px 8px rgba(0,0,0,0.1);
    }
    .product-image-container img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .card h2 {
      font-size: 30px;
      line-height: 0.8;
      font-weight: 100;
      text-align: center;
      padding: 4px;
    }
    .badge {
      background-color: var(--badge-bg);
      color: var(--text-dark);
      padding: 8px;
      border-radius: 10px;
      font-weight: 100;
      font-size: 24px;
      line-height: 1;
      margin-bottom: 4px;
    }
    .description {
      font-size: 14px;
      line-height: 1.4;
      opacity: 0.6;
      padding: 4px 4px;
      font-family: 'Papyrus', fantasy, sans-serif;
    }
    .candlestick {
      position: absolute;
      right: 30px;
      top: 400px;
      width: 180px;
      z-index: 1;
    }
    footer {
      margin-top: 20px;
      text-align: center;
      padding-bottom: 15px;
    }
    .footer-text {
      font-family: 'Papyrus', fantasy, sans-serif;
      font-size: 20px;
      color: #4d372c;
      font-style: normal;
    }
  </style>
</head>
<body>
  <div class="a4-page">
    <img src="${linesRightDataUri}" alt="" class="decorative-lines">
    <header>
      <h1>Our ${collectionTitle}<br>Collection...</h1>
    </header>
    <main class="product-grid">
      ${productsHtml}
    </main>
    <img src="${candlestickDataUri}" alt="" class="candlestick">
    <footer>
      <div class="footer-text">Customization Available on All products</div>
    </footer>
  </div>
</body>
</html>
  `;
}

// Template 2: Left-side decorative lines
function generateTemplate2(products, collectionTitle) {
  const productsHtml = products.slice(0, 5).map(p => {
    const { formatted: productName, fontSize } = formatProductName(p.name);
    const optimizedImageUrl = optimizeCloudinaryUrl(p.imageUrl);
    return `
    <div class="card">
      <div class="product-image-container">
        <img src="${optimizedImageUrl}" alt="${p.name}">
      </div>
      <h2 style="font-size: ${fontSize}px;">${productName}</h2>
      <div class="badge">${buildBadge(p)}</div>
      <div class="description">${buildDescription(p)}</div>
    </div>
  `;
  }).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cozy Catalogue - ${collectionTitle}</title>
  <style>
    :root {
      --bg-color: #FFC592;
      --card-bg: #4F3629;
      --badge-bg: #FFC727;
      --text-white: #ffffff;
      --text-dark: #000000;
    }
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      background-color: #e5e5e5;
      display: flex;
      justify-content: center;
      padding: 0;
      font-family: 'Non Ophelie Display Trial', serif;
    }
    .a4-page {
      width: 210mm;
      height: 297mm;
      background-color: var(--bg-color);
      position: relative;
      overflow: hidden;
      padding: 30px 40px;
      display: flex;
      flex-direction: column;
    }
    .decorative-lines {
      position: absolute;
      top: 0;
      left: 0;
      width: 500px;
      z-index: 1;
      pointer-events: none;
    }
    header {
      position: relative;
      z-index: 2;
      margin-bottom: 30px;
      text-align: right;
    }
    h1 {
      font-size: 52px;
      color: #4d372c;
      line-height: 1.1;
      font-weight: 400;
      margin-bottom: 10px;
    }
    .product-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      position: relative;
      z-index: 2;
      max-width: 900px;
      margin-top: 18px;
      margin-left: auto;
    }
    .product-grid .card:nth-child(1) { grid-column: 2 / 3; }
    .product-grid .card:nth-child(2) { grid-column: 3 / 4; }
    .product-grid .card:nth-child(3) { grid-column: 1 / 2; margin-top: 120px; }
    .product-grid .card:nth-child(4) { grid-column: 2 / 3; margin-top: 120px; }
    .product-grid .card:nth-child(5) { grid-column: 3 / 4; margin-top: 120px; }
    .card {
      background-color: var(--card-bg);
      border-radius: 40px;
      padding: 80px 8px 8px 8px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      color: var(--text-white);
      width: 100%;
      position: relative;
      margin-top: 100px;
    }
    .product-image-container {
      width: 85%;
      aspect-ratio: 1 / 1;
      background-color: #c8c0b4;
      border-radius: 20px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      position: absolute;
      top: -110px;
      left: 50%;
      transform: translateX(-50%);
      box-shadow: 0 4px 8px rgba(0,0,0,0.1);
    }
    .product-image-container img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .card h2 {
      font-size: 30px;
      line-height: 0.8;
      font-weight: 100;
      text-align: center;
      padding: 4px;
    }
    .badge {
      background-color: var(--badge-bg);
      color: var(--text-dark);
      padding: 8px;
      border-radius: 10px;
      font-weight: 100;
      font-size: 24px;
      line-height: 1;
      margin-bottom: 4px;
    }
    .description {
      font-size: 14px;
      line-height: 1.4;
      opacity: 0.6;
      padding: 4px 4px;
      font-family: 'Papyrus', fantasy, sans-serif;
    }
    .candlestick {
      position: absolute;
      left: 30px;
      top: 400px;
      width: 180px;
      z-index: 1;
    }
    footer {
      margin-top: 20px;
      text-align: center;
      padding-bottom: 15px;
    }
    .footer-text {
      font-family: 'Papyrus', fantasy, sans-serif;
      font-size: 20px;
      color: #4d372c;
      font-style: normal;
    }
  </style>
</head>
<body>
  <div class="a4-page">
    <img src="${linesLeftDataUri}" alt="" class="decorative-lines">
    <header>
      <h1>Our ${collectionTitle}<br>Collection...</h1>
    </header>
    <main class="product-grid">
      ${productsHtml}
    </main>
    <img src="${candlestickDataUri}" alt="" class="candlestick">
    <footer>
      <div class="footer-text">Customization Available on All products</div>
    </footer>
  </div>
</body>
</html>
  `;
}

module.exports = {
  generateTemplate1,
  generateTemplate2,
  collectionNames
};
