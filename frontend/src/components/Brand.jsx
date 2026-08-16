import { TrendingUp } from 'lucide-react';

export function Brand({ compact = false }) {
  return <div className="brand"><span className="brand-mark"><TrendingUp size={18} strokeWidth={2.7} /></span>{!compact && <span>stockey</span>}</div>;
}
