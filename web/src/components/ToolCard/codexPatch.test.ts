import { describe, expect, it } from 'vitest'
import { extractCodexPatchFiles } from './codexPatch'

const arrayPayload = {
    changes: [{
        path: '/workspace/docs/plan.md',
        kind: { type: 'update', move_path: null },
        diff: '@@ -1 +1 @@\n-old\n+new'
    }]
}

describe('extractCodexPatchFiles', () => {
    it('extracts files from the current array payload', () => {
        expect(extractCodexPatchFiles(arrayPayload)).toEqual([
            { path: '/workspace/docs/plan.md' }
        ])
    })

    it('keeps supporting record-shaped payloads', () => {
        expect(extractCodexPatchFiles({
            changes: { '/workspace/a.ts': {}, '/workspace/b.ts': {} }
        })).toEqual([
            { path: '/workspace/a.ts' },
            { path: '/workspace/b.ts' }
        ])
    })

    it.each([null, {}, { changes: [] }, { changes: 'invalid' }])(
        'returns a safe empty list for malformed input %#',
        (input) => expect(extractCodexPatchFiles(input)).toEqual([])
    )
})
