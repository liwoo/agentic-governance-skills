const ink = "#151a17";
const cream = "#f1eadb";
const floorWood = "#a8977f";

// Six rooms, ground floor left to right, then upper floor right to left,
// following the story path from the front door.
const rooms = [
  { id: "identity", number: "01", x: 310, y: 395, accent: "#718fc1", tint: "#cdd6e4" },
  { id: "reliability", number: "02", x: 470, y: 395, accent: "#dda85f", tint: "#ecdcc0" },
  { id: "permission", number: "03", x: 630, y: 395, accent: "#e38b68", tint: "#efd3c4" },
  { id: "uncertainty", number: "04", x: 630, y: 250, accent: "#9e8bc5", tint: "#dcd5e8" },
  { id: "ledger", number: "05", x: 470, y: 250, accent: "#75a99c", tint: "#cfe1da" },
  { id: "shutdown", number: "06", x: 310, y: 250, accent: "#d86459", tint: "#edcbc5" },
];

function Prop({ id, accent }) {
  switch (id) {
    case "identity":
      return <>
        <rect x="34" y="34" width="38" height="50" rx="4" fill={accent} />
        <circle cx="53" cy="56" r="10" fill="none" stroke={cream} strokeWidth="3" />
        <path d="M44 74h18" stroke={cream} strokeWidth="3" />
        <rect x="104" y="58" width="9" height="59" fill="#3b4540" />
        <path d="M104 66H40" strokeWidth="9" stroke={ink} />
        <path d="M104 66H40" strokeWidth="5" stroke={accent} strokeDasharray="10 8" />
        <circle cx="108.5" cy="58" r="6" fill={accent} />
      </>;
    case "reliability":
      return <>
        <path d="M10 104q12-6 24 0t24 0 24 0 24 0 24 0 20 0V117H10Z" fill="#8fb3b0" />
        <path d="M22 110Q80 30 138 110" fill="none" strokeWidth="13" />
        <path d="M22 110Q80 30 138 110" fill="none" strokeWidth="6" stroke={accent} />
        <path d="M44 80v-8M62 72v-4M98 72v-4M116 80v-8" strokeWidth="3" />
        <path d="M12 60h136v10H12Z" fill={accent} />
        <path d="M18 60V46M50 60V46M80 60V46M110 60V46M142 60V46M16 46h128" fill="none" strokeWidth="2.5" />
      </>;
    case "permission":
      return <>
        <circle cx="64" cy="70" r="36" fill={accent} />
        <circle cx="64" cy="70" r="22" fill={cream} />
        <path d="M64 54v32M48 70h32M53 59l22 22M75 59 53 81" strokeWidth="3" />
        <circle cx="64" cy="70" r="6" fill={ink} />
        <path d="M112 34v10" />
        <circle cx="112" cy="51" r="7" fill="#e8c27c" />
        <path d="M112 58v22M112 72h7M112 79h5" />
        <Ladder top={10} bottom={117} />
      </>;
    case "uncertainty":
      return <>
        <rect x="64" y="44" width="8" height="73" fill="#3b4540" />
        <path d="M68 50H28l-10 10 10 10h40Z" fill={accent} />
        <path d="M68 76h40l10 10-10 10H68Z" fill={cream} />
        <circle cx="68" cy="30" r="13" fill={cream} />
        <path d="M63 26a5 5 0 1 1 7 5c-2 1-2 2-2 4" fill="none" strokeWidth="3" />
        <circle cx="68" cy="40" r="1.6" fill={ink} stroke="none" />
        <Ladder top={60} bottom={135} />
      </>;
    case "ledger":
      return <>
        <rect x="24" y="30" width="112" height="87" fill="#6f5c49" />
        <path d="M24 59h112M24 88h112" />
        {[[30, 38], [42, 41], [54, 36], [70, 40], [82, 38], [94, 42], [110, 37], [122, 40]].map(([x, y], index) => <rect key={x} x={x} y={y} width="10" height={59 - y} fill={index % 3 === 1 ? cream : "#75a99c"} strokeWidth="2.5" />)}
        {[[32, 66], [44, 69], [62, 65], [76, 68], [90, 66], [104, 70], [118, 66]].map(([x, y], index) => <rect key={x} x={x} y={y} width="11" height={88 - y} fill={index % 3 === 2 ? cream : "#75a99c"} strokeWidth="2.5" />)}
        <path d="M30 98h24v12H30zM62 98h22v12H62zM92 98h38v12H92z" fill={cream} strokeWidth="2.5" />
      </>;
    case "shutdown":
      return <>
        <rect x="40" y="80" width="56" height="37" rx="3" fill="#59625c" />
        <path d="M48 80a20 12 0 0 1 40 0Z" fill={accent} />
        <path d="M120 117V64" strokeWidth="5" />
        <rect x="106" y="86" width="28" height="22" rx="3" fill="#3b4540" />
        <path d="M120 97 102 58" strokeWidth="5" />
        <circle cx="101" cy="55" r="7" fill={accent} />
        <path d="M30 34h44v24H30z" fill={cream} strokeWidth="2.5" />
        <path d="M38 46h28" strokeWidth="5" stroke={accent} />
      </>;
    default:
      return null;
  }
}

function Ladder({ top, bottom }) {
  const rungs = [];
  for (let y = top + 10; y < bottom; y += 15) rungs.push(y);
  return <g strokeWidth="2.5">
    <path d={`M134 ${top}V${bottom}M150 ${top}V${bottom}`} strokeWidth="3" />
    {rungs.map((y) => <path key={y} d={`M134 ${y}h16`} />)}
  </g>;
}

function Room({ room }) {
  return <g transform={`translate(${room.x} ${room.y})`}>
    <rect x="10" y="10" width="140" height="125" fill={room.tint} />
    <rect x="10" y="117" width="140" height="18" fill={floorWood} />
    <Prop id={room.id} accent={room.accent} />
    <circle cx="26" cy="24" r="11" fill={cream} strokeWidth="2.5" />
    <text x="26" y="28" textAnchor="middle" fill={ink} stroke="none" fontSize="10" fontWeight="800">{room.number}</text>
  </g>;
}

function Limb({ d, color }) {
  return <>
    <path d={d} fill="none" strokeWidth="10" />
    <path d={d} fill="none" strokeWidth="4.5" stroke={color} />
  </>;
}

function Robot({ waving }) {
  return <g className="cover-robot">
    <path d="M78 516v22M106 516v22" strokeWidth="9" />
    <path d="M78 516v22M106 516v22" strokeWidth="4" stroke="#cfd6d1" />
    <path d="M66 542a12 6 0 0 1 24 0ZM94 542a12 6 0 0 1 24 0Z" fill="#3b4540" />
    <rect x="62" y="464" width="60" height="54" rx="12" fill="#cfd6d1" />
    <rect x="76" y="478" width="32" height="20" rx="4" fill="#3b4540" />
    <circle cx="86" cy="488" r="3.5" fill="#86b6a0" stroke="none" />
    <path d="M94 488h8" stroke="#86b6a0" strokeWidth="2.5" />
    {waving
      ? <Limb d="M120 478q20-8 26-36" color="#cfd6d1" />
      : <Limb d="M120 482q16 2 24-6" color="#cfd6d1" />}
    {waving ? <circle cx="146" cy="438" r="7" fill="#cfd6d1" /> : null}
    <Limb d="M64 480q-12 14-6 30" color="#cfd6d1" />
    <rect x="64" y="414" width="56" height="46" rx="14" fill="#e7ece8" />
    <rect x="72" y="424" width="40" height="26" rx="8" fill="#1e2622" />
    <ellipse cx="88" cy="436" rx="3.5" ry="5" fill="#86b6a0" stroke="none" />
    <ellipse cx="102" cy="436" rx="3.5" ry="5" fill="#86b6a0" stroke="none" />
    <path d="M90 444q6 4 12 0" stroke="#86b6a0" strokeWidth="2" fill="none" />
    <path d="M92 414v-14" />
    <circle className="cover-robot-light" cx="92" cy="396" r="6" fill="#d8b783" />
    {waving ? null : <g transform="rotate(-10 158 470)">
      <rect x="138" y="458" width="44" height="24" rx="3" fill={cream} />
      <path d="M170 459v22" strokeDasharray="3 3" strokeWidth="2" />
      <path d="M146 470h16" strokeWidth="2.5" />
      <path d="M173 465l5 5-5 5" strokeWidth="2" fill="none" />
    </g>}
  </g>;
}

function Person({ waving }) {
  return <g className="cover-person">
    <path d="M223 504v34M241 504v34" strokeWidth="11" />
    <path d="M223 504v34M241 504v34" strokeWidth="6" stroke="#34404b" />
    <path d="M212 542a12 6 0 0 1 22 0ZM230 542a12 6 0 0 1 22 0Z" fill="#2a211c" />
    <path d="M212 508q-3-46 12-58h16q15 12 12 58Z" fill="#86b6a0" />
    <path d="M232 450v20" strokeWidth="2.5" fill="none" />
    <Limb d="M249 466q10 18 4 36" color="#86b6a0" />
    {waving
      ? <>
          <Limb d="M216 462q-18-6-20-36" color="#86b6a0" />
          <circle cx="196" cy="422" r="7" fill="#b97f55" />
        </>
      : <>
          <Limb d="M216 464q-14 10-22 6" color="#86b6a0" />
          <rect x="172" y="452" width="26" height="34" rx="3" fill={cream} />
          <rect x="179" y="448" width="12" height="7" rx="2" fill="#d8b783" strokeWidth="2.5" />
          <path d="M178 465h14M178 473h10" strokeWidth="2" />
          <path d="m187 477 3 3 6-7" strokeWidth="2.5" stroke="#4f8f78" fill="none" />
        </>}
    <circle cx="232" cy="428" r="19" fill="#b97f55" />
    <path d="M213 426q-2-24 21-22 18 2 17 20-10-8-24-6-8 1-14 8Z" fill="#2a211c" />
    <circle cx="224" cy="432" r="2.3" fill={ink} stroke="none" />
    <path d="M218 440q5 4 10 1" fill="none" strokeWidth="2.5" />
  </g>;
}

export default function CoverArt({ closing = false }) {
  return <svg className="cover-art" viewBox="50 36 790 516" role="img" aria-labelledby="cover-art-title">
    <title id="cover-art-title">{closing
      ? "The Governance House at night. The flight-booking robot and the person at the door wave goodbye."
      : "A cartoon cutaway of the Governance House with six rooms. A small flight-booking robot holds out its ticket to a person checking it at the front door."}</title>
    <g stroke={ink} strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round">
      <path d="M118 96a26 26 0 1 0 30 34 22 22 0 0 1-30-34Z" fill="#d8b783" />
      {[[64, 210], [210, 70], [300, 160], [420, 54], [736, 112], [790, 196], [90, 330]].map(([x, y]) => <path key={x} d={`M${x} ${y - 7}v14M${x - 7} ${y}h14`} stroke="#d8b78399" strokeWidth="2.5" />)}

      <g className="cover-plane">
        <path d="M498 92q60-36 132-20" fill="none" stroke="#f1eadb55" strokeWidth="2.5" strokeDasharray="2 9" />
        <g transform="translate(700 64) rotate(-8) scale(-1 1)">
          <path d="M0 8q2-10 14-10h30q10 0 12 8-2 6-12 6H8Q0 12 0 8Z" fill={cream} />
          <path d="M22 4 14-14h8l14 18M24 12l-8 14h8l12-14M50 4l4-10h6l-2 12" fill={cream} strokeWidth="2.5" />
          <path d="M18 5h4M28 5h4M38 5h4" strokeWidth="2.5" />
        </g>
      </g>

      <path d="M60 552C100 470 230 440 400 446s300-36 380-28q60 6 60 50v84Z" fill="#26302a" stroke="none" />

      <path d="M290 548h524" stroke="#141916" strokeWidth="14" opacity=".55" />
      <rect x="688" y="150" width="34" height="80" fill="#59625c" />
      <path d="M684 150h42" strokeWidth="6" />
      <circle className="cover-smoke" cx="712" cy="126" r="9" fill="#e8e2d3" opacity=".75" />
      <circle className="cover-smoke" cx="728" cy="104" r="12" fill="#e8e2d3" opacity=".5" />
      <path d="M286 256 550 116l264 140Z" fill="#454e48" />
      <path d="M340 228h420M392 200h316M444 172h212" stroke="#151a17" strokeWidth="2.5" opacity=".6" />
      <circle cx="550" cy="196" r="24" fill={cream} />
      <g transform="translate(550 196) rotate(30) skewX(-5)" strokeWidth="2">
        <rect x="-13" y="-13" width="26" height="26" fill="none" />
        <rect x="-10" y="-10" width="9" height="9" fill="#d8b783" stroke="none" />
        <rect x="1" y="-10" width="9" height="9" fill="#d8b783" stroke="none" />
        <rect x="-10" y="1" width="20" height="9" fill="#d8b783" stroke="none" />
      </g>

      <rect x="310" y="250" width="480" height="290" fill="#e4d9c2" />
      {rooms.map((room) => <Room key={room.id} room={room} />)}
      <path d="M310 395h480M470 250v290M630 250v290" strokeWidth="3.5" />
      <rect x="310" y="250" width="480" height="290" fill="none" strokeWidth="4.5" />

      <path d="M262 434h48v106h-48Z" fill="#e4d9c2" />
      <path d="M254 436 286 410l32 26Z" fill="#454e48" />
      <path d="M272 540v-62a14 14 0 0 1 28 0v62Z" fill={closing ? "#3b4540" : "#2a211c"} />
      {closing ? <path d="M276 540v-60a10 10 0 0 1 20 0v60Z" fill="#e8c27c" /> : <circle cx="294" cy="508" r="2.6" fill="#d8b783" />}
      <path d="M80 548q70-6 192-6" stroke="#4a5649" strokeWidth="10" opacity=".7" />

      <g transform="translate(-22 0)"><Robot waving={closing} /></g>
      <Person waving={closing} />
    </g>
  </svg>;
}
