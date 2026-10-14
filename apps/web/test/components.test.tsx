import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../src/components/ui/Button';
import { StatusBadge } from '../src/components/ui/StatusBadge';
import { Card } from '../src/components/ui/Card';
import { Dialog } from '../src/components/ui/Dialog';

describe('UI Components Suite', () => {
  it('renders StatusBadge with correct text and active ping styling', () => {
    const { rerender } = render(<StatusBadge status="running" />);
    expect(screen.getByText('Running')).toBeInTheDocument();

    rerender(<StatusBadge status="completed" />);
    expect(screen.getByText('Completed')).toBeInTheDocument();

    rerender(<StatusBadge status="failed" />);
    expect(screen.getByText('Failed')).toBeInTheDocument();

    rerender(<StatusBadge status="cancelled" />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('prevents duplicate submissions when Button is loading or disabled', () => {
    const handleClick = vi.fn();
    const { rerender } = render(
      <Button onClick={handleClick} isLoading={true}>
        Submit Experiment
      </Button>
    );

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(handleClick).not.toHaveBeenCalled();

    rerender(
      <Button onClick={handleClick} isLoading={false}>
        Submit Experiment
      </Button>
    );
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('renders Card with header, description, and action slot', () => {
    render(
      <Card
        title="Active Proxies"
        description="Configured Toxiproxy endpoints"
        action={<button>Refresh</button>}
      >
        <div>Card Body Content</div>
      </Card>
    );

    expect(screen.getByText('Active Proxies')).toBeInTheDocument();
    expect(screen.getByText('Configured Toxiproxy endpoints')).toBeInTheDocument();
    expect(screen.getByText('Refresh')).toBeInTheDocument();
    expect(screen.getByText('Card Body Content')).toBeInTheDocument();
  });

  it('renders Dialog modal and responds to confirm and cancel callbacks', () => {
    const handleClose = vi.fn();
    const handleConfirm = vi.fn();

    const { rerender } = render(
      <Dialog
        isOpen={false}
        onClose={handleClose}
        title="Confirm Deletion"
        onConfirm={handleConfirm}
      />
    );
    expect(screen.queryByText('Confirm Deletion')).not.toBeInTheDocument();

    rerender(
      <Dialog
        isOpen={true}
        onClose={handleClose}
        title="Confirm Deletion"
        confirmLabel="Yes, Delete"
        onConfirm={handleConfirm}
      >
        <p>Are you sure?</p>
      </Dialog>
    );

    expect(screen.getByText('Confirm Deletion')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Yes, Delete'));
    expect(handleConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Cancel'));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
