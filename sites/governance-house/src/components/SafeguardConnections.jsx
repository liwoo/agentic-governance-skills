import { rooms } from "../data/rooms.js";
import InfoTip from "./InfoTip.jsx";

export default function SafeguardConnections({ room, onRoom }) {
  return <section className="safeguard-connections" aria-label="Residual risk and connected safeguards">
    <div className="residual-card">
      <div><p className="connection-kicker">Even with this safeguard</p><h3>{room.limitation.title}</h3></div>
      <InfoTip label="Residual risk"><p>{room.limitation.body}</p><p>These layers reduce risk together. None is tamper-proof or sufficient alone; their shared dependencies and failure paths still need testing.</p></InfoTip>
    </div>
    <h4>Works with</h4>
    <CompanionCards room={room} onRoom={onRoom} />
  </section>;
}

export function CompanionCards({ room, onRoom }) {
  return <ul>{room.limitation.companions.map(({ roomId, reason }) => {
      const companion = rooms.find((item) => item.id === roomId);
      return <li key={roomId}><button className="companion-link" type="button" onClick={() => onRoom(roomId)} aria-label={`Explore ${companion.short} safeguard`}><span>{companion.number}</span><strong>{companion.short}</strong><span aria-hidden="true">↗</span></button><InfoTip label={`Why ${companion.short}`}><p>{reason}</p></InfoTip></li>;
    })}</ul>;
}
