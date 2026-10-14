import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({
  className,
  title,
  description,
  action,
  children,
  ...props
}) => {
  return (
    <div
      className={twMerge(
        clsx(
          'bg-surface-raised rounded-xl border border-surface-border shadow-sm overflow-hidden',
          className
        )
      )}
      {...props}
    >
      {(title || description || action) && (
        <div className="px-5 py-4 border-b border-surface-border flex items-start justify-between gap-4">
          <div>
            {title && <h3 className="text-base font-semibold text-zinc-100">{title}</h3>}
            {description && <p className="text-xs text-zinc-400 mt-1">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
};
