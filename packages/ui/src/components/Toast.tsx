"use client";
import React, { createContext, useContext, useState, useCallback, useMemo } from "react";
import styles from "./Toast.module.css";

export type ToastType = "info" | "success" | "warning" | "error";

export interface Toast {
  readonly id: string;
  readonly type: ToastType;
  readonly title: string;
  readonly message?: string | undefined;
  readonly durationMs?: number | undefined;
}

interface ToastContextValue {
  readonly show: (toast: Omit<Toast, "id">) => string;
  readonly success: (title: string, message?: string) => string;
  readonly error: (title: string, message?: string) => string;
  readonly warning: (title: string, message?: string) => string;
  readonly info: (title: string, message?: string) => string;
  readonly dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (toast: Omit<Toast, "id">): string => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const item: Toast = { ...toast, id };
      setToasts((prev) => [...prev, item]);

      const duration = toast.durationMs ?? 4000;
      if (duration > 0) {
        setTimeout(() => {
          dismiss(id);
        }, duration);
      }
      return id;
    },
    [dismiss]
  );

  const success = useCallback((title: string, message?: string) => show({ type: "success", title, ...(message !== undefined ? { message } : {}) }), [show]);
  const error = useCallback((title: string, message?: string) => show({ type: "error", title, ...(message !== undefined ? { message } : {}) }), [show]);
  const warning = useCallback((title: string, message?: string) => show({ type: "warning", title, ...(message !== undefined ? { message } : {}) }), [show]);
  const info = useCallback((title: string, message?: string) => show({ type: "info", title, ...(message !== undefined ? { message } : {}) }), [show]);

  const value = useMemo(() => ({ show, success, error, warning, info, dismiss }), [show, success, error, warning, info, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.toastContainer} role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((toast) => {
          const typeClass =
            toast.type === "success" ? styles.toastSuccess :
            toast.type === "error" ? styles.toastError :
            toast.type === "warning" ? styles.toastWarning : styles.toastInfo;
          const icon =
            toast.type === "success" ? "✓" :
            toast.type === "error" ? "✕" :
            toast.type === "warning" ? "!" : "i";
          return (
            <div key={toast.id} className={`${styles.toastItem} ${typeClass}`} role="alert">
              <span className={styles.toastIcon} aria-hidden="true">{icon}</span>
              <div className={styles.toastBody}>
                <h4 className={styles.toastTitle}>{toast.title}</h4>
                {toast.message && <p className={styles.toastMessage}>{toast.message}</p>}
              </div>
              <button type="button" className={styles.toastClose} onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
                ×
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      show: () => "",
      success: () => "",
      error: () => "",
      warning: () => "",
      info: () => "",
      dismiss: () => {},
    };
  }
  return ctx;
}
