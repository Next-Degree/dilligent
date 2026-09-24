import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  AccessProvenanceBadge,
  AccessScopeNotice,
} from './AccessProvenanceNotice';

describe('AccessScopeNotice', () => {
  it('says the list is tailored when access has been observed', () => {
    render(<AccessScopeNotice scopedToObservedAccess />);

    expect(screen.getByText(/vendors this person has authorized/i)).toBeInTheDocument();
  });

  it('warns that nothing is scoped when no observation exists', () => {
    // Presenting the whole register as if it were tailored would invite someone to tick
    // off vendors nobody actually checked.
    render(<AccessScopeNotice scopedToObservedAccess={false} />);

    expect(screen.getByText(/No observed access data is available/i)).toBeInTheDocument();
    expect(screen.getByText(/every vendor is listed/i)).toBeInTheDocument();
  });

  it('tells the reviewer other apps may be missing', () => {
    // Only Google sign-ins are observable, so the scoped list is not exhaustive.
    render(<AccessScopeNotice scopedToObservedAccess />);

    expect(screen.getByText(/signed into another way will not appear/i)).toBeInTheDocument();
  });

  it('renders nothing when the API did not report a mode', () => {
    // Older responses have no field; a missing value must not be read as "unscoped".
    const { container } = render(<AccessScopeNotice />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('AccessProvenanceBadge', () => {
  it('marks a row that came from observed access', () => {
    render(<AccessProvenanceBadge provenance="observed" />);

    expect(screen.getByText('Observed')).toBeInTheDocument();
  });

  it('marks a row kept only because it was already revoked', () => {
    render(<AccessProvenanceBadge provenance="revoked-previously" />);

    expect(screen.getByText('Previously revoked')).toBeInTheDocument();
  });

  it('renders nothing in full-register mode, where every row is the same', () => {
    const { container } = render(<AccessProvenanceBadge provenance="full-register" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when provenance is absent', () => {
    const { container } = render(<AccessProvenanceBadge />);

    expect(container).toBeEmptyDOMElement();
  });
});
