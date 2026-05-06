/* global React, HowlerAvatar, HOWLER_ICONS */
const { IconA: IA4 } = HOWLER_ICONS;

// ============================================================
// DEVICE SCREENS — round 240×240 (M5Stack Dial / CrowPanel)
// We render at 240px and let the design canvas scale.
// ============================================================
function DeviceScreen({ children, label }) {
  return (
    <div style={{display:"flex", flexDirection:"column", alignItems:"center", gap:10}}>
      <div style={{position:"relative", width:280, height:280, display:"flex", alignItems:"center", justifyContent:"center"}}>
        {/* bezel */}
        <div style={{
          position:"absolute", inset:0, borderRadius:"50%",
          background:"radial-gradient(circle at 30% 25%, #2A2620 0%, #15110C 100%)",
          boxShadow:"0 8px 30px rgba(20,15,10,0.4), inset 0 0 0 1px #3A332B",
        }}/>
        {/* knob hint at top */}
        <div style={{position:"absolute", top:-2, left:"50%", transform:"translateX(-50%)", width:30, height:6, background:"#3A332B", borderRadius:"3px 3px 0 0"}}/>
        {/* screen */}
        <div style={{
          width:240, height:240, borderRadius:"50%",
          background:"#0F0B07", overflow:"hidden", position:"relative",
        }}>
          {children}
        </div>
      </div>
      {label && <div className="cap" style={{textAlign:"center"}}>{label}</div>}
    </div>
  );
}

// IDLE
function DialIdle() {
  return (
    <DeviceScreen label="Idle — clock + gentle status">
      <div style={{
        position:"absolute", inset:0,
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
        color:"#F5EFE3", fontFamily:"Fraunces, Georgia, serif",
      }}>
        <div className="cap" style={{color:"#9A8E76", letterSpacing:".2em"}}>WED · MAY 6</div>
        <div style={{fontSize:60, fontWeight:400, letterSpacing:"-0.04em", marginTop:6, color:"#F5EFE3"}}>8:04</div>
        <div style={{fontFamily:"var(--font-mono)", fontSize:11, color:"#7A6F5E", marginTop:8, letterSpacing:".05em"}}>3 PENDING</div>
      </div>
      {/* Subtle outer ring tick */}
      <svg style={{position:"absolute", inset:0}} viewBox="0 0 240 240">
        <circle cx="120" cy="120" r="112" fill="none" stroke="#3A332B" strokeWidth="1"/>
      </svg>
    </DeviceScreen>
  );
}

// PENDING — most-urgent occurrence rendered
function DialPending() {
  return (
    <DeviceScreen label="Pending occurrence — most urgent first">
      <svg style={{position:"absolute", inset:0}} viewBox="0 0 240 240">
        <circle cx="120" cy="120" r="112" fill="none" stroke="#C77A2A" strokeWidth="3" opacity="0.85"/>
        {/* tick marks for "menu items" around the rim */}
        {[0,72,144,216,288].map(a => (
          <line key={a} x1={120 + Math.cos((a-90)*Math.PI/180)*108} y1={120 + Math.sin((a-90)*Math.PI/180)*108}
            x2={120 + Math.cos((a-90)*Math.PI/180)*116} y2={120 + Math.sin((a-90)*Math.PI/180)*116}
            stroke="#9A8E76" strokeWidth="1.5"/>
        ))}
      </svg>
      <div style={{
        position:"absolute", inset:0,
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
        color:"#F5EFE3",
      }}>
        <HowlerAvatar photo="mochi" urgency={2} size={80} ringWidth={3}/>
        <div style={{fontFamily:"Fraunces, Georgia, serif", fontSize:22, marginTop:10, color:"#F5EFE3"}}>Feed Mochi</div>
        <div style={{fontFamily:"var(--font-mono)", fontSize:10, color:"#C77A2A", marginTop:4, letterSpacing:".1em"}}>DUE 08:00 · 50 GR</div>
      </div>
    </DeviceScreen>
  );
}

// ACK ARC — long-press in progress
function DialAckArc() {
  // 70% arc filled
  const r = 112;
  const c = 2*Math.PI*r;
  const filled = c * 0.72;
  return (
    <DeviceScreen label="Long-press to ack — arc fills (back = double-tap)">
      <svg style={{position:"absolute", inset:0}} viewBox="0 0 240 240">
        <circle cx="120" cy="120" r={r} fill="none" stroke="#3A332B" strokeWidth="3"/>
        <circle cx="120" cy="120" r={r} fill="none"
          stroke="#6E8A5C" strokeWidth="3" strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`} transform="rotate(-90 120 120)"/>
      </svg>
      <div style={{
        position:"absolute", inset:0,
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
        color:"#F5EFE3",
      }}>
        <div style={{
          width:96, height:96, borderRadius:"50%",
          background:"#6E8A5C", color:"#F5EFE3",
          display:"flex", alignItems:"center", justifyContent:"center",
        }}>
          <IA4 name="check" size={44} color="#F5EFE3"/>
        </div>
        <div style={{fontFamily:"Fraunces, Georgia, serif", fontSize:18, marginTop:14, color:"#F5EFE3"}}>Hold to confirm</div>
        <div style={{fontFamily:"var(--font-mono)", fontSize:10, color:"#9A8E76", marginTop:4, letterSpacing:".1em"}}>FEED MOCHI · 50 GR</div>
        <div style={{fontFamily:"var(--font-mono)", fontSize:9, color:"#5A4F40", marginTop:14, letterSpacing:".15em"}}>·· DOUBLE-TAP TO BACK</div>
      </div>
    </DeviceScreen>
  );
}

window.DEVICE_SCREENS = { DialIdle, DialPending, DialAckArc };
