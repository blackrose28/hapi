import { basename, extname } from 'path'

export function detectImageMimeType(bytes: Buffer): string | null {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        return 'image/png'
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image/jpeg'
    }
    if (bytes.length >= 6 && (bytes.toString('ascii', 0, 6) === 'GIF87a' || bytes.toString('ascii', 0, 6) === 'GIF89a')) {
        return 'image/gif'
    }
    if (bytes.length >= 4 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
        return 'image/webp'
    }
    return null
}

export type GeneratedImageMetadata = {
    id: string
    path: string
    fileName: string
    mimeType: string
    createdAt: number
}

export interface GeneratedImage extends GeneratedImageMetadata {
    bytes?: Buffer
}

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
    '.apng': 'image/apng',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.webp': 'image/webp'
}

const generatedImages = new Map<string, GeneratedImageMetadata>()

export function resolveGeneratedImageMimeType(path: string): string {
    return IMAGE_MIME_BY_EXTENSION[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

export function registerGeneratedImage(args: {
    id: string
    path: string
    mimeType?: string | null
    fileName?: string | null
    bytes?: Buffer
}): GeneratedImageMetadata {
    const metadata: GeneratedImageMetadata = {
        id: args.id,
        path: args.path,
        fileName: args.fileName || basename(args.path) || `${args.id}.png`,
        mimeType: args.mimeType || resolveGeneratedImageMimeType(args.path),
        createdAt: Date.now()
    }
    generatedImages.set(args.id, metadata)
    return metadata
}

export function getGeneratedImage(id: string): GeneratedImageMetadata | null {
    return generatedImages.get(id) ?? null
}

export function clearGeneratedImages(): void {
    generatedImages.clear()
}
