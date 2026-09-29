import { useRef, type KeyboardEvent, type ReactNode } from "react";

/** Publishing navigation stays separate from the actions inside its active panel. */
export function HtmlDeploymentTabs<T extends string>({ id, label, items, value, onChange, disabled = false, className = "" }: {
  id: string;
  label: string;
  items: readonly { id: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange(value: T): void;
  disabled?: boolean;
  className?: string;
}) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  function navigate(event: KeyboardEvent<HTMLButtonElement>, current: T) {
    if (disabled || event.altKey || event.ctrlKey || event.metaKey) return;
    const index = items.findIndex(item => item.id === current);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : event.key === "ArrowRight" ? (index + 1) % items.length
      : event.key === "ArrowLeft" ? (index + items.length - 1) % items.length : -1;
    if (next < 0) return;
    event.preventDefault();
    const item = items[next];
    buttons.current.get(item.id)?.focus();
    onChange(item.id);
  }
  return <div className={`web-html-deployment-tabs ${className}`} role="tablist" aria-label={label} aria-orientation="horizontal">
    {items.map(item => <button
      key={item.id}
      ref={button => { if (button) buttons.current.set(item.id, button); else buttons.current.delete(item.id); }}
      id={`${id}-${item.id}`}
      type="button"
      role="tab"
      aria-selected={value === item.id}
      aria-controls={`${id}-panel`}
      tabIndex={value === item.id ? 0 : -1}
      disabled={disabled}
      className="web-html-deployment-tab"
      onClick={() => onChange(item.id)}
      onKeyDown={event => navigate(event, item.id)}
    >{item.icon && <span className={`web-html-deployment-tab-mark is-${item.id}`}>{item.icon}</span>}<span>{item.label}</span></button>)}
  </div>;
}
