import { Activity } from 'lucide-react';

export function IconButton({ label, children, ...props }) {
  return <button className="icon-button" type="button" aria-label={label} title={label} {...props}>{children}</button>;
}

export function Badge({ children, tone = 'neutral' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function EmptyState({ title, detail }) {
  return <div className="empty-state"><Activity size={20} /><strong>{title}</strong><span>{detail}</span></div>;
}
