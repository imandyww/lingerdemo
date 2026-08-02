"use client";

import { useEffect, useId, useRef } from "react";
import { CloseIcon } from "./icons";

export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const generatedId = useId();
  const titleId = `dialog-title-${generatedId}`;
  const descriptionId = `dialog-description-${generatedId}`;
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const backdrop = backdropRef.current;
    const parentSiblings = backdrop?.parentElement
      ? [...backdrop.parentElement.children].filter((element) => element !== backdrop)
      : [];
    const outside = [...parentSiblings, ...document.querySelectorAll(".site-header, .site-footer")]
      .filter((element, index, all) => all.indexOf(element) === index) as HTMLElement[];
    const previousAria = outside.map((element) => element.getAttribute("aria-hidden"));
    for (const element of outside) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
      if (event.key !== "Tab" || !backdrop) return;
      const focusable = [...backdrop.querySelectorAll<HTMLElement>(
        "button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])",
      )].filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      outside.forEach((element, index) => {
        element.inert = false;
        const prior = previousAria[index];
        if (prior === null || prior === undefined) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", prior);
      });
      previous?.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div ref={backdropRef} className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}>
        <button ref={closeRef} className="dialog-close icon-button" type="button" onClick={onClose} aria-label="Close dialog"><CloseIcon width="23" height="23" /></button>
        <p className="section-kicker">Review before continuing</p>
        <h2 id={titleId}>{title}</h2>
        {description ? <p id={descriptionId} className="dialog-description">{description}</p> : null}
        {children}
      </section>
    </div>
  );
}
