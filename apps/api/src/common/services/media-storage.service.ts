import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary'
import * as streamifier from 'streamifier'
import { resolvePlatformProfile, type MediaProvider } from '../platform/platform-profile'

interface UploadBufferInput {
  buffer: Buffer
  folder: string
  resourceType?: 'image' | 'video' | 'raw' | 'auto'
  context?: string
}

export interface MediaUploadResult {
  url: string
  publicId: string
  format?: string
  bytes: number
}

@Injectable()
export class MediaStorageService {
  readonly provider: MediaProvider

  constructor(private readonly configService: ConfigService) {
    const profile = resolvePlatformProfile(process.env)
    this.provider = profile.mediaProvider

    if (this.provider === 'cloudinary') {
      const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME')
      const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY')
      const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET')

      if (!cloudName || !apiKey || !apiSecret) {
        throw new Error(
          'Cloudinary configuration is missing. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
        )
      }

      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
      })
    }
  }

  async uploadBuffer(input: UploadBufferInput): Promise<MediaUploadResult> {
    if (this.provider !== 'cloudinary') {
      throw new ServiceUnavailableException(
        `Media uploads are disabled for the ${resolvePlatformProfile(process.env).region} platform profile`,
      )
    }

    const uploadResult = await new Promise<UploadApiResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: input.folder,
          resource_type: input.resourceType ?? 'auto',
          context: input.context,
        },
        (error, result) => {
          if (error) return reject(error)
          if (!result) return reject(new Error('Cloudinary upload failed'))
          resolve(result)
        },
      )

      streamifier.createReadStream(input.buffer).pipe(uploadStream)
    })

    return {
      url: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      format: uploadResult.format || undefined,
      bytes: uploadResult.bytes,
    }
  }

  async delete(publicId?: string | null): Promise<void> {
    if (!publicId || this.provider !== 'cloudinary') {
      return
    }

    await cloudinary.uploader.destroy(publicId)
  }
}
