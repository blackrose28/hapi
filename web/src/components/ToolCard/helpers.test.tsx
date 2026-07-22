import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TaskStateIcon } from './helpers'

describe('TaskStateIcon', () => {
    it('disables the running pulse when reduced motion is requested', () => {
        const { container } = render(<TaskStateIcon state="running" />)

        expect(container.firstChild).toHaveClass(
            'animate-pulse',
            'motion-reduce:animate-none'
        )
    })
})
