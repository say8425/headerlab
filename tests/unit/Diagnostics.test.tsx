// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DiagnosticRow } from '@/components/DiagnosticRow';
import { DiagnosticBand } from '@/components/DiagnosticBand';
import type { Diagnostic } from '@/lib/model/types';

function diag(over: Partial<Diagnostic> = {}): Diagnostic {
  return { kind: 'empty-filter', severity: 'warning', profileId: 'p1', message: 'm', ...over };
}

describe('DiagnosticRow', () => {
  it('renders nothing at all when there is nothing to say', () => {
    const { container } = render(<DiagnosticRow diagnostics={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows the message', () => {
    render(<DiagnosticRow diagnostics={[diag({ message: 'Header name is empty.' })]} />);
    expect(screen.getByText('Header name is empty.')).toBeTruthy();
  });

  it('shows one line per diagnostic when a row has several', () => {
    render(<DiagnosticRow diagnostics={[diag({ message: 'one' }), diag({ message: 'two' })]} />);
    expect(screen.getAllByTestId('diagnostic-line')).toHaveLength(2);
  });

  it('marks severity so the palette can colour it', () => {
    render(<DiagnosticRow diagnostics={[diag({ severity: 'error', message: 'e' })]} />);
    expect(screen.getByTestId('diagnostic-line').getAttribute('data-severity')).toBe('error');
  });
});

describe('DiagnosticBand', () => {
  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<DiagnosticBand diagnostics={[]} onGrant={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows a Grant button only for permission-missing', () => {
    // `host` is set here too, on an otherwise Grant-eligible-looking fixture —
    // without it, "no button rendered" would be true for the wrong reason
    // (missing host) rather than the one this test claims to guard (wrong kind).
    render(
      <DiagnosticBand
        diagnostics={[diag({ kind: 'empty-filter', host: 'x.com', message: 'no domain' })]}
        onGrant={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /Grant/ })).toBeNull();
  });

  it('offers Grant for a missing permission and passes the host', async () => {
    const onGrant = vi.fn();
    render(
      <DiagnosticBand
        diagnostics={[diag({
          kind: 'permission-missing',
          host: 'api.example.com',
          message: 'HeaderLab needs permission for api.example.com. The rule is registered but will not apply until you grant it.',
        })]}
        onGrant={onGrant}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Grant/ }));
    expect(onGrant).toHaveBeenCalledTimes(1);
    expect(onGrant).toHaveBeenCalledWith('api.example.com');
  });

  it('shows every profile-level diagnostic, not just the first', () => {
    render(
      <DiagnosticBand
        diagnostics={[diag({ message: 'one' }), diag({ kind: 'port-ignored', message: 'two' })]}
        onGrant={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId('band-line')).toHaveLength(2);
  });
});
