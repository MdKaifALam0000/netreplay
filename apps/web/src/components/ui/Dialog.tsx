import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  isConfirmLoading?: boolean;
  confirmVariant?: 'primary' | 'danger';
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl';
}

export const Dialog: React.FC<DialogProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  isConfirmLoading = false,
  confirmVariant = 'primary',
  maxWidth = 'md',
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxWidths = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className={twMerge(
          clsx(
            'w-full bg-surface-raised border border-surface-border rounded-xl shadow-2xl overflow-hidden',
            maxWidths[maxWidth]
          )
        )}
        role="dialog"
        aria-modal="true"
      >
        <div className="px-6 py-4 border-b border-surface-border flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
            {description && <p className="text-xs text-zinc-400 mt-1">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 p-1 rounded-lg hover:bg-zinc-800 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">{children}</div>

        {(onConfirm || cancelLabel) && (
          <div className="px-6 py-3.5 bg-surface border-t border-surface-border flex items-center justify-end gap-3">
            {cancelLabel && (
              <Button variant="outline" size="sm" onClick={onClose} disabled={isConfirmLoading}>
                {cancelLabel}
              </Button>
            )}
            {onConfirm && confirmLabel && (
              <Button
                variant={confirmVariant}
                size="sm"
                onClick={onConfirm}
                isLoading={isConfirmLoading}
              >
                {confirmLabel}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
