import { Component, type ComponentType, type ErrorInfo, type PropsWithChildren, type ReactNode } from 'react'

type FallbackComponent = ComponentType<{ error: Error; resetError: () => void }>

type ErrorBoundaryProps = PropsWithChildren<{
  fallback?: FallbackComponent | ReactNode
}>

type ErrorBoundaryState = {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
    // Local boundary only; lean builds do not report remote RUM events.
  }

  resetError = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) {
      return this.props.children
    }

    const { fallback } = this.props
    if (!fallback) {
      return null
    }

    if (typeof fallback === 'function') {
      const Fallback = fallback
      return <Fallback error={error} resetError={this.resetError} />
    }

    return fallback
  }
}
