import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'quiet' | 'danger';
  size?: 'sm' | 'md' | 'lg';
};
export function Button({ variant = 'primary', size = 'md', className = '', type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={`tk-button tk-button--${variant} tk-button--${size} ${className}`} {...props} />;
}
export function IconButton({ 'aria-label': label, ...props }: ButtonProps & { 'aria-label': string }) {
  return <Button variant="quiet" {...props} aria-label={label} className={`tk-icon-button ${props.className ?? ''}`} />;
}
export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`tk-card ${className}`} {...props} />;
}
export function Row({ icon, title, subtitle, trailing, actions, className = '', ...props }: Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  icon?: ReactNode; title: ReactNode; subtitle?: ReactNode; trailing?: ReactNode; actions?: ReactNode;
}) {
  return <div className={`tk-row ${className}`} {...props}>
    {icon && <span className="tk-row-icon">{icon}</span>}
    <div className="tk-row-content"><div>{title}</div>{subtitle && <div className="tk-row-subtitle">{subtitle}</div>}</div>
    {trailing && <div>{trailing}</div>}{actions && <div className="tk-row-actions">{actions}</div>}
  </div>;
}
export function Pill({ className = '', ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={`tk-pill ${className}`} {...props} />;
}
export function EmptyState({ title, children, action, ...props }: Omit<HTMLAttributes<HTMLElement>, 'title'> & { title: string; action?: ReactNode }) {
  return <section {...props} className={`tk-empty-state ${props.className ?? ''}`}><h3>{title}</h3>{children && <div>{children}</div>}{action}</section>;
}
/** Non-modal disclosure: Tab follows document order; Escape/outside click dismiss. */
export function Popover({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const first = panel.current?.querySelector<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]');
    (first ?? panel.current)?.focus();
    const close = () => { setOpen(false); trigger.current?.focus(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    };
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside); };
  }, [open]);
  return <div ref={root} className="tk-popover">
    <button type="button" className="tk-button tk-button--quiet tk-button--md" ref={trigger} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog" onClick={() => setOpen(!open)}>{label}</button>
    {open && <div ref={panel} id={id} role="dialog" aria-label={label} tabIndex={-1} className="tk-popover-panel">{children}</div>}
  </div>;
}
