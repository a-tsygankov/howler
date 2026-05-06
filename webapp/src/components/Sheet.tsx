import { type ReactNode, useEffect } from "react";

// Bottom-sheet overlay. Drag handle, paper background, 22px radius
// top corners. Click backdrop or Escape to close.

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** A11y label for the sheet, used as aria-label. */
  ariaLabel?: string;
}

export const Sheet = ({ open, onClose, children, ariaLabel }: SheetProps) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? "Sheet"}
        className="w-full max-w-md animate-[slideUp_0.22s_cubic-bezier(.2,.8,.2,1)] rounded-t-lg bg-paper px-5 pb-6 pt-3 shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-paper-3" />
        {children}
      </div>
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};
