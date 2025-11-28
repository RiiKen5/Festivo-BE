const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

class UploadService {
  constructor() {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });
    this.bucket = process.env.AWS_BUCKET_NAME;
  }

  // Multer configuration for local uploads
  getMulterConfig(options = {}) {
    const {
      destination = 'uploads/',
      maxSize = 5 * 1024 * 1024, // 5MB
      allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
    } = options;

    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = path.join(process.cwd(), destination);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
      }
    });

    const fileFilter = (req, file, cb) => {
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`File type not allowed. Allowed types: ${allowedTypes.join(', ')}`), false);
      }
    };

    return multer({
      storage,
      limits: { fileSize: maxSize },
      fileFilter
    });
  }

  // Memory storage for processing before S3 upload
  getMemoryMulter(options = {}) {
    const {
      maxSize = 5 * 1024 * 1024,
      allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
    } = options;

    const storage = multer.memoryStorage();

    const fileFilter = (req, file, cb) => {
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`File type not allowed. Allowed types: ${allowedTypes.join(', ')}`), false);
      }
    };

    return multer({
      storage,
      limits: { fileSize: maxSize },
      fileFilter
    });
  }

  // Upload to S3
  async uploadToS3(file, folder = 'uploads') {
    const key = `${folder}/${uuidv4()}${path.extname(file.originalname)}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: 'public-read'
    });

    await this.s3Client.send(command);

    return {
      key,
      location: `https://${this.bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`
    };
  }

  // Upload with image processing
  async uploadImage(file, folder = 'images', options = {}) {
    const {
      width = 1200,
      height = 800,
      quality = 80,
      format = 'webp'
    } = options;

    // Process image with sharp
    let processedBuffer = await sharp(file.buffer)
      .resize(width, height, { fit: 'inside', withoutEnlargement: true })
      .toFormat(format, { quality })
      .toBuffer();

    const key = `${folder}/${uuidv4()}.${format}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: processedBuffer,
      ContentType: `image/${format}`,
      ACL: 'public-read'
    });

    await this.s3Client.send(command);

    return {
      key,
      location: `https://${this.bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`
    };
  }

  // Upload profile photo with thumbnail
  async uploadProfilePhoto(file) {
    const results = {};

    // Main image (400x400)
    const mainImage = await sharp(file.buffer)
      .resize(400, 400, { fit: 'cover' })
      .toFormat('webp', { quality: 85 })
      .toBuffer();

    const mainKey = `profiles/${uuidv4()}.webp`;

    await this.s3Client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: mainKey,
      Body: mainImage,
      ContentType: 'image/webp',
      ACL: 'public-read'
    }));

    results.main = `https://${this.bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${mainKey}`;

    // Thumbnail (100x100)
    const thumbnail = await sharp(file.buffer)
      .resize(100, 100, { fit: 'cover' })
      .toFormat('webp', { quality: 80 })
      .toBuffer();

    const thumbKey = `profiles/thumbs/${uuidv4()}.webp`;

    await this.s3Client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: thumbKey,
      Body: thumbnail,
      ContentType: 'image/webp',
      ACL: 'public-read'
    }));

    results.thumbnail = `https://${this.bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${thumbKey}`;

    return results;
  }

  // Delete from S3
  async deleteFromS3(key) {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key
    });

    await this.s3Client.send(command);
    return true;
  }

  // Get signed URL for private files
  async getSignedUrl(key, expiresIn = 3600) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key
    });

    return getSignedUrl(this.s3Client, command, { expiresIn });
  }

  // Upload multiple files
  async uploadMultiple(files, folder = 'uploads') {
    const results = await Promise.all(
      files.map(file => this.uploadToS3(file, folder))
    );
    return results;
  }

  // Delete local file
  deleteLocalFile(filePath) {
    return new Promise((resolve, reject) => {
      fs.unlink(filePath, (err) => {
        if (err) reject(err);
        else resolve(true);
      });
    });
  }
}

module.exports = new UploadService();
