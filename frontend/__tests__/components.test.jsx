import { describe, it, expect } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { renderHook } from '@testing-library/react';

import { IconButton, Badge, EmptyState } from '../src/components/IconButton.jsx';
import { Brand } from '../src/components/Brand.jsx';
import { usePath } from '../src/hooks/usePath.jsx';
import { ErrorBoundary } from '../src/components/ErrorBoundary.jsx';

describe('IconButton', () => {
  it('renders a button with aria-label', () => {
    render(<IconButton label="test"><span>X</span></IconButton>);
    expect(document.querySelector('button[aria-label="test"]')).toBeTruthy();
  });
});

describe('Badge', () => {
  it('renders children with default tone', () => {
    render(<Badge>Test</Badge>);
    expect(document.querySelector('.badge')).toBeTruthy();
    expect(document.querySelector('.badge.neutral')).toBeTruthy();
  });
});

describe('EmptyState', () => {
  it('renders title and detail', () => {
    render(<EmptyState title="No data" detail="Check back later" />);
    expect(screen.getByText('No data')).toBeTruthy();
    expect(screen.getByText('Check back later')).toBeTruthy();
  });
});

describe('Brand', () => {
  it('renders brand mark', () => {
    render(<Brand />);
    expect(document.querySelector('.brand')).toBeTruthy();
  });
});

describe('usePath', () => {
  it('returns current pathname and navigate function', () => {
    const { result } = renderHook(() => usePath());
    expect(result.current[0]).toBe('/');
  });
});

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(<ErrorBoundary><div>OK</div></ErrorBoundary>);
    expect(screen.getByText('OK')).toBeTruthy();
  });

  it('renders fallback on error', () => {
    const BadComponent = () => { throw new Error('boom'); };
    render(<ErrorBoundary fallback={<div>Error</div>}><BadComponent /></ErrorBoundary>);
    expect(screen.getByText('Error')).toBeTruthy();
  });
});
