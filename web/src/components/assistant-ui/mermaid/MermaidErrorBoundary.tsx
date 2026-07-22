import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { resetKey: string; fallback: ReactNode; children: ReactNode }
type State = { failed: boolean }

export class MermaidErrorBoundary extends Component<Props, State> {
    state: State = { failed: false }

    static getDerivedStateFromError(): State {
        return { failed: true }
    }

    componentDidCatch(_error: Error, _info: ErrorInfo): void {
        // Intentionally do not log diagram source or render children.
    }

    componentDidUpdate(previous: Props): void {
        if (this.state.failed && previous.resetKey !== this.props.resetKey) {
            this.setState({ failed: false })
        }
    }

    render(): ReactNode {
        return this.state.failed ? this.props.fallback : this.props.children
    }
}
