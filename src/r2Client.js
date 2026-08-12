/**
 * @fileoverview R2Store — Cloudflare R2 client used internally by SyncMesh.
 *
 * Architect: Omindu Dissanayaka (https://github.com/OminduDissanayaka)
 *
 * Two responsibilities against the same bucket:
 *   1. Large-file multipart uploads — the browser uploads chunks directly
 *      to R2 via presigned URLs; your server never touches the bytes.
 *   2. Chat archive chunks — small, write-once JSON blobs produced by
 *      SyncMesh's rolling-window archiver. Each chunk key is written
 *      exactly once and never mutated, so there's no read-modify-write
 *      race condition.
 */

'use strict';

const {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  GetObjectCommand,
  PutObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

class R2Store {
  /**
   * @param {object} config
   * @param {string} config.accountId - Cloudflare account ID.
   * @param {string} config.accessKeyId - R2 API token access key ID.
   * @param {string} config.secretAccessKey - R2 API token secret.
   * @param {string} config.bucketName - Target R2 bucket name.
   */
  constructor({ accountId, accessKeyId, secretAccessKey, bucketName }) {
    if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
      throw new Error(
        'R2Store requires { accountId, accessKeyId, secretAccessKey, bucketName }'
      );
    }

    this.bucket = bucketName;
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  /**
   * @param {string} fileKey
   * @param {string} fileType
   * @returns {Promise<string>} UploadId
   */
  async startMultipartUpload(fileKey, fileType) {
    const { UploadId } = await this.s3.send(
      new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: fileKey, ContentType: fileType })
    );
    return UploadId;
  }

  /**
   * @param {string} fileKey
   * @param {string} uploadId
   * @param {number} partCount
   * @param {number} [expiresInSeconds=3600]
   * @returns {Promise<string[]>}
   */
  async getPresignedPartUrls(fileKey, uploadId, partCount, expiresInSeconds = 3600) {
    const urls = [];
    for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
      const command = new UploadPartCommand({
        Bucket: this.bucket,
        Key: fileKey,
        PartNumber: partNumber,
        UploadId: uploadId,
      });
      urls.push(await getSignedUrl(this.s3, command, { expiresIn: expiresInSeconds }));
    }
    return urls;
  }

  /**
   * @param {string} fileKey
   * @param {string} uploadId
   * @param {{ ETag: string, PartNumber: number }[]} parts
   * @returns {Promise<void>}
   */
  async completeMultipartUpload(fileKey, uploadId, parts) {
    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: fileKey,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      })
    );
  }

  /**
   * @param {string} fileKey
   * @param {string} uploadId
   * @returns {Promise<void>}
   */
  async abortMultipartUpload(fileKey, uploadId) {
    await this.s3.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: fileKey, UploadId: uploadId }));
  }

  /**
   * @param {string} fileKey
   * @param {number} [expiresInSeconds=3600]
   * @returns {Promise<string>}
   */
  async getDownloadUrl(fileKey, expiresInSeconds = 3600) {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: fileKey });
    return getSignedUrl(this.s3, command, { expiresIn: expiresInSeconds });
  }

  /**
   * Write-once JSON chunk write. Callers must never overwrite an existing key.
   * @param {string} chunkKey
   * @param {object} payload
   * @returns {Promise<void>}
   */
  async putJsonChunk(chunkKey, payload) {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: chunkKey,
        Body: JSON.stringify(payload),
        ContentType: 'application/json',
      })
    );
  }

  /**
   * @param {string} chunkKey
   * @returns {Promise<object>}
   */
  async getJsonChunk(chunkKey) {
    const { Body } = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: chunkKey }));
    const text = await Body.transformToString();
    return JSON.parse(text);
  }
}

module.exports = R2Store;
