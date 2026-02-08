// Collection name mapping
const collectionNames = {
  flower: "Flower",
  animal: "Animal",
  festive: "Festive",
  glassJar: "Glass Jar",
  special: "Special",
};

// Decorative Assets (Cloudinary URLs)
const linesRightUrl = "https://res.cloudinary.com/dumkblp3v/image/upload/v1770548513/linesright_hk7t3j.svg";
const linesLeftUrl = "https://res.cloudinary.com/dumkblp3v/image/upload/v1770548513/linesleft_gx8o8w.svg";
const candlestickUrl = "https://res.cloudinary.com/dumkblp3v/image/upload/v1770548487/candlestick_ljryjs.svg";
const lampUrl = "https://res.cloudinary.com/dumkblp3v/image/upload/v1770548513/lamp_svjx60.svg";

// Common Font Styles for PDF embedding (Cloudinary-hosted)
const fontStyles = `
  @font-face {
    font-family: 'Papyrus';
    src: url('https://res.cloudinary.com/dumkblp3v/raw/upload/v1770554569/papyrus_cwxj89.ttf') format('truetype');
    font-display: block;
    font-weight: normal;
    font-style: normal;
  }
  @font-face {
    font-family: 'Non Ophelie Display Trial';
    src: url('https://res.cloudinary.com/dumkblp3v/raw/upload/v1770554592/NonOphelieDisplay-Regular-BF67107f6e3063a_aqqjn2.ttf') format('truetype');
    font-display: block;
    font-weight: normal;
    font-style: normal;
  }
  .font-load-trigger {
    position: absolute;
    top: -9999px;
    left: -9999px;
    visibility: hidden;
  }
`;

const fontForceLoadHtml = `
  <div class="font-load-trigger" style="font-family: 'Papyrus';">a</div>
  <div class="font-load-trigger" style="font-family: 'Non Ophelie Display Trial';">a</div>
`;

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

// Welcome Page (index3) - First page of catalogue
function generateWelcomePage() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cozy Creations - Welcome</title>
  <style>
    ${fontStyles}
    :root {
      --bg-color: #FFC592;
      --text-dark: #4F3629;
      --text-black: #000000;
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
      font-family: 'Papyrus', fantasy, sans-serif;
    }
    .a4-page {
      width: 210mm;
      height: 297mm;
      background-color: var(--bg-color);
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .hero-section {
      width: 100%;
      height: 65%;
      position: relative;
      background-color: #dcc8b1;
      background-image: url('https://res.cloudinary.com/dumkblp3v/image/upload/v1770548599/heroimage_ueotan.jpg');
      background-size: cover;
    }
    .logo {
      position: absolute;
      width: 300px;
      height: auto;
      z-index: 5;
    }
    .info-section {
      width: 100%;
      height: 35%;
      background-color: var(--bg-color);
      position: relative;
      padding: 32px 40px 40px 32px;
      display: flex;
      align-items: flex-start;
      justify-content: flex-start;
    }
    .welcome-text {
      font-size: 24px;
      color: var(--text-dark);
      line-height: 1.6;
      letter-spacing: 2px;
      max-width: 550px;
      z-index: 2;
      text-align: left;
    }
    .large-lamp {
      position: absolute;
      bottom: -40px;
      right: 0px;
      width: 180px;
      height: 640px;
      z-index: 3;
    }
  </style>
</head>
<body>
  ${fontForceLoadHtml}
  <div class="a4-page">
    <div class="hero-section">
      <img src="https://res.cloudinary.com/dumkblp3v/image/upload/v1770548514/logo_wq2xws.svg" alt="Cozy Creations Logo" class="logo">
      <div class="hero-overlay-text">
      </div>
    </div>

    <div class="info-section">
      <div class="welcome-text">
        Welcome to Cozy Creations—hand-poured soy and gel candles made with premium, chemical-free fragrances.
        Beautiful, fragrant, and budget-friendly—crafted to brighten every space.
      </div>
      <img src="${lampUrl}" alt="Decorative Lamp" class="large-lamp">
    </div>
  </div>
</body>
</html>
  `;
}

// About Us Page (index4) - Second page of catalogue
function generateAboutPage() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cozy Creations - About Us</title>
  <style>
    ${fontStyles}
    :root {
      --bg-color: #FFC592;
      --card-bg: #4F3629;
      --text-dark: #4F3629;
      --text-black: #000000;
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
      font-family: 'Papyrus', fantasy, sans-serif;
    }
    .a4-page {
      width: 210mm;
      height: 297mm;
      background-color: var(--bg-color);
      position: relative;
      overflow: hidden;
      padding: 40px 50px;
      display: flex;
      flex-direction: column;
    }
    .decorative-lines {
      position: absolute;
      top: -20px;
      left: -20px;
      width: 600px;
      z-index: 1;
      pointer-events: none;
      opacity: 0.8;
    }
    .content-columns {
      display: grid;
      grid-template-columns: 0.9fr 1.1fr;
      gap: 30px;
      position: relative;
      z-index: 2;
      margin-top: 50px;
      flex-grow: 1;
    }
    .column {
      display: flex;
      flex-direction: column;
    }
    .image-with-shadow {
      position: relative;
      width: 220px;
      margin-bottom: 40px;
    }
    .shadow-box {
      position: absolute;
      width: 220px;
      height: 280px;
      background-color: var(--card-bg);
      top: 30px;
      right: -35px;
      z-index: 1;
    }
    .main-img {
      position: relative;
      z-index: 2;
      width: 220px;
      height: 280px;
    }
    .left-text-content p {
      font-size: 19px;
      color: var(--text-dark);
      line-height: 1.5;
      margin-bottom: 20px;
      text-align: left;
    }
    .final-tagline {
      margin-top: 20px;
      font-weight: normal;
    }
    .title-area {
      margin-bottom: 10px;
    }
    .about-title {
      font-size: 60px;
      font-family: 'Non Ophelie Display Trial';
      color: #3d2b22;
      font-weight: 400;
      line-height: 1;
      display: flex;
      align-items: center;
      margin-top: -20px;
      gap: 15px;
    }
    .about-icon {
      width: 45px;
      height: auto;
    }
    .subtitle {
      font-size: 19px;
      color: var(--text-dark);
      line-height: 1.4;
      margin-top: 28px;
      margin-bottom: 20px;
    }
    .right-text-content {
      margin-bottom: 30px;
    }
    .story-text p,
    .story-text-2 p {
      font-size: 20px;
      color: var(--text-dark);
      line-height: 1.4;
      margin-bottom: 28px;
      text-align: left;
    }
    .bottom-image-container {
      margin-top: -20px;
      width: 100%;
    }
    .bottom-img {
      width: 100%;
      height: 300px;
      display: block;
    }
    .bottom-candlestick {
      position: absolute;
      bottom: 20px;
      left: 20px;
      width: 80px;
      height: auto;
      z-index: 10;
    }
    footer {
      margin-top: auto;
      text-align: center;
      padding-bottom: 10px;
    }
    .footer-text {
      font-size: 22px;
      color: #3d2b22;
      line-height: 1;
    }
  </style>
</head>
<body>
  ${fontForceLoadHtml}
  <div class="a4-page">
    <img src="${linesLeftUrl}" alt="" class="decorative-lines">

    <div class="content-columns">
      <div class="column left-col">
        <div class="image-with-shadow">
          <div class="shadow-box"></div>
          <img src="https://res.cloudinary.com/dumkblp3v/image/upload/v1770548517/topcandle_mduuda.svg" alt="Cozy Candle Jar" class="main-img">
        </div>

        <div class="left-text-content">
          <p>Whether shared as a heartfelt gift, nestled inside a thoughtfully curated hamper, or paired with blossoming
            flowers, each creation carries a promise: to ease the soul, brighten the heart, and elevate every moment.
          </p>

          <p>For your home, your celebrations, and your quiet evenings of unwinding—Cozy Creations brings a soft glow, a
            tender ambiance, and a touch of mindful comfort. Where every flame tells a story.</p>

          <p>Where every scent sings a lullaby of peace. Where gifting meets relaxation, and every flicker invites you
            to feel at ease.</p>

          <p class="final-tagline">Cozy Creations—Crafted with love. Designed for calm. Made to make hearts happy.</p>
        </div>
      </div>

      <div class="column right-col">
        <div class="title-area">
          <h1 class="about-title">About us <img src="https://res.cloudinary.com/dumkblp3v/image/upload/v1770548486/candlelogo_c3qvmb.svg" alt="" class="about-icon"></h1>
          <p class="subtitle">"Cozy Creations: For Happy Hearts, One Scent at a Time "</p>
        </div>

        <div class="right-text-content">
          <div class="story-text">
            <p>Cozy Creations began when Nancy, a devoted homemaker with a passion for creativity, found a moment of
              quiet amidst life's busyness. In that stillness, her love for crafting comforting experiences took
              shape—and a
              brand dedicated to warmth and well-being was born.</p>
          </div>

          <div class="story-text-2">
            <p>At Cozy Creations, our candles are more than fragrances. They are gentle whispers of calm—reminders to
              pause, breathe, and truly be present. Every candle is carefully handcrafted as a small escape, designed to
              wrap your surroundings in soothing light and serene aroma.</p>
          </div>
        </div>

        <div class="bottom-image-container">
          <img src="https://res.cloudinary.com/dumkblp3v/image/upload/v1770548487/bottomcandle_y5u5y5.svg" alt="Lighting a candle" class="bottom-img">
        </div>
      </div>
    </div>

    <img src="${candlestickUrl}" alt="" class="bottom-candlestick">

    <footer>
      <p class="footer-text">Customization Available on All products</p>
    </footer>
  </div>
</body>
</html>
  `;
}

// Customization Page (index5) - Last page of catalogue
function generateCustomizationPage() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cozy Creations - Customization</title>
  <style>
    ${fontStyles}
    :root {
      --bg-color: #FFC592;
      --text-dark: #4F3629;
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
    }
    .a4-page {
      width: 210mm;
      height: 297mm;
      background-color: var(--bg-color);
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      padding: 0;
      font-family: 'Papyrus', fantasy, sans-serif;
    }
    .lines-decoration {
      position: absolute;
      top: 0;
      right: 0;
      width: 560px;
      z-index: 1;
      pointer-events: none;
      opacity: 0.8;
    }
    .hero-container {
      width: 80%;
      height: 400px;
      margin-top: 80px;
      overflow: hidden;
      position: relative;
      border-top-right-radius: 300px;
      border-bottom-right-radius: 300px;
      z-index: 2;
      background-color: #fff;
      flex-shrink: 0;
    }
    .hero-image {
      width: 110%;
      height: 110%;
      object-fit: cover;
      object-position: center;
    }
    .candlestick-decoration {
      position: absolute;
      top: 400px;
      right: 30px;
      width: 160px;
      height: auto;
      z-index: 10;
    }
    .info-box-container {
      flex-grow: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 120px 80px 60px 80px;
      position: relative;
      z-index: 2;
    }
    .info-box {
      width: 100%;
      border: 1px solid var(--text-dark);
      padding: 20px 20px 60px 20px;
      display: flex;
      flex-direction: column;
      gap: 25px;
    }
    .info-box p {
      color: var(--text-dark);
      font-size: 24px;
      line-height: 1.5;
    }
    .intro-text {
      margin-bottom: 5px;
    }
    .section-title {
      position: relative;
    }
    .section-title span {
      font-size: 24px;
      text-decoration: underline wavy;
      text-underline-offset: 3px;
      margin-right: 8px;
    }
    footer {
      text-align: center;
      padding-bottom: 30px;
      z-index: 2;
    }
    .footer-tagline {
      font-size: 26px;
      color: var(--text-dark);
    }
  </style>
</head>
<body>
  ${fontForceLoadHtml}
  <div class="a4-page">
    <img src="${linesRightUrl}" alt="" class="lines-decoration">

    <div class="hero-container">
      <img src="https://res.cloudinary.com/dumkblp3v/image/upload/v1767176149/unnamed-7_j6fal6.webp" alt="Cozy Creations Collection" class="hero-image">
    </div>

    <img src="${candlestickUrl}" alt="" class="candlestick-decoration">

    <div class="info-box-container">
      <div class="info-box">
        <p class="intro-text">As per your costomization requirement we have options and also accept your choice..</p>

        <div class="detail-section">
          <p class="section-title"><span>Fragrance</span> - Rose, Jasmine, Sandal, Ocean mint, Lemon Gross, Cherry
            blossom, Oud, Jezz-z, Deo, Apple pine, Mogra, Raat Raani and many more.</p>
        </div>

        <div class="detail-section">
          <p class="section-title"><span>Colour</span> - As your request.</p>
        </div>
      </div>
    </div>

    <footer>
      <p class="footer-tagline">Customization Available on All products</p>
    </footer>
  </div>
</body>
</html>
  `;
}

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
    ${fontStyles}
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
  ${fontForceLoadHtml}
  <div class="a4-page">
    <img src="${linesRightUrl}" alt="" class="decorative-lines">
    <header>
      <h1>Our ${collectionTitle}<br>Collection...</h1>
    </header>
    <main class="product-grid">
      ${productsHtml}
    </main>
    <img src="${candlestickUrl}" alt="" class="candlestick">
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
    ${fontStyles}
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
      margin-bottom: 20px;
      text-align: right;
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
  ${fontForceLoadHtml}
  <div class="a4-page">
    <img src="${linesLeftUrl}" alt="" class="decorative-lines">
    <header>
      <h1>Our ${collectionTitle}<br>Collection...</h1>
    </header>
    <main class="product-grid">
      ${productsHtml}
    </main>
    <img src="${candlestickUrl}" alt="" class="candlestick">
    <footer>
      <div class="footer-text">Customization Available on All products</div>
    </footer>
  </div>
</body>
</html>
  `;
}

module.exports = {
  generateWelcomePage,
  generateAboutPage,
  generateTemplate1,
  generateTemplate2,
  generateCustomizationPage,
  collectionNames
};
