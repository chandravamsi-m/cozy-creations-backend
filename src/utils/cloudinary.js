// src/utils/cloudinary.js

/**
 * Helper function to extract Cloudinary public ID from URL.
 * Handles URLs with and without transformation segments.
 * 
 * Examples:
 *   .../upload/v1234/cozy-creations/products/abc.webp  → cozy-creations/products/abc
 *   .../upload/w_600,q_auto/v1234/cozy-creations/products/abc.webp  → cozy-creations/products/abc
 *   .../upload/cozy-creations/products/abc.webp  → cozy-creations/products/abc
 */
function extractCloudinaryPublicId(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.includes('cloudinary.com')) return null;

  try {
    // 1. Find the position after '/upload/'
    const uploadIdx = imageUrl.indexOf('/upload/');
    if (uploadIdx === -1) return null;

    let afterUpload = imageUrl.slice(uploadIdx + '/upload/'.length);

    // 2. Strip transformation segments (they look like: w_600,q_auto or c_fill,g_auto)
    //    Transformation segments do NOT start with 'v' followed by digits, and contain '_'
    //    A transformation segment matches: word_value pairs separated by commas
    const transformPattern = /^([a-z][a-z0-9]*_[^/,]+(?:,[a-z][a-z0-9]*_[^/,]+)*\/)+/;
    afterUpload = afterUpload.replace(transformPattern, '');

    // 3. Strip version segment (v1234567/)
    afterUpload = afterUpload.replace(/^v\d+\//, '');

    // 4. Strip file extension
    const publicId = afterUpload.replace(/\.[a-z0-9]+$/i, '');

    return publicId || null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  extractCloudinaryPublicId,
};
