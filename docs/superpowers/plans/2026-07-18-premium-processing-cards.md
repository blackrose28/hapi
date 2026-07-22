# Premium Processing Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Triển khai giao diện processing cards Quiet Intelligence đã duyệt, gồm group cuộn nội bộ, tổng thời gian live đúng theo timestamp đầu/cuối, card compact tối đa 600px và không thay đổi dữ liệu hay hành vi tool.

**Architecture:** Giữ nguyên pipeline `ChatBlock → partitionActivityParts → renderer`; chỉ bổ sung phép tính elapsed thuần ở model và thay lớp trình bày tại Web. Một clock dùng chung cho mỗi activity group cập nhật cả group total lẫn row duration; standalone cards dùng shell/tone token chung nhưng giữ nguyên renderer, dialog, RPC và payload hiện có.

**Tech Stack:** React 19, TypeScript strict, Tailwind CSS 4, CSS custom properties, assistant-ui, Vitest, Testing Library, Bun/Vite.

## Global Constraints

- Chỉ sửa presentation, timing suy ra để hiển thị, i18n và tests trong `web`; không sửa Hub, CLI, API, database, persistence hoặc stream normalization.
- Không thay đổi `partitionActivityParts`, allowlist, boundary, stable block ID, thứ tự stream hoặc số lần một activity xuất hiện.
- Không thay đổi permission/question RPC, answer payload, dialog renderer, Plan checklist, Diff/Apply Changes/Terminal output logic.
- Activity group và standalone processing card: `width: 100%`, `max-width: 600px`.
- Activity body: `max-height: min(420px, 55vh)`, `overflow-y: auto`, `overscroll-behavior: contain`; header nằm ngoài scroller; không virtualization/unmount.
- Terminal/Diff output mở rộng giữ `max-height: 300px` và chiếm toàn bộ chiều rộng nội bộ.
- Group running: `now - first.startedAt`; group completed: `last.completedAt - first.startedAt`; tuyệt đối không cộng duration từng activity.
- Running total tick mỗi 1 giây, không reset khi append, không `aria-live`; completed total đóng băng.
- Visible duration: `<60s` dùng `<0.1s`/một chữ số thập phân, `60s–<1h` dùng `21m 04s`, `>=1h` dùng `1h 05m`.
- Provider title/subtitle/command giữ nguyên nội dung và natural case; mọi system label đi qua `en`, `vi-VN`, `zh-CN`.
- Motion chỉ dành cho running state, CSS nhẹ, và phải tắt dưới `prefers-reduced-motion: reduce`.
- Production component chỉ dùng app design tokens; không chép màu hard-code từ mockup vào JSX.
- Không thêm dependency mới, không refactor file ngoài phạm vi cần thiết, không sửa nội dung mockup đã duyệt.

---

## File Map

| File | Trách nhiệm sau thay đổi |
|---|---|
| `web/src/components/ToolCard/toolRunModel.ts` | Nguồn chuẩn duy nhất cho elapsed group/activity và compact duration format. |
| `web/src/components/ToolCard/toolRunContext.tsx` | Clock 1 giây dùng chung và accessible duration bản địa hóa. |
| `web/src/components/ToolCard/ToolRunGroup.tsx` | Header live/completed, group total, scroll viewport và provider cho row. |
| `web/src/components/ToolCard/ToolCard.tsx` | Row density, standalone shell, orb và tone neutral/plan/diff/question/permission/error. |
| `web/src/components/assistant-ui/reasoning.tsx` | Reasoning row đồng nhịp 37px với tool rows, không đổi nội dung/disclosure. |
| `web/src/components/ToolCard/PermissionFooter.tsx` | Chỉ đổi action tray/button presentation; giữ nguyên callback/payload. |
| `web/src/index.css` | Theme tokens và CSS scoped cho Quiet Intelligence, scrollbar, running ambient edge, reduced motion. |
| `web/src/lib/locales/{en,vi-VN,zh-CN}.ts` | Nhãn `live` và accessible duration phút/giờ. |
| `web/src/components/ToolCard/*.test.ts(x)` | Timing, layout, lossless DOM, tone, payload và renderer regressions. |
| `web/src/components/assistant-ui/reasoning.test.tsx` | Reasoning row density, natural case và disclosure regression. |

## Required Workflow Gates

Trước Task 1, chạy GitNexus impact cho đúng hai điểm thay đổi dùng chung:

```text
mcp__gitnexus__impact(repo="/home/huynq/notebooks/hapi", target="getActivityGroupDurationMs", direction="upstream", includeTests=true, maxDepth=3)
mcp__gitnexus__impact(repo="/home/huynq/notebooks/hapi", target="ToolCardInner", direction="upstream", includeTests=true, maxDepth=3)
```

Trước mỗi commit code ở Tasks 1–5, chạy:

```text
mcp__gitnexus__detect_changes(repo="/home/huynq/notebooks/hapi", scope="all")
```

Nếu báo affected module ngoài Web presentation/tests, dừng commit và loại thay đổi vượt phạm vi trước khi tiếp tục.

### Task 1: Pure elapsed model và compact duration format

**Files:**
- Modify: `web/src/components/ToolCard/toolRunModel.ts:180-235`
- Test: `web/src/components/ToolCard/toolRunModel.test.ts`

**Interfaces:**
- Consumes: `ActivityEntry`, `isActivityRunning(entry)` và exact timestamps đang có.
- Produces: `getActivityGroupDurationMs(entries: readonly ActivityEntry[], now: number): number | null`; `formatActivityDuration(durationMs: number): string`.

- [ ] **Step 1: Viết failing tests cho running/completed elapsed và format biên**

Thay các test cũ của `getActivityGroupDurationMs`/`formatActivityDuration` bằng các case cụ thể sau; giữ nguyên toàn bộ partition/expansion tests hiện có:

```ts
describe('activity timing', () => {
    it('uses now minus the first exact start while any group entry is running', () => {
        const entries = [
            toolEntry('Read', { startedAt: 1000, completedAt: 2000 }),
            toolEntry('Bash', { state: 'running', startedAt: 2500, completedAt: null })
        ]

        expect(getActivityGroupDurationMs(entries, 61000)).toBe(60000)
    })

    it('does not reset the running elapsed when another activity is appended', () => {
        const first = toolEntry('Read', { startedAt: 1000, completedAt: 2000 })
        const running = toolEntry('Bash', { state: 'running', startedAt: 2500, completedAt: null })

        expect(getActivityGroupDurationMs([first, running], 11000)).toBe(10000)
        expect(getActivityGroupDurationMs([
            first,
            toolEntry('Grep', { startedAt: 6000, completedAt: 7000 }),
            running
        ], 12000)).toBe(11000)
    })

    it('freezes a completed group at last completion minus first start', () => {
        expect(getActivityGroupDurationMs([
            toolEntry('Read', { startedAt: 1000, completedAt: 2000 }),
            toolEntry('Bash', { startedAt: 2500, completedAt: 6500 })
        ], 999999)).toBe(5500)
    })

    it.each([
        [[], 5000],
        [[reasoningEntry(), toolEntry('Read')], 5000],
        [[toolEntry('Read', { startedAt: null }), toolEntry('Bash')], 5000],
        [[toolEntry('Read'), reasoningEntry()], 5000],
        [[toolEntry('Read'), toolEntry('Bash', { completedAt: null })], 5000],
        [[toolEntry('Read', { startedAt: Number.NaN }), toolEntry('Bash')], 5000],
        [[toolEntry('Read', { startedAt: 6000 }), toolEntry('Bash', { state: 'running' })], 5000],
        [[toolEntry('Read', { startedAt: 6000 }), toolEntry('Bash', { completedAt: 5000 })], 9000]
    ])('hides a group total when exact boundary timing is unavailable: %#', (entries, now) => {
        expect(getActivityGroupDurationMs(entries as ActivityEntry[], now)).toBeNull()
    })

    it.each([
        [50, '<0.1s'],
        [4600, '4.6s'],
        [59949, '59.9s'],
        [59999, '59.9s'],
        [60000, '1m 00s'],
        [1264000, '21m 04s'],
        [3599999, '59m 59s'],
        [3600000, '1h 00m'],
        [3900000, '1h 05m']
    ])('formats %dms as %s', (durationMs, expected) => {
        expect(formatActivityDuration(durationMs)).toBe(expected)
    })
})
```

- [ ] **Step 2: Chạy test để xác nhận RED**

Run:

```bash
bun --cwd web test -- toolRunModel.test.ts
```

Expected: FAIL vì `getActivityGroupDurationMs` chưa nhận `now`, running total vẫn `null`, và duration dài vẫn chỉ có hậu tố `s`.

- [ ] **Step 3: Cài đặt phép tính endpoint và formatter tối thiểu**

Trong `toolRunModel.ts`, thay hai hàm hiện tại bằng:

```ts
export function getActivityGroupDurationMs(
    entries: readonly ActivityEntry[],
    now: number
): number | null {
    if (entries.length === 0) return null

    const first = entries[0]
    if (first?.kind !== 'tool') return null

    const start = first.block.tool.startedAt
    if (!isExactTimestamp(start)) return null

    const running = entries.some(isActivityRunning)
    const last = entries[entries.length - 1]
    const end = running
        ? now
        : last?.kind === 'tool'
            ? last.block.tool.completedAt
            : null
    if (!isExactTimestamp(end)) return null

    const duration = end - start
    return Number.isFinite(duration) && duration >= 0 ? duration : null
}

export function formatActivityDuration(durationMs: number): string {
    if (durationMs > 0 && durationMs < 100) return '<0.1s'
    if (durationMs < 60000) return `${(Math.floor(durationMs / 100) / 10).toFixed(1)}s`

    const totalSeconds = Math.floor(durationMs / 1000)
    if (durationMs < 3600000) {
        const minutes = Math.floor(totalSeconds / 60)
        const seconds = totalSeconds % 60
        return `${minutes}m ${String(seconds).padStart(2, '0')}s`
    }

    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    return `${hours}h ${String(minutes).padStart(2, '0')}m`
}

export function formatActivityDurationValue(durationMs: number, locale: Locale): string {
    const seconds = durationMs > 0 && durationMs < 100
        ? 0.1
        : Math.floor(durationMs / 100) / 10
    return new Intl.NumberFormat(locale, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
    }).format(seconds)
}
```

Không đổi `getActivityDurationMs`, `partitionActivityParts`, `isGroupableToolBlock` hoặc `getToolExpansionKind`.

- [ ] **Step 4: Chạy test để xác nhận GREEN**

Run:

```bash
bun --cwd web test -- toolRunModel.test.ts
```

Expected: PASS toàn bộ `toolRunModel.test.ts`.

- [ ] **Step 5: Commit model timing**

```bash
git add web/src/components/ToolCard/toolRunModel.ts \
    web/src/components/ToolCard/toolRunModel.test.ts
git commit -m "feat(web): calculate live activity elapsed time"
```

### Task 2: Accessible duration và i18n cho live/phút/giờ

**Files:**
- Modify: `web/src/components/ToolCard/toolRunContext.tsx`
- Modify: `web/src/lib/locales/en.ts:308-317`
- Modify: `web/src/lib/locales/vi-VN.ts:302-311`
- Modify: `web/src/lib/locales/zh-CN.ts:307-316`
- Test: `web/src/components/ToolCard/ToolCard.test.tsx`

**Interfaces:**
- Consumes: `formatActivityDuration(durationMs)` và `Locale` hiện có.
- Produces: `useFormattedActivityDuration(durationMs)` trả `{ compact, accessible }` cho bốn range; key `tool.group.live`; unit tự nhiên từ `Intl.NumberFormat` theo locale.

- [ ] **Step 1: Viết failing locale tests cho duration phút/giờ**

Thêm vào `ToolCard.test.tsx`:

```tsx
it.each([
    ['en', '21m 04s', 'Activity duration: 21 minutes 4 seconds'],
    ['vi-VN', '21m 04s', 'Thời gian hoạt động: 21 phút 4 giây'],
    ['zh-CN', '21m 04s', '活动用时：21分钟 4秒钟']
] as const)('localizes minute duration accessibly in %s', (locale, compact, accessible) => {
    renderTool(makeToolBlock('Bash', { command: 'pwd' }, undefined, {
        startedAt: 1000,
        completedAt: 1265000
    }), { locale, displayMode: 'group-row', groupedNow: 1265000 })

    expect(screen.getByText(compact)).toHaveAccessibleName(accessible)
})

it.each([
    ['en', '1h 05m', 'Activity duration: 1 hour 5 minutes'],
    ['vi-VN', '1h 05m', 'Thời gian hoạt động: 1 giờ 5 phút'],
    ['zh-CN', '1h 05m', '活动用时：1小时 5分钟']
] as const)('localizes hour duration accessibly in %s', (locale, compact, accessible) => {
    renderTool(makeToolBlock('Bash', { command: 'pwd' }, undefined, {
        startedAt: 1000,
        completedAt: 3901000
    }), { locale, displayMode: 'group-row', groupedNow: 3901000 })

    expect(screen.getByText(compact)).toHaveAccessibleName(accessible)
})
```

- [ ] **Step 2: Chạy test để xác nhận RED**

```bash
bun --cwd web test -- ToolCard.test.tsx
```

Expected: FAIL vì accessible text hiện vẫn biểu diễn toàn bộ duration bằng giây.

- [ ] **Step 3: Bổ sung live label ở cả ba locale**

Thêm cùng vị trí group/duration keys:

```ts
// en.ts
'tool.group.live': 'live',

// vi-VN.ts
'tool.group.live': 'đang cập nhật',

// zh-CN.ts
'tool.group.live': '实时',
```

- [ ] **Step 4: Mở rộng accessible formatter nhưng giữ compact formatter làm nguồn chuẩn**

Trong `useFormattedActivityDuration`, dùng locale unit formatter để tự xử lý singular/plural và chọn range:

```ts
export function useFormattedActivityDuration(durationMs: number | null): {
    compact: string
    accessible: string
} | null {
    const { locale, t } = useTranslation()
    if (durationMs === null) return null

    const unit = (value: number, name: 'second' | 'minute' | 'hour') =>
        new Intl.NumberFormat(locale, {
            style: 'unit',
            unit: name,
            unitDisplay: 'long',
            maximumFractionDigits: 0
        }).format(value)
    let accessible: string
    if (durationMs < 60000) {
        const value = formatActivityDurationValue(durationMs, locale)
        accessible = t(
            durationMs > 0 && durationMs < 100
                ? 'tool.duration.lessThanSeconds'
                : 'tool.duration.seconds',
            { duration: value }
        )
    } else if (durationMs < 3600000) {
        const totalSeconds = Math.floor(durationMs / 1000)
        accessible = `${unit(Math.floor(totalSeconds / 60), 'minute')} ${unit(totalSeconds % 60, 'second')}`
    } else {
        const totalSeconds = Math.floor(durationMs / 1000)
        accessible = `${unit(Math.floor(totalSeconds / 3600), 'hour')} ${unit(Math.floor((totalSeconds % 3600) / 60), 'minute')}`
    }

    return {
        compact: formatActivityDuration(durationMs),
        accessible
    }
}
```

- [ ] **Step 5: Chạy test ba locale và typecheck**

```bash
bun --cwd web test -- ToolCard.test.tsx
bun --cwd web typecheck
```

Expected: PASS; không có missing translation key/type error.

- [ ] **Step 6: Commit i18n duration**

```bash
git add web/src/components/ToolCard/toolRunContext.tsx \
    web/src/components/ToolCard/ToolCard.test.tsx \
    web/src/lib/locales/en.ts \
    web/src/lib/locales/vi-VN.ts \
    web/src/lib/locales/zh-CN.ts
git commit -m "feat(web): localize long activity durations"
```

### Task 3: Live group header và lossless internal scroll

**Files:**
- Modify: `web/src/components/ToolCard/ToolRunGroup.tsx`
- Test: `web/src/components/ToolCard/ToolRunGroup.test.tsx`

**Interfaces:**
- Consumes: `getActivityGroupDurationMs(entries, now)`, `useActivityClock(running)`, `useFormattedActivityDuration` và `tool.group.live`.
- Produces: group header có live/final total; `data-activity-scroll-region` chứa toàn bộ children đúng một lần.

- [ ] **Step 1: Viết failing tests cho live tick, append, freeze và late boundaries**

Thêm các tests sau vào `ToolRunGroup.test.tsx` (dùng helpers `setMessageParts`, `part`, `block` sẵn có):

```tsx
it('shows a live group total, advances each second, and does not reset on append', () => {
    vi.useFakeTimers()
    vi.setSystemTime(61000)
    const first = block('Read', { startedAt: 1000, completedAt: 2000 })
    const running = block('Bash', { state: 'running', startedAt: 2500, completedAt: null })
    setMessageParts([part(first), part(running)])
    const view = render(
        <ToolRunGroup startIndex={0} endIndex={1}>
            <span>read</span><span>bash</span>
        </ToolRunGroup>
    )

    expect(screen.getByRole('button')).toHaveTextContent('1m 00s')
    expect(screen.getByRole('button')).toHaveTextContent('tool.group.live:')
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByRole('button')).toHaveTextContent('1m 01s')

    setMessageParts([part(first), part(block('Grep')), part(running)])
    view.rerender(
        <ToolRunGroup startIndex={0} endIndex={2}>
            <span>read</span><span>grep</span><span>bash</span>
        </ToolRunGroup>
    )
    expect(screen.getByRole('button')).toHaveTextContent('1m 01s')
})

it('freezes the total when the running group completes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(5000)
    const first = block('Read', { startedAt: 1000, completedAt: 2000 })
    const running = block('Bash', { state: 'running', startedAt: 2500, completedAt: null })
    setMessageParts([part(first), part(running)])
    const view = render(
        <ToolRunGroup startIndex={0} endIndex={1}>
            <span>read</span><span>bash</span>
        </ToolRunGroup>
    )

    setMessageParts([part(first), part(block('Bash', {
        startedAt: 2500,
        completedAt: 7500
    }))])
    view.rerender(
        <ToolRunGroup startIndex={0} endIndex={1}>
            <span>read</span><span>bash</span>
        </ToolRunGroup>
    )
    expect(screen.getByRole('button')).toHaveTextContent('6.5s')
    expect(screen.getByRole('button')).not.toHaveTextContent('tool.group.live:')
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.getByRole('button')).toHaveTextContent('6.5s')
})

it('derives elapsed from timestamps after prepend and remount instead of resetting', () => {
    vi.useFakeTimers()
    vi.setSystemTime(61000)
    const first = block('Read', { startedAt: 1000, completedAt: 2000 })
    const running = block('Bash', { state: 'running', startedAt: 2500, completedAt: null })
    setMessageParts([part(first), part(running)])
    const view = render(
        <ToolRunGroup startIndex={0} endIndex={1}>
            <span>read</span><span>bash</span>
        </ToolRunGroup>
    )
    expect(screen.getByRole('button')).toHaveTextContent('1m 00s')

    setMessageParts([{ type: 'text' }, part(first), part(running)])
    view.rerender(
        <ToolRunGroup startIndex={1} endIndex={2}>
            <span>read</span><span>bash</span>
        </ToolRunGroup>
    )
    expect(screen.getByRole('button')).toHaveTextContent('1m 00s')

    view.unmount()
    vi.setSystemTime(71000)
    render(
        <ToolRunGroup startIndex={1} endIndex={2}>
            <span>read</span><span>bash</span>
        </ToolRunGroup>
    )
    expect(screen.getByRole('button')).toHaveTextContent('1m 10s')
})
```

- [ ] **Step 2: Viết failing test cho scroll cap và 46 activity lossless**

```tsx
it('keeps the header outside a named scroll region and preserves 46 rows in order', () => {
    const tools = Array.from({ length: 46 }, (_, index) => {
        const value = block(index % 2 === 0 ? 'Read' : 'Bash')
        return {
            ...value,
            id: `activity-${index}`,
            tool: { ...value.tool, id: `tool-${index}` }
        }
    })
    setMessageParts(tools.map(part))
    const { container } = render(
        <ToolRunGroup startIndex={0} endIndex={45}>
            {tools.map((tool, index) => (
                <span key={tool.id} data-activity-id={tool.id}>activity-{index}</span>
            ))}
        </ToolRunGroup>
    )

    const group = screen.getByTestId('tool-run-group')
    const header = screen.getByRole('button')
    const scroller = container.querySelector('[data-activity-scroll-region]')
    expect(scroller).toHaveClass(
        'max-h-[min(420px,55vh)]',
        'overflow-y-auto',
        'overscroll-contain'
    )
    expect(scroller?.contains(header)).toBe(false)
    expect(group.querySelector('[aria-live]')).toBeNull()
    expect(group).toHaveClass('max-w-[600px]')
    expect(container.querySelectorAll('[data-activity-id]')).toHaveLength(46)
    expect(Array.from(container.querySelectorAll('[data-activity-id]')).map((node) =>
        node.getAttribute('data-activity-id')
    )).toEqual(tools.map((tool) => tool.id))
})
```

- [ ] **Step 3: Chạy group tests để xác nhận RED**

```bash
bun --cwd web test -- ToolRunGroup.test.tsx
```

Expected: FAIL vì running total đang ẩn, lời gọi model thiếu `now`, chưa có live label/scroll region.

- [ ] **Step 4: Nối shared clock vào group total và thêm live marker trang trí**

Trong `ActivityRun`, thay phần tính duration và status header bằng:

```tsx
const now = useActivityClock(running)
const durationMs = getActivityGroupDurationMs(props.entries, now)
const duration = useFormattedActivityDuration(durationMs)
const statusLabel = t(
    running ? 'tool.group.activitiesRunning' : 'tool.group.activitiesCompleted',
    { count: props.entries.length }
)
```

Trong button, ngay sau `statusLabel`, render marker chỉ khi running:

```tsx
<span className="min-w-0 flex-1 text-xs font-semibold">
    {statusLabel}
    {running ? (
        <span aria-hidden="true" className="activity-live-marker ml-1.5 font-normal">
            · {t('tool.group.live')}
        </span>
    ) : null}
</span>
```

Giữ `aria-describedby` cho total nhưng không thêm `aria-live`, `role="timer"` hoặc live region.

- [ ] **Step 5: Tách body thành scroll viewport, giữ children mounted**

Thay body group bằng:

```tsx
<div
    id={regionId}
    hidden={!open}
    data-activity-scroll-region
    role="region"
    aria-label={statusLabel}
    tabIndex={0}
    className="activity-scroll-region min-w-0 max-h-[min(420px,55vh)] overflow-y-auto overscroll-contain border-t border-[var(--app-border)] p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-link)]"
>
    <ToolRunLayoutProvider now={now}>{props.children}</ToolRunLayoutProvider>
</div>
```

Không bọc thêm map/filter, không dùng conditional `{open ? children : null}`; `hidden` phải tiếp tục giữ DOM nodes mounted.

- [ ] **Step 6: Chạy group/model regression tests**

```bash
bun --cwd web test -- ToolRunGroup.test.tsx toolRunModel.test.ts ToolCard.test.tsx
```

Expected: PASS; nếu snapshot accessible text cũ khác vì running total mới, cập nhật expected theo spec, không nới assertion.

- [ ] **Step 7: Commit group behavior**

```bash
git add web/src/components/ToolCard/ToolRunGroup.tsx \
    web/src/components/ToolCard/ToolRunGroup.test.tsx
git commit -m "feat(web): show live scrollable activity groups"
```

### Task 4: Quiet Intelligence tokens, motion và compact activity rows

**Files:**
- Modify: `web/src/index.css`
- Modify: `web/src/components/ToolCard/ToolRunGroup.tsx`
- Modify: `web/src/components/ToolCard/ToolCard.tsx`
- Modify: `web/src/components/assistant-ui/reasoning.tsx`
- Test: `web/src/components/ToolCard/ToolRunGroup.test.tsx`
- Test: `web/src/components/ToolCard/ToolCard.test.tsx`
- Test: `web/src/components/assistant-ui/reasoning.test.tsx`

**Interfaces:**
- Consumes: `data-activity-group`, `data-activity-scroll-region`, `data-tool-display="group-row"`, `data-reasoning-layout="group-row"`.
- Produces: scoped CSS hooks `processing-surface`, `processing-surface--running`, `activity-scroll-region`, `activity-row`, `activity-orb`.

- [ ] **Step 1: Viết failing class-contract tests cho group/tool/reasoning rows**

Trong các test tương ứng, thêm assertions cụ thể:

```tsx
// ToolRunGroup.test.tsx
expect(screen.getByTestId('tool-run-group')).toHaveClass('processing-surface')
expect(screen.getByTestId('tool-run-group')).toHaveAttribute('data-running', 'true')

// ToolCard.test.tsx, group-row case
expect(container.querySelector('[data-tool-display="group-row"] > div')).toHaveClass(
    'activity-row',
    'min-h-[37px]'
)
expect(container.querySelector('[data-tool-display="group-row"] .activity-orb')).not.toBeNull()
expect(container.querySelector('[data-tool-display="group-row"] .uppercase')).toBeNull()

// reasoning.test.tsx, presentation="group-row"
expect(screen.getByRole('button')).toHaveClass('activity-row', 'min-h-[37px]')
expect(screen.getByRole('button')).not.toHaveClass('uppercase')
```

- [ ] **Step 2: Chạy focused tests để xác nhận RED**

```bash
bun --cwd web test -- ToolRunGroup.test.tsx ToolCard.test.tsx reasoning.test.tsx
```

Expected: FAIL do CSS hooks/density/orb chưa tồn tại.

- [ ] **Step 3: Thêm theme tokens và scoped CSS vào cuối `index.css`**

Thêm tokens light vào `:root`, override dark vào `[data-theme="dark"]`, rồi thêm scoped rules:

```css
/* :root */
--app-tool-neutral-accent: #4f58c9;
--app-tool-neutral-surface: rgba(79, 88, 201, 0.045);
--app-tool-plan-surface: rgba(124, 63, 197, 0.055);
--app-tool-diff-surface: rgba(22, 131, 68, 0.045);
--app-tool-question-accent: #0879b9;
--app-tool-question-border: rgba(8, 121, 185, 0.38);
--app-tool-question-surface: rgba(8, 121, 185, 0.05);
--app-processing-edge: rgba(79, 88, 201, 0.48);
--app-processing-scrollbar: rgba(107, 114, 128, 0.48);

/* [data-theme="dark"] */
--app-tool-neutral-accent: #9aa2ff;
--app-tool-neutral-surface: rgba(108, 117, 255, 0.075);
--app-tool-plan-surface: rgba(191, 90, 242, 0.075);
--app-tool-diff-surface: rgba(48, 209, 88, 0.06);
--app-tool-question-accent: #64d2ff;
--app-tool-question-border: rgba(100, 210, 255, 0.34);
--app-tool-question-surface: rgba(100, 210, 255, 0.055);
--app-processing-edge: rgba(154, 162, 255, 0.58);
--app-processing-scrollbar: rgba(142, 142, 147, 0.58);

.processing-surface {
    position: relative;
    isolation: isolate;
    background-image: linear-gradient(135deg, var(--processing-surface-tint, transparent), transparent 70%);
}

.processing-surface--running::before {
    content: "";
    position: absolute;
    z-index: 1;
    inset: 0 16% auto;
    height: 1px;
    pointer-events: none;
    background: linear-gradient(90deg, transparent, var(--app-processing-edge), transparent);
    animation: processing-edge-breathe 2.8s ease-in-out infinite;
}

.activity-live-marker {
    color: var(--app-tool-neutral-accent);
}

.activity-scroll-region {
    scrollbar-width: thin;
    scrollbar-color: var(--app-processing-scrollbar) transparent;
    -webkit-overflow-scrolling: touch;
}

.activity-scroll-region::-webkit-scrollbar {
    width: 7px;
}

.activity-scroll-region::-webkit-scrollbar-thumb {
    border: 2px solid transparent;
    border-radius: 999px;
    background: var(--app-processing-scrollbar);
    background-clip: padding-box;
}

.activity-row {
    transition: background-color 140ms ease, box-shadow 140ms ease;
}

.activity-row:hover,
.activity-row:focus-within {
    background: var(--app-subtle-bg);
    box-shadow: inset 0 1px 0 var(--app-divider);
}

@keyframes processing-edge-breathe {
    0%, 100% { opacity: 0.34; transform: scaleX(0.72); }
    50% { opacity: 0.82; transform: scaleX(1); }
}

@media (prefers-reduced-motion: reduce) {
    .processing-surface--running::before {
        animation: none;
    }

    .activity-row,
    .processing-card {
        transition: none;
        transform: none !important;
    }
}
```

Màu hard-code chỉ khai báo ở theme tokens, không xuất hiện trong component JSX.

- [ ] **Step 4: Gắn running state và compact group container**

Đổi group root classes/attributes thành:

```tsx
<div
    data-testid="tool-run-group"
    data-tool-run-group
    data-activity-group
    data-running={running ? 'true' : 'false'}
    data-tool-run-id={props.id}
    className={cn(
        'processing-surface my-2 w-full max-w-[600px] min-w-0 overflow-hidden rounded-[15px] border border-[var(--app-border)] bg-[var(--app-secondary-bg)]',
        running && 'processing-surface--running'
    )}
>
```

Giảm header về `min-h-[42px] px-3`; không thay semantic button/ARIA.

- [ ] **Step 5: Làm tool row 37px và thêm orb không đổi thứ tự metadata**

Trong nhánh `group-row` của `ToolCard.tsx`:

```tsx
<div className="activity-row flex min-h-[37px] w-full min-w-0 items-center gap-1 rounded-[11px]">
    <Dialog>
        <DialogTrigger asChild>
            <button
                type="button"
                className="flex min-h-[37px] min-w-0 flex-1 items-center gap-2 rounded-[11px] px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
            >
                <span
                    aria-hidden="true"
                    className="activity-orb grid h-[25px] w-[25px] shrink-0 place-items-center rounded-full bg-[var(--app-tool-neutral-surface)] text-[var(--app-tool-neutral-accent)]"
                >
                    {presentation.icon}
                </span>
                {/* Giữ nguyên toolTitle → subtitle → duration → status */}
```

Output control giữ `min-h-10 min-w-10` để hit target không nhỏ đi. Inline output tiếp tục:

```tsx
className="w-full min-w-0 max-h-[300px] overflow-auto overscroll-contain"
```

- [ ] **Step 6: Đồng bộ reasoning row với tool row**

Trong `ReasoningDisclosure`, chỉ đổi branch group row:

```tsx
className={cn(
    'cursor-pointer select-none items-center gap-1.5 rounded-[11px] px-2 text-xs font-medium text-[var(--app-hint)] transition-colors hover:text-[var(--app-fg)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]',
    groupRow ? 'activity-row flex min-h-[37px] w-full text-left' : 'inline-flex min-h-8'
)}
```

Giữ nguyên `isOpen`, `aria-expanded`, markdown body và streaming auto-open.

- [ ] **Step 7: Chạy focused regression tests**

```bash
bun --cwd web test -- ToolRunGroup.test.tsx ToolCard.test.tsx reasoning.test.tsx ReasoningMessagePart.test.tsx AssistantMessage.integration.test.tsx
```

Expected: PASS; every ID/order and expansion behavior remains unchanged.

- [ ] **Step 8: Commit activity visual system**

```bash
git add web/src/index.css \
    web/src/components/ToolCard/ToolRunGroup.tsx \
    web/src/components/ToolCard/ToolCard.tsx \
    web/src/components/assistant-ui/reasoning.tsx \
    web/src/components/ToolCard/ToolRunGroup.test.tsx \
    web/src/components/ToolCard/ToolCard.test.tsx \
    web/src/components/assistant-ui/reasoning.test.tsx
git commit -m "feat(web): style compact activity groups"
```

### Task 5: Standalone premium shell, tone orbs và action surfaces

**Files:**
- Modify: `web/src/components/ToolCard/ToolCard.tsx`
- Modify: `web/src/components/ToolCard/PermissionFooter.tsx`
- Modify: `web/src/index.css`
- Test: `web/src/components/ToolCard/ToolCard.test.tsx`
- Test: `web/src/components/ToolCard/PermissionFooter.test.tsx`

**Interfaces:**
- Consumes: `presentation.tone`, `isQuestionTool`, `hasPendingApproval` và hiện trạng footer callbacks.
- Produces: `surfaceTone: 'neutral' | 'plan' | 'diff' | 'question' | 'permission' | 'error'`; shared `processing-card` shell tối đa 600px; compact Plan progress metadata.

- [ ] **Step 1: Viết failing shell/tone tests cho đủ card families**

Thêm vào `ToolCard.test.tsx`:

```tsx
it.each([
    ['Read', 'neutral'],
    ['mcp__server__tool', 'neutral'],
    ['Task', 'neutral'],
    ['Agent', 'neutral'],
    ['Skill', 'neutral'],
    ['update_plan', 'plan'],
    ['CodexDiff', 'diff'],
    ['Read', 'error'],
    ['AskUserQuestion', 'question'],
    ['request_user_input', 'question']
] as const)('uses the premium standalone shell for %s', (name, tone) => {
    const overrides = tone === 'error' ? { state: 'error' as const } : {}
    const { container } = renderTool(makeToolBlock(
        name,
        name.includes('Question') ? { questions: [] } : {},
        undefined,
        overrides
    ))
    const card = container.querySelector(`[data-tool-surface="${tone}"]`)
    expect(card).toHaveClass(
        'processing-card',
        'w-full',
        'max-w-[600px]',
        'rounded-[15px]'
    )
    expect(card?.querySelector('.processing-card__orb')).not.toBeNull()
})

it('keeps pending approval amber instead of the underlying diff tone', () => {
    const { container } = renderTool(makeToolBlock('Write', {}, pendingPermission))
    expect(container.querySelector('[data-tool-surface="permission"]')).not.toBeNull()
    expect(container.querySelector('[data-tool-surface="diff"]')).toBeNull()
})

it('shows compact plan progress in the header without removing the checklist', () => {
    renderTool(makeToolBlock('update_plan', {
        plan: [
            { step: 'Done', status: 'completed' },
            { step: 'Next', status: 'pending' }
        ]
    }))

    expect(screen.getByText('50% · 1/2')).toHaveAccessibleName('1 / 2 steps')
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('Next')).toBeInTheDocument()
})
```

- [ ] **Step 2: Giữ exact payload regression tests cho permission**

Trong footer tests, assert exact calls; không mock bỏ payload:

```tsx
expect(api.approvePermission).toHaveBeenCalledWith(
    'session-1',
    'permission-1',
    { decision: 'approved_for_session' }
)
expect(api.denyPermission).toHaveBeenCalledWith(
    'session-1',
    'permission-1',
    { decision: 'abort' }
)
```

Giữ các assertions hiện có cho Claude `acceptEdits` và `{ allowTools: [...] }`. Chỉ bổ sung class assertion:

```tsx
expect(screen.getByRole('button', { name: /^Allow$/i })).toHaveClass(
    'rounded-full',
    'min-h-10'
)
```

- [ ] **Step 3: Chạy focused tests để xác nhận RED mà payload tests vẫn GREEN**

```bash
bun --cwd web test -- ToolCard.test.tsx PermissionFooter.test.tsx
```

Expected: shell/tone/pill class tests FAIL; existing RPC/payload assertions PASS.

- [ ] **Step 4: Mở rộng tone map và dựng standalone shell**

Trong `ToolCard.tsx`, dùng type suy ra từ constant:

```ts
const SURFACE_CLASS = {
    neutral: '[--processing-surface-tint:var(--app-tool-neutral-surface)] border-[var(--app-border)]',
    plan: '[--processing-surface-tint:var(--app-tool-plan-surface)] border-[var(--app-tool-plan-border)]',
    diff: '[--processing-surface-tint:var(--app-tool-diff-surface)] border-[var(--app-tool-diff-border)]',
    question: '[--processing-surface-tint:var(--app-tool-question-surface)] border-[var(--app-tool-question-border)]',
    permission: '[--processing-surface-tint:var(--app-tool-attention-bg)] border-[var(--app-tool-attention-border)]',
    error: '[--processing-surface-tint:var(--app-badge-error-bg)] border-[var(--app-badge-error-border)]'
} as const

const ORB_CLASS = {
    neutral: 'bg-[var(--app-tool-neutral-surface)] text-[var(--app-tool-neutral-accent)]',
    plan: 'bg-[var(--app-tool-plan-surface)] text-[var(--app-tool-plan-accent)]',
    diff: 'bg-[var(--app-tool-diff-surface)] text-[var(--app-tool-diff-accent)]',
    question: 'bg-[var(--app-tool-question-surface)] text-[var(--app-tool-question-accent)]',
    permission: 'bg-[var(--app-tool-attention-bg)] text-[var(--app-tool-attention-accent)]',
    error: 'bg-[var(--app-badge-error-bg)] text-[var(--app-badge-error-text)]'
} as const
```

Tính tone không đổi registry/provider title:

```ts
const surfaceTone = props.block.tool.state === 'error'
    ? 'error'
    : hasPendingApproval
        ? 'permission'
        : isQuestionTool
            ? 'question'
            : presentation.tone
```

Import các helper checklist sẵn có và suy ra header progress mà không sửa input/result:

```ts
import {
    extractTodoChecklist,
    extractUpdatePlanChecklist,
    getChecklistProgress
} from '@/components/ToolCard/checklist'

const planItems = toolName === 'update_plan'
    ? extractUpdatePlanChecklist(props.block.tool.input, props.block.tool.result)
    : toolName === 'TodoWrite'
        ? extractTodoChecklist(props.block.tool.input, props.block.tool.result)
        : []
const planProgress = planItems.length > 0 ? getChecklistProgress(planItems) : null
```

Render ngay trước `ElapsedView` trong vùng metadata phải:

```tsx
{planProgress ? (
    <span
        aria-label={t('tool.stepsProgress', {
            completed: planProgress.completed,
            total: planProgress.total
        })}
        className="shrink-0 font-mono text-[11px] text-[var(--app-tool-plan-accent)]"
    >
        {planProgress.percent}% · {planProgress.completed}/{planProgress.total}
    </span>
) : null}
```

Đổi outer Card và orb:

```tsx
<Card
    data-tool-surface={surfaceTone}
    data-tool-block-id={props.block.id}
    className={cn(
        'processing-card processing-surface w-full max-w-[600px] overflow-hidden rounded-[15px] border bg-[var(--app-secondary-bg)] shadow-none',
        props.block.tool.state === 'running' && 'processing-surface--running',
        SURFACE_CLASS[surfaceTone]
    )}
>
```

```tsx
<div className={cn(
    'processing-card__orb grid h-[31px] w-[31px] shrink-0 place-items-center rounded-full leading-none',
    ORB_CLASS[surfaceTone]
)}>
```

Đổi header `p-3` thành `px-3 py-2.5`; trigger vẫn full semantic button và giữ focus helpers.

- [ ] **Step 5: Thêm hover lift chỉ cho pointer device và reduced motion đã có**

Thêm vào `index.css`:

```css
.processing-card {
    transition: transform 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
}

@media (hover: hover) and (pointer: fine) {
    .processing-card:hover {
        transform: translateY(-1px);
        box-shadow: 0 8px 24px color-mix(in srgb, var(--app-fg) 7%, transparent);
    }
}
```

- [ ] **Step 6: Làm gọn permission action tray mà không đổi handlers**

Trong `PermissionRowButton`, chỉ thay base class; không chạm `approve*`, `deny`, `codexApprove`, `codexAbort`:

```ts
const base = 'inline-flex min-h-10 min-w-[7rem] flex-1 items-center justify-center gap-2 rounded-full px-3.5 py-1.5 text-center text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]'
```

Đổi permission action container thành `mt-2.5 flex flex-wrap gap-1.5`. Không sửa `AskUserQuestionFooter` hoặc `RequestUserInputFooter`; question visual tone đến từ outer premium shell, còn inputs, validation, button hit target, navigation và API calls giữ nguyên tuyệt đối.

- [ ] **Step 7: Chạy card/action regressions**

```bash
bun --cwd web test -- ToolCard.test.tsx PermissionFooter.test.tsx checklist.test.tsx
```

Expected: PASS, gồm Plan checklist/progress, question answers và exact permission payload.

- [ ] **Step 8: Commit standalone cards**

```bash
git add web/src/components/ToolCard/ToolCard.tsx \
    web/src/components/ToolCard/PermissionFooter.tsx \
    web/src/index.css \
    web/src/components/ToolCard/ToolCard.test.tsx \
    web/src/components/ToolCard/PermissionFooter.test.tsx
git commit -m "feat(web): redesign standalone processing cards"
```

### Task 6: End-to-end regression, visual QA và scope audit

**Files:**
- Modify only if a failing assertion identifies a defect: files already listed in Tasks 1–5.
- Verify: `docs/superpowers/specs/2026-07-18-premium-processing-cards-design.md`
- Reference: `docs/superpowers/artifacts/2026-07-18-premium-processing-cards-mockup.html`

**Interfaces:**
- Consumes: all deliverables Tasks 1–5.
- Produces: verified Web-only diff with test/build/visual evidence; no new runtime interface.

- [ ] **Step 1: Chạy toàn bộ Web tests**

```bash
bun --cwd web test
```

Expected: PASS toàn bộ suite; không skip/delete test để lấy GREEN.

- [ ] **Step 2: Chạy strict typecheck, production build và whitespace check**

```bash
bun --cwd web typecheck
bun run build:web
git diff --check
```

Expected: cả ba command exit 0; Vite tạo production bundle không lỗi.

- [ ] **Step 3: Audit phạm vi diff**

```bash
git diff --name-only 10044e4...HEAD
git diff --stat 10044e4...HEAD
git diff 10044e4...HEAD -- \
    shared cli hub
```

Expected: command cuối không có output; runtime files chỉ nằm trong `web/src/components/ToolCard`, `web/src/components/assistant-ui/reasoning.tsx`, `web/src/index.css`, ba locale và tests liên quan.

- [ ] **Step 4: Chạy app và kiểm tra trực quan theo mockup ở dark/light**

```bash
bun run dev
```

Trong browser desktop và mobile viewport, kiểm tra đúng các tình huống sau:

```text
1. Running group > 10 rows: header đứng yên, body cuộn, total tăng mỗi giây.
2. Append activity: count tăng, elapsed không reset; complete: elapsed đóng băng.
3. Group 46 rows: mọi title/output còn đủ và đúng thứ tự; Terminal/Diff output cuộn riêng ở 300px.
4. Neutral/Plan/Diff/Question/Permission: cùng max-width 600px, compact shell, orb đúng tone.
5. Permission buttons: label dễ đọc ở light/dark, click gửi cùng payload như trước.
6. Keyboard: group disclosure, scroll region, output toggle, dialog, permission/question actions đều focus được.
7. Reduced motion: bật prefers-reduced-motion, ambient edge/pulse/lift dừng.
8. Provider title, command và system labels dùng natural case; không có text bị đen trùng nền.
```

So sánh hierarchy/density/motion với `docs/superpowers/artifacts/2026-07-18-premium-processing-cards-mockup.html`; không hard-code nội dung ví dụ từ artifact.

- [ ] **Step 5: Chạy final focused regression sau mọi visual correction**

```bash
bun --cwd web test -- ToolRunGroup.test.tsx ToolCard.test.tsx toolRunModel.test.ts reasoning.test.tsx PermissionFooter.test.tsx checklist.test.tsx
bun --cwd web typecheck
bun run build:web
git diff --check
```

Expected: tất cả exit 0.

- [ ] **Step 6: Commit verification-only corrections nếu có**

Nếu Step 4 không cần sửa code thì không tạo empty commit. Nếu có sửa presentation để khớp mockup, chỉ stage đúng file đã sửa:

```bash
git add web/src
git commit -m "fix(web): align processing cards with approved design"
```

## Acceptance Evidence Checklist

- [ ] `getActivityGroupDurationMs(entries, now)` chứng minh running dùng first-start-to-now và completed dùng first-start-to-last-completion.
- [ ] Running elapsed tăng qua hai tick, append không reset, completion freeze.
- [ ] Invalid/missing timestamps ẩn total; generic reasoning boundary timing không bị suy đoán.
- [ ] Compact/accessible format pass ở `<0.1s`, seconds, minutes/seconds, hours/minutes và ba locale.
- [ ] Header ngoài scroll body; 46 activity tồn tại đúng một lần, đúng thứ tự.
- [ ] Group/standalone max-width 600px; Terminal/Diff output max-height 300px.
- [ ] Natural-case, keyboard, focus-visible, light/dark và reduced-motion đã kiểm tra.
- [ ] Permission/question payload và Plan/Diff/Apply Changes/Terminal renderer regression pass.
- [ ] Full Web tests, typecheck, production build và `git diff --check` pass.
- [ ] Diff audit không có thay đổi ở `shared`, `cli`, `hub`, API/database/persistence.
