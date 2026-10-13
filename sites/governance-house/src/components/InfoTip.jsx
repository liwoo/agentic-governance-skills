import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// A hover tooltip that also works as a dismissible, non-modal popover on tap/keyboard.
// The portal keeps explanations clear of the walls' scrolling and clipping boundaries.
export default function InfoTip({ label, children, initialOpen = false }) {
  const id = useId();
  const trigger = useRef();
  const panel = useRef();
  const timer = useRef();
  const skipFocus = useRef(false);
  const [open, setOpen] = useState(initialOpen);
  const [position, setPosition] = useState({ left: 12, top: 12, maxHeight: 400 });
  const cancelClose = () => clearTimeout(timer.current);
  function show() {
    cancelClose();
    window.dispatchEvent(new CustomEvent("governance-info-open", { detail: id }));
    setOpen(true);
  }
  function close(restoreFocus = false) {
    cancelClose();
    setOpen(false);
    if (restoreFocus) {
      skipFocus.current = true;
      trigger.current?.focus({ preventScroll: true });
      skipFocus.current = false;
    }
  }
  function scheduleClose() {
    cancelClose();
    timer.current = setTimeout(() => {
      if (document.activeElement !== trigger.current && !panel.current?.contains(document.activeElement)) setOpen(false);
    }, 180);
  }
  function positionPanel() {
    if (!trigger.current || !panel.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const width = Math.min(370, window.innerWidth - 24);
    const height = Math.min(panel.current.scrollHeight, window.innerHeight - 24, 480);
    const preferredTop = anchor.bottom + 8 + height <= window.innerHeight - 12 ? anchor.bottom + 8 : anchor.top - height - 8;
    const top = Math.max(12, Math.min(preferredTop, window.innerHeight - height - 12));
    setPosition({ left: Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12)), top, maxHeight: Math.min(480, window.innerHeight - top - 12) });
  }
  useLayoutEffect(() => { if (open) positionPanel(); }, [open]);
  useEffect(() => {
    const otherOpened = (event) => { if (event.detail !== id) setOpen(false); };
    window.addEventListener("governance-info-open", otherOpened);
    return () => { cancelClose(); window.removeEventListener("governance-info-open", otherOpened); };
  }, [id]);
  useEffect(() => {
    if (!open) return;
    const outside = (event) => {
      if (!trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) close();
    };
    const escape = (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    };
    const reposition = (event) => { if (!panel.current?.contains(event.target)) positionPanel(); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
  }, [open]);
  return <>
    <button ref={trigger} className="info-trigger" type="button" aria-label={`Info: ${label}`} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog"
      onMouseEnter={show} onMouseLeave={scheduleClose} onFocus={() => { if (!skipFocus.current) show(); }} onBlur={scheduleClose}
      onClick={() => { show(); requestAnimationFrame(() => panel.current?.focus({ preventScroll: true })); }}>i</button>
    {open ? createPortal(<div ref={panel} id={id} role="dialog" aria-label={label} tabIndex={-1} className="info-popover" style={position} onMouseEnter={cancelClose} onMouseLeave={scheduleClose} onFocus={cancelClose} onBlur={scheduleClose}>
      <div className="info-popover-heading"><strong>{label}</strong><button type="button" aria-label="Close information" onClick={() => close(true)}>×</button></div>
      <div className="info-popover-body">{children}</div>
    </div>, document.body) : null}
  </>;
}
