import { describe, it, expect } from 'vitest'
import { buildCliArgs } from './run'

describe('buildCliArgs', () => {
    it('adds --permission-mode for valid permission mode', () => {
        const args = buildCliArgs('claude', {
            directory: '/tmp',
            permissionMode: 'bypassPermissions',
        })
        expect(args).toContain('--permission-mode')
        expect(args).toContain('bypassPermissions')
        expect(args).not.toContain('--yolo')
    })

    it('ignores invalid permission mode and falls back to --yolo', () => {
        const args = buildCliArgs('claude', {
            directory: '/tmp',
            permissionMode: 'not-a-real-mode',
        }, true)
        expect(args).not.toContain('--permission-mode')
        expect(args).toContain('--yolo')
    })

    it('ignores invalid permission mode without yolo fallback', () => {
        const args = buildCliArgs('claude', {
            directory: '/tmp',
            permissionMode: 'not-a-real-mode',
        })
        expect(args).not.toContain('--permission-mode')
        expect(args).not.toContain('--yolo')
    })

    it('prefers --permission-mode over --yolo when both present', () => {
        const args = buildCliArgs('cursor', {
            directory: '/tmp',
            permissionMode: 'yolo',
        }, true)
        expect(args).toContain('--permission-mode')
        expect(args).toContain('yolo')
        // --yolo flag should NOT be added when --permission-mode is used
        const permIdx = args.indexOf('--permission-mode')
        const yoloIdx = args.indexOf('--yolo')
        expect(yoloIdx).toBe(-1)
    })

    it('throws for the removed gemini agent (no longer launchable)', () => {
        expect(() => buildCliArgs('gemini', { directory: '/tmp' })).toThrow(/no longer supported/)
    })

    it('adds --yolo when no permissionMode and yolo is true', () => {
        const args = buildCliArgs('claude', {
            directory: '/tmp',
        }, true)
        expect(args).toContain('--yolo')
        expect(args).not.toContain('--permission-mode')
    })

    it('passes --model through for opencode (mid-session model change support)', () => {
        const args = buildCliArgs('opencode', {
            directory: '/tmp',
            model: 'ollama/exaone:4.5-33b-q8',
        })
        expect(args).toContain('--model')
        expect(args).toContain('ollama/exaone:4.5-33b-q8')
    })

    it('validates all known permission modes', () => {
        for (const mode of ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'ask', 'read-only', 'safe-yolo', 'yolo']) {
            const args = buildCliArgs('claude', {
                directory: '/tmp',
                permissionMode: mode,
            })
            expect(args).toContain('--permission-mode')
            expect(args).toContain(mode)
        }
    })

    it('uses --session-id (not --resume) for pi resume', () => {
        const args = buildCliArgs('pi', {
            directory: '/tmp',
            resumeSessionId: 'pi-session-123',
        })
        expect(args[0]).toBe('pi')
        expect(args).toContain('--session-id')
        expect(args).toContain('pi-session-123')
        expect(args).not.toContain('--resume')
    })

    it('never adds --permission-mode or --yolo for pi even when requested', () => {
        const args = buildCliArgs('pi', {
            directory: '/tmp',
            permissionMode: 'yolo',
        }, true)
        expect(args).not.toContain('--permission-mode')
        expect(args).not.toContain('--yolo')
    })

    it('passes --effort through for pi (thinking level)', () => {
        const args = buildCliArgs('pi', {
            directory: '/tmp',
            effort: 'high',
        })
        expect(args).toContain('--effort')
        expect(args).toContain('high')
    })

    it('does not pass --effort for flavors other than claude/pi', () => {
        const args = buildCliArgs('opencode', {
            directory: '/tmp',
            effort: 'high',
        })
        expect(args).not.toContain('--effort')
    })

    it('builds Grok runner resume, model, effort, and permission arguments', () => {
        const args = buildCliArgs('grok', {
            directory: '/tmp',
            resumeSessionId: 'grok-session-1',
            model: 'grok-4.5',
            effort: 'low',
            permissionMode: 'plan',
        })

        expect(args).toEqual([
            'grok',
            '--resume', 'grok-session-1',
            '--hapi-starting-mode', 'remote',
            '--started-by', 'runner',
            '--model', 'grok-4.5',
            '--effort', 'low',
            '--permission-mode', 'plan',
        ])
    })
})
