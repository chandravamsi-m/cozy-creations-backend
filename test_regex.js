const urls = [
  "https://res.cloudinary.com/dumkblp3v/image/upload/v1234567890/cozy-products/product_abc123.jpg",
  "https://res.cloudinary.com/dumkblp3v/image/upload//v1771170436/cozy-products/xui6r6taphpkpcip6lpc.webp",
  "https://res.cloudinary.com/dumkblp3v/image/upload/v123/simple.jpg"
];

function extractCloudinaryPublicId(imageUrl) {
  if (!imageUrl || !imageUrl.includes('cloudinary.com')) return null;
  
  // NEW FIXED REGEX
  const regex = /\/*v\d+\/(.+)\.(jpg|jpeg|png|gif|webp|svg)$/;
  const match = imageUrl.match(regex);
  
  return match ? match[1] : null;
}

urls.forEach(url => {
  console.log(`URL: ${url}`);
  console.log(`Extracted ID: ${extractCloudinaryPublicId(url)}`);
  console.log("---");
});
