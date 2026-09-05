import React, { useState, useRef, useEffect, useCallback } from 'react';
import styles from './GovernedSelect.module.css';

export interface GovernedSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface GovernedSelectProps {
  options: GovernedSelectOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  className?: string;
  style?: React.CSSProperties;
  required?: boolean;
  id?: string;
}

export const GovernedSelect: React.FC<GovernedSelectProps> = ({
  options,
  value: controlledValue,
  defaultValue = '',
  onChange,
  placeholder = 'Select option...',
  disabled = false,
  name,
  className,
  style,
  id
}) => {
  const [internalValue, setInternalValue] = useState<string>(controlledValue ?? defaultValue);
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const isControlled = controlledValue !== undefined;
  const currentValue = isControlled ? controlledValue : internalValue;

  const selectedOption = options.find((opt) => opt.value === currentValue);

  const handleSelect = useCallback(
    (val: string) => {
      if (!isControlled) {
        setInternalValue(val);
      }
      onChange?.(val);
      setIsOpen(false);
      triggerRef.current?.focus();
    },
    [isControlled, onChange]
  );

  // Close on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setFocusedIndex(0);
      } else {
        setFocusedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setFocusedIndex(options.length - 1);
      } else {
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1));
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else if (focusedIndex >= 0 && focusedIndex < options.length) {
        const opt = options[focusedIndex];
        if (opt && !opt.disabled) {
          handleSelect(opt.value);
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${className || ''}`}
      style={style}
    >
      {name && <input type="hidden" name={name} value={currentValue} />}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        className={`${styles.trigger} ${isOpen ? styles.triggerOpen : ''}`}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className={selectedOption ? styles.label : `${styles.label} ${styles.placeholder}`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <svg
          className={`${styles.icon} ${isOpen ? styles.iconOpen : ''}`}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div className={styles.dropdown} role="listbox">
          {options.map((opt, index) => {
            const isSelected = opt.value === currentValue;
            const isFocused = index === focusedIndex;
            return (
              <div
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                className={`${styles.option} ${isSelected ? styles.optionSelected : ''} ${
                  isFocused ? styles.optionFocused : ''
                }`}
                onClick={() => !opt.disabled && handleSelect(opt.value)}
                onMouseEnter={() => setFocusedIndex(index)}
              >
                <span>{opt.label}</span>
                {isSelected && (
                  <svg
                    className={styles.checkIcon}
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
