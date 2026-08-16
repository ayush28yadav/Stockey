import { useCallback, useRef } from 'react';
import { Check, X } from 'lucide-react';
import styles from './Toast.module.css';

export function Toast({ toast, close }) {
  if (!toast) return null;
  return <div className={`${styles.toast} ${toast.tone === 'error' ? styles.error : ''}`}>
    <span>{toast.tone === 'success' ? <Check size={18} /> : <X size={18} />}</span>
    {toast.text}
    <button aria-label="Dismiss message" onClick={close}><X size={16} /></button>
  </div>;
}

export function useToast() {
  const handlersRef = useRef([]);

  const closeToast = useCallback(() => {
    handlersRef.current.forEach((handler) => {
      window.removeEventListener('click', handler);
      window.removeEventListener('keydown', handler);
    });
    handlersRef.current = [];
  }, []);

  const showToast = useCallback((text, tone = 'success') => {
    const toast = { text, tone };
    const handler = () => closeToast();
    handlersRef.current.push(handler);
    window.addEventListener('click', handler, { once: true });
    window.addEventListener('keydown', handler, { once: true });
    return toast;
  }, [closeToast]);

  return { showToast, closeToast };
}
