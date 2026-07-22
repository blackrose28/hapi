import { describe, expect, it } from 'vitest'
import { reduceChatBlocks } from './reducer'
import type { NormalizedMessage } from './types'

function quotaMessage(id: string, text: string, createdAt: number): NormalizedMessage {
    return {
        id,
        localId: null,
        createdAt,
        role: 'agent',
        isSidechain: false,
        content: [{ type: 'text', text, uuid: id, parentUUID: null }]
    }
}

describe('reduceChatBlocks quota state', () => {
    it('tracks sub-threshold usage (quota-update) without rendering it in the timeline', () => {
        const reduced = reduceChatBlocks([
            quotaMessage('m1', 'Claude AI usage status|1774278000|30|five_hour', 1)
        ], null)

        expect((reduced as any).latestQuota.fiveHour).toMatchObject({
            limitType: 'five_hour',
            utilization: 0.3,
            endsAt: 1774278000,
            reached: false
        })
        expect(reduced.blocks).toEqual([])
    })

    it('tracks five_hour and seven_day windows independently', () => {
        const reduced = reduceChatBlocks([
            quotaMessage('m1', 'Claude AI usage status|1774278000|30|five_hour', 1),
            quotaMessage('m2', 'Claude AI usage status|1774850400|55|seven_day', 2)
        ], null)

        expect((reduced as any).latestQuota.fiveHour).toMatchObject({ limitType: 'five_hour', utilization: 0.3 })
        expect((reduced as any).latestQuota.sevenDay).toMatchObject({ limitType: 'seven_day', utilization: 0.55 })
    })

    it('keeps only the most recent quota-update per window', () => {
        const reduced = reduceChatBlocks([
            quotaMessage('m1', 'Claude AI usage status|1774278000|30|five_hour', 1),
            quotaMessage('m2', 'Claude AI usage status|1774279000|42|five_hour', 2)
        ], null)

        expect((reduced as any).latestQuota.fiveHour).toMatchObject({ utilization: 0.42, endsAt: 1774279000 })
    })

    it('marks a window as reached (no utilization) on limit-reached', () => {
        const reduced = reduceChatBlocks([
            quotaMessage('m1', 'Claude AI usage status|1774278000|30|five_hour', 1),
            quotaMessage('m2', 'Claude AI usage limit reached|1774280000|five_hour', 2)
        ], null)

        expect((reduced as any).latestQuota.fiveHour).toMatchObject({
            utilization: null,
            endsAt: 1774280000,
            reached: true
        })
    })

    it('returns null windows when no quota data has arrived', () => {
        const reduced = reduceChatBlocks([], null)

        expect((reduced as any).latestQuota).toEqual({ fiveHour: null, sevenDay: null })
    })

    it('tracks a plain allowed status with unknown utilization, not a fake 0%', () => {
        const reduced = reduceChatBlocks([
            quotaMessage('m1', 'Claude AI usage status|1774278000||five_hour', 1)
        ], null)

        expect((reduced as any).latestQuota.fiveHour).toMatchObject({
            limitType: 'five_hour',
            utilization: null,
            endsAt: 1774278000,
            reached: false
        })
    })

    it('buckets model-scoped weekly limits (seven_day_opus, seven_day_sonnet) into the 7d window', () => {
        const reducedOpus = reduceChatBlocks([
            quotaMessage('m1', 'Claude AI usage status|1774850400|20|seven_day_opus', 1)
        ], null)
        expect((reducedOpus as any).latestQuota.sevenDay).toMatchObject({
            limitType: 'seven_day_opus',
            utilization: 0.2
        })

        const reducedSonnet = reduceChatBlocks([
            quotaMessage('m1', 'Claude AI usage status|1774850400|60|seven_day_sonnet', 1)
        ], null)
        expect((reducedSonnet as any).latestQuota.sevenDay).toMatchObject({
            limitType: 'seven_day_sonnet',
            utilization: 0.6
        })
    })
})
