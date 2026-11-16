import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Modal confirmations share keyboard containment and restore the invoking control. */
export function Modal({ children, onClose, ...props }: {
  children: ReactNode;
  onClose: () => void;
  role?: "dialog" | "alertdialog";
  "aria-label": string;
  className?: string;
}) {
  // Capture before portal children mount: autoFocus may otherwise steal the invoker.
  const [previous] = useState(() => document.activeElement as HTMLElement | null);
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const element = ref.current!;
    const backdrop = element.parentElement!;
    const siblings = Array.from(document.body.children).filter(node => node !== backdrop && !node.hasAttribute("inert"));
    siblings.forEach(node => node.setAttribute("inert", ""));
    const controls = () => Array.from(element.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]')).filter(node => {
      if (node.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
      const closed = node.closest('details:not([open])');
      return !closed || (node.tagName === "SUMMARY" && node.parentElement === closed);
    });
    (controls()[0] ?? element).focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key === "Tab") {
        const items = controls();
        const first = items[0] ?? element, last = items.at(-1) ?? element;
        if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === element)) { event.preventDefault(); first.focus(); }
      }
    };
    element.addEventListener("keydown", keydown);
    return () => { element.removeEventListener("keydown", keydown); siblings.forEach(node => node.removeAttribute("inert")); if (previous?.isConnected) previous.focus(); };
  }, [previous]);
  return createPortal(<div className="modal-backdrop"><section {...props} ref={ref} role={props.role ?? "dialog"} aria-modal="true" tabIndex={-1} className={`modal-card ${props.className ?? ""}`}>{children}</section></div>, document.body);
}
