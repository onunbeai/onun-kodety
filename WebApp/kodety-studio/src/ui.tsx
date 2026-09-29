import { useEffect, useRef, useState, type ReactNode } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { FolderOpenIcon } from "@solar-icons/react/bold-duotone/folder-open";
import { SettingsMinimalisticIcon } from "@solar-icons/react/bold-duotone/settings-minimalistic";
import { ShieldCheckIcon } from "@solar-icons/react/bold-duotone/shield-check";
import { ClockCircleIcon } from "@solar-icons/react/bold-duotone/clock-circle";
import { GlobalIcon } from "@solar-icons/react/bold-duotone/global";
import { ServerSquareCloudIcon } from "@solar-icons/react/bold-duotone/server-square-cloud";
import { PenNewSquareIcon } from "@solar-icons/react/bold-duotone/pen-new-square";
import { TrashBinMinimalisticIcon } from "@solar-icons/react/bold-duotone/trash-bin-minimalistic";
import { DangerTriangleIcon } from "@solar-icons/react/bold-duotone/danger-triangle";
import { Widget5Icon } from "@solar-icons/react/bold-duotone/widget-5";

const solar = {
  folder: FolderOpenIcon,
  settings: SettingsMinimalisticIcon,
  shield: ShieldCheckIcon,
  clock: ClockCircleIcon,
  globe: GlobalIcon,
  server: ServerSquareCloudIcon,
  edit: PenNewSquareIcon,
  trash: TrashBinMinimalisticIcon,
  alert: DangerTriangleIcon,
  widget: Widget5Icon,
};
export type IconName =
  | keyof typeof solar
  | "plus"
  | "arrow"
  | "external"
  | "search"
  | "close"
  | "grid"
  | "list"
  | "star"
  | "check"
  | "chevron"
  | "help"
  | "discord"
  | "menu"
  | "refresh"
  | "download";
export function Icon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  if (name in solar) {
    const Component = solar[name as keyof typeof solar];
    return <Component className={className} aria-hidden="true" />;
  }
  const paths: Record<string, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    external: <path d="M7 17 17 7M7 7h10v10" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    grid: (
      <>
        <rect x="4" y="4" width="6" height="6" rx="1" />
        <rect x="14" y="4" width="6" height="6" rx="1" />
        <rect x="4" y="14" width="6" height="6" rx="1" />
        <rect x="14" y="14" width="6" height="6" rx="1" />
      </>
    ),
    list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
    star: (
      <path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3-4.6-4.5 6.4-.9Z" />
    ),
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9a3 3 0 1 1 5 2.2c-1.5 1-2 1.3-2 2.8M12 17h.01" />
      </>
    ),
    discord: (
      <path
        fill="currentColor"
        stroke="none"
        d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
      />
    ),
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    refresh: (
      <>
        <path d="M20 5v6h-6M4 19v-6h6" />
        <path d="M6 8a7 7 0 0 1 12-2l2 5M4 13l2 5a7 7 0 0 0 12-2" />
      </>
    ),
    download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" />,
  };
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function Mark() {
  return <img src="./assets/kodety-mark.svg" alt="" className="web-mark" />;
}
export function Logo({ className }: { className: string }) {
  return <span className={className} style={{ fontSize: 21, fontWeight: 650, letterSpacing: '-0.6px', whiteSpace: 'nowrap', width: 'auto' }}>Onun Kodety</span>;
}

export function Select<Value extends string>({
  id,
  label,
  value,
  onValueChange,
  options,
  disabled = false,
}: {
  id?: string;
  label: string;
  value: Value;
  onValueChange(value: Value): void;
  options: readonly { value: Value; label: string }[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={(next) => {
        const option = options.find((option) => option.value === next);
        if (option) onValueChange(option.value);
      }}
      open={open}
      onOpenChange={setOpen}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        ref={triggerRef}
        id={id}
        type="button"
        className="web-select-trigger"
        aria-label={label}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon asChild>
          <Icon name="chevron" className="web-select-chevron" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal
        container={triggerRef.current?.closest("dialog, .web-app")}
      >
        <SelectPrimitive.Content
          className="web-select-content"
          position="popper"
          align="end"
          sideOffset={6}
          collisionPadding={12}
          aria-label={label}
        >
          <SelectPrimitive.ScrollUpButton className="web-select-scroll is-up">
            <Icon name="chevron" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="web-select-viewport">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className="web-select-option"
              >
                <SelectPrimitive.ItemText>
                  {option.label}
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="web-select-check">
                  <Icon name="check" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="web-select-scroll">
            <Icon name="chevron" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function Spinner() {
  return <span className="web-spinner" aria-hidden="true" />;
}
export function Notice({
  children,
  tone = "error",
}: {
  children: ReactNode;
  tone?: "error" | "info" | "success";
}) {
  return (
    <div
      className={`web-notice is-${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon
        name={
          tone === "error" ? "alert" : tone === "success" ? "check" : "shield"
        }
      />
      <div>{children}</div>
    </div>
  );
}
export function Dialog({
  title,
  description,
  children,
  onClose,
  closeLabel,
  busy = false,
  className = "",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose(): void;
  closeLabel: string;
  busy?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      className={`web-dialog ${className}`}
      ref={ref}
      aria-label={title}
      aria-modal="true"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busyRef.current) closeRef.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) {
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            onClose();
        }
      }}
    >
      <header className="web-dialog-header">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button
          type="button"
          className="web-icon-button"
          aria-label={closeLabel}
          disabled={busy}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
