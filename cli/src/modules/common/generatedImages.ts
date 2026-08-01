export function detectImageMimeType(bytes: Buffer): string | null {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        return 'image/png';
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image/jpeg';
    }
    if (bytes.length >= 6 && (bytes.toString('ascii', 0, 6) === 'GIF87a' || bytes.toString('ascii', 0, 6) === 'GIF89a')) {
        return 'image/gif';
    }
    if (bytes.length >= 4 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
        return 'image/webp';
    }
    return null;
}

export interface GeneratedImage {
    id: string;
    path: string;
    fileName?: string;
    mimeType: string;
    bytes: Buffer;
}

export function registerGeneratedImage(image: GeneratedImage): GeneratedImage {
    return {
        ...image,
        fileName: image.fileName || image.path.split('/').pop() || 'image'
    };
}
