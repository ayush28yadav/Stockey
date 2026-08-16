import { Component } from 'react';
import styles from './ErrorBoundary.module.css';

export class ErrorBoundary extends Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('Stockey ErrorBoundary caught an error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className={styles.errorBoundary}>
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message || 'An unexpected error occurred.'}</p>
          <button onClick={() => this.setState({ hasError: false, error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
