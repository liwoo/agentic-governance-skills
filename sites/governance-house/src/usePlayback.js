import { useEffect, useRef, useState } from "react";
import { BEAT_SECONDS } from "./data/stories.js";

export function usePlayback(roomId, count, active = true) {
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [playing, setPlaying] = useState(() => !reducedMotion);
  const [phase, setPhase] = useState(0);
  const phaseRef = useRef(0);
  const [finished, setFinished] = useState(false);
  const timeline = useRef({ time: reducedMotion ? BEAT_SECONDS * 0.65 : 0 });
  const duration = count * BEAT_SECONDS;

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => {
      setReducedMotion(preference.matches);
      if (preference.matches) setPlaying(false);
    };
    preference.addEventListener("change", change);
    return () => preference.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    timeline.current.time = reducedMotion ? BEAT_SECONDS * 0.65 : 0;
    phaseRef.current = 0;
    setPhase(0);
    setFinished(false);
    setPlaying(!reducedMotion);
  }, [roomId, reducedMotion]);

  useEffect(() => {
    if (!playing || !active) return;
    let frame;
    let previous;
    function tick(now) {
      // Do not skip the story after returning from a background tab.
      const delta = previous === undefined ? 0 : Math.min((now - previous) / 1000, 0.1);
      previous = now;
      timeline.current.time = Math.min(duration - 0.001, timeline.current.time + delta);
      const next = Math.min(count - 1, Math.floor(timeline.current.time / BEAT_SECONDS));
      if (phaseRef.current !== next) {
        phaseRef.current = next;
        setPhase(next);
      }
      if (timeline.current.time >= duration - 0.001) {
        setPlaying(false);
        setFinished(true);
        return;
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, active, duration, count]);

  useEffect(() => {
    if (!active) setPlaying(false);
  }, [active, roomId]);

  function seek(index) {
    timeline.current.time = index * BEAT_SECONDS + BEAT_SECONDS * 0.8;
    phaseRef.current = index;
    setPhase(index);
    setPlaying(false);
    setFinished(false);
  }
  function replay() {
    timeline.current.time = 0;
    phaseRef.current = 0;
    setPhase(0);
    setFinished(false);
    setPlaying(true);
  }
  function toggle() {
    if (finished) replay();
    else setPlaying((value) => !value);
  }
  return { timeline, phase, playing: playing && active, finished, reducedMotion, seek, replay, toggle };
}
