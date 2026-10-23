const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const Image = require('../models/Image');

const s3Configured = () => Boolean(
  process.env.AWS_BUCKET_NAME && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
);

let s3Client;
const s3 = () => {
  s3Client ??= new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  });
  return s3Client;
};

/**
 * Resize an uploaded image to web size and store it (S3 if configured,
 * otherwise MongoDB). Returns the public URL.
 * @param {object} file - Multer file (memory storage)
 * @param {object} user - Uploader
 * @param {string} baseUrl - Public origin of this API, for database-stored images
 * @param {number} [maxSize] - Longest edge in pixels
 */
exports.storeImage = async (file, user, baseUrl, maxSize = 1600) => {
  const { data, info } = await sharp(file.buffer)
    .rotate() // respect EXIF orientation from phone cameras
    .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });

  if (s3Configured()) {
    const key = `images/${uuidv4()}.webp`;
    await s3().send(new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      Body: data,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable'
    }));
    return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
  }

  const image = await Image.create({
    data,
    contentType: 'image/webp',
    size: info.size,
    width: info.width,
    height: info.height,
    owner: user._id
  });
  return `${baseUrl}/api/v1/uploads/${image._id}`;
};
