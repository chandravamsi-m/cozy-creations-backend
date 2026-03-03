// src/utils/cloudinary.js

/**
 * Helper function to extract Cloudinary public ID from URL.
 */
function extractCloudinaryPublicId(imageUrl) {
  if (!imageUrl || !imageUrl.includes('cloudinary.com')) return null;
  
  // Match pattern: .../upload/v<version>/<public_id>.<extension>
  const match = imageUrl.match(/\/*v\d+\/(.+)\.(jpg|jpeg|png|gif|webp|svg)$/);
  return match ? match[1] : null;
}

module.exports = {
  extractCloudinaryPublicId,
};
