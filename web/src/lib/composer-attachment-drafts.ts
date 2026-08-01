/**
 * Stub for upstream's composer-attachment-drafts module.
 *
 * The full module (upstream tiann/hapi) stores upload metadata alongside
 * attachment File objects so that a remount does not re-upload already-
 * uploaded files.  Our tree does not have the full draft persistence
 * infrastructure yet; this stub returns null to always re-upload.
 *
 * When the `chat-composer-misc-polish` or `composer-customization` cart
 * is ported, replace this stub with the real implementation.
 */

export interface RestoredUploadMetadata {
    id: string
    path: string
    previewUrl?: string
}

/**
 * Attempt to retrieve previously-stored upload metadata for a File.
 * Returns null when no prior upload is on record (always, in this stub).
 */
export function getRestoredUploadMetadata(_file: File): RestoredUploadMetadata | null {
    return null
}
