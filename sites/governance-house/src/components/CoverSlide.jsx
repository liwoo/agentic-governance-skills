import { useEffect, useRef } from "react";
import CoverArt from "./CoverArt.jsx";
import speakingQr from "../assets/speaking-qr.svg";
import "./CoverSlide.css";

export default function CoverSlide({ onEnter, closing = false, onBack }) {
  const heading = useRef(null);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  function advance(event) {
    if (event.target.closest("button, a")) return;
    if (closing && event.key === "ArrowLeft") {
      event.preventDefault();
      onBack();
    } else if (!closing && ["ArrowRight", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      onEnter();
    }
  }

  return (
    <main className={`cover-slide${closing ? " cover-closing" : ""}`} aria-labelledby="cover-title" onKeyDown={advance}>
      <div className="cover-topline">
        <span className="cover-series"><span className="brand-cube" aria-hidden="true"><i /><i /><i /></span>The Governance House</span>
        <span className="cover-category">Agentic AI / shared responsibility</span>
      </div>

      <div className="cover-body">
        <div className="cover-heading">
          <h1 id="cover-title" ref={heading} tabIndex={-1}>{closing ? <>Thank <em>you</em></> : <>You are the<br /><em>Governance</em><br />Layer</>}</h1>
          {closing ? <a className="closing-qr" href="https://chienda.com/speaking" target="_blank" rel="noreferrer">
            <img src={speakingQr} width="232" height="232" alt="QR code linking to https://chienda.com/speaking" />
            <span>chienda.com/speaking <i aria-hidden="true">↗</i></span>
          </a> : null}
        </div>
        <CoverArt closing={closing} />
      </div>

      <footer className="cover-footer">
        <div className="cover-presenter">
          <strong>Jeremiah Chienda</strong>
          <span>AI Data Engineer</span>
          <span>Information Commisioner's Office</span>
          <a href="https://chienda.com" target="_blank" rel="noreferrer">chienda.com <span aria-hidden="true">↗</span></a>
        </div>
        <button type="button" className="cover-enter" onClick={closing ? onBack : onEnter}>
          <span><small>{closing ? "Previous / Shutdown" : "Next / Introduction"}</small>{closing ? "Back to the talk" : "Begin the talk"}</span>
          <span className="cover-enter-arrow" aria-hidden="true">{closing ? "←" : "→"}</span>
        </button>
      </footer>
    </main>
  );
}
