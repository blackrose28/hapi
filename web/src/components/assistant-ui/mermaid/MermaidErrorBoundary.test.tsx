import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { MermaidErrorBoundary } from './MermaidErrorBoundary'

function Thrower(): never { throw new Error('boom') }

describe('MermaidErrorBoundary', () => {
    it('isolates a block and resets on source change', () => {
        function Harness() {
            const [key, setKey] = useState('old')
            return <>
                <button onClick={() => setKey('new')}>reset</button>
                <MermaidErrorBoundary resetKey={key} fallback={<pre>source fallback</pre>}>
                    {key === 'old' ? <Thrower /> : <div>preview restored</div>}
                </MermaidErrorBoundary>
            </>
        }
        render(<Harness />)
        expect(screen.getByText('source fallback')).toBeInTheDocument()
        fireEvent.click(screen.getByText('reset'))
        expect(screen.getByText('preview restored')).toBeInTheDocument()
    })
})
