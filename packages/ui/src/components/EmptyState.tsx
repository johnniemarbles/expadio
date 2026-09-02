import React from "react";
import styles from "./EmptyState.module.css";

export interface EmptyStateAction {
  readonly label: string;
  readonly onClick?: (() => void) | undefined;
  readonly href?: string | undefined;
}

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: string | undefined;
  readonly icon?: React.ReactNode | undefined;
  readonly primaryAction?: EmptyStateAction | undefined;
  readonly secondaryAction?: EmptyStateAction | undefined;
  readonly className?: string | undefined;
}

export function EmptyState({
  title,
  description,
  icon,
  primaryAction,
  secondaryAction,
  className = "",
}: EmptyStateProps) {
  return (
    <div className={`${styles.container} ${className}`} role="status">
      {icon && <div className={styles.iconWrapper} aria-hidden="true">{icon}</div>}
      <h3 className={styles.title}>{title}</h3>
      {description && <p className={styles.description}>{description}</p>}
      {(primaryAction || secondaryAction) && (
        <div className={styles.actions}>
          {primaryAction && (
            primaryAction.href ? (
              <a href={primaryAction.href} className={styles.primaryButton}>{primaryAction.label}</a>
            ) : (
              <button type="button" onClick={primaryAction.onClick} className={styles.primaryButton}>{primaryAction.label}</button>
            )
          )}
          {secondaryAction && (
            secondaryAction.href ? (
              <a href={secondaryAction.href} className={styles.secondaryButton}>{secondaryAction.label}</a>
            ) : (
              <button type="button" onClick={secondaryAction.onClick} className={styles.secondaryButton}>{secondaryAction.label}</button>
            )
          )}
        </div>
      )}
    </div>
  );
}
