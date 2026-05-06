/* global React, HOWLER_DATA, HowlerAvatar, HOWLER_ICONS */
const D3 = HOWLER_DATA;
const { IconA: IA3 } = HOWLER_ICONS;

// ============================================================
// ACK FLOW — value-entry variations
// Three explorations: stepper modal, slider sheet, "quick presets"
// All target: feeding Mochi, value type = grams
// ============================================================

function AckSheetStepper() {
  const [v, setV] = React.useState(50);
  return (
    <AckShell>
      <AckHeader title="Feed Mochi" sub="08:04 · Wet food, half can"/>
      <div style={{padding:"24px 18px 8px", textAlign:"center"}}>
        <div className="cap">Amount</div>
        <div style={{display:"flex", alignItems:"center", justifyContent:"center", gap:18, marginTop:14}}>
          <CircleBtn onClick={() => setV(v=>Math.max(0,v-10))}>−</CircleBtn>
          <div>
            <div className="h-display" style={{fontSize:64, lineHeight:1}}>{v}</div>
            <div className="mono" style={{fontSize:11, color:"var(--ink-3)", marginTop:4}}>GRAMS</div>
          </div>
          <CircleBtn onClick={() => setV(v=>v+10)}>+</CircleBtn>
        </div>
        <div style={{display:"flex", justifyContent:"center", gap:6, marginTop:18}}>
          {[40,50,60,80].map(p => (
            <button key={p} onClick={() => setV(p)} style={{
              padding:"6px 12px", borderRadius:999, fontSize:12,
              border:"1px solid var(--line)",
              background: v===p ? "var(--ink)" : "transparent",
              color: v===p ? "var(--paper)" : "var(--ink-2)",
            }}>{p}g</button>
          ))}
        </div>
      </div>
      <AckFooter/>
    </AckShell>
  );
}

function AckSheetSlider() {
  const [v, setV] = React.useState(50);
  const max = 100;
  return (
    <AckShell>
      <AckHeader title="Feed Mochi" sub="08:04 · Wet food, half can"/>
      <div style={{padding:"24px 22px 8px"}}>
        <div className="cap">Amount</div>
        <div style={{display:"flex", alignItems:"baseline", gap:6, marginTop:8}}>
          <span className="h-display" style={{fontSize:54}}>{v}</span>
          <span className="mono" style={{fontSize:14, color:"var(--ink-3)"}}>gr</span>
        </div>
        <div style={{position:"relative", marginTop:18}}>
          <input type="range" min="0" max={max} step="10" value={v} onChange={e => setV(+e.target.value)}
            style={{width:"100%", accentColor:"var(--ink)"}}/>
          <div style={{display:"flex", justifyContent:"space-between", fontSize:10, color:"var(--ink-3)", fontFamily:"var(--font-mono)", marginTop:4}}>
            {[0,25,50,75,100].map(t => <span key={t}>{t}</span>)}
          </div>
        </div>
        <div style={{display:"flex", gap:8, marginTop:18, alignItems:"center", padding:"10px 12px", background:"#FBF7EC", borderRadius:12, border:"1px solid var(--line-soft)"}}>
          <IA3 name="clock" size={14} color="var(--ink-3)"/>
          <span style={{fontSize:12, color:"var(--ink-3)"}}>Last time: <strong style={{color:"var(--ink)"}}>50gr</strong> by Sam · yesterday</span>
        </div>
      </div>
      <AckFooter/>
    </AckShell>
  );
}

function AckSheetWheel() {
  const [v, setV] = React.useState(50);
  const opts = [];
  for (let i = 0; i <= 100; i += 10) opts.push(i);
  return (
    <AckShell>
      <AckHeader title="Feed Mochi" sub="08:04 · Wet food, half can"/>
      <div style={{padding:"22px 0 0"}}>
        <div className="cap" style={{textAlign:"center"}}>Amount in grams</div>
        <div style={{
          position:"relative", height:170, margin:"12px 0 0",
          maskImage:"linear-gradient(180deg, transparent 0%, black 30%, black 70%, transparent 100%)",
          WebkitMaskImage:"linear-gradient(180deg, transparent 0%, black 30%, black 70%, transparent 100%)",
        }}>
          <div style={{position:"absolute", top:"50%", left:0, right:0, height:48, transform:"translateY(-50%)", borderTop:"1px solid var(--line)", borderBottom:"1px solid var(--line)"}}/>
          <div style={{display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%"}}>
            {opts.map(o => (
              <button key={o} onClick={() => setV(o)} style={{
                background:"transparent", border:"none", padding:"4px 0",
                fontFamily:"Fraunces, Georgia, serif",
                fontSize: o === v ? 36 : 18,
                color: o === v ? "var(--ink)" : "var(--ink-mute)",
                fontWeight: 500, lineHeight: 1.1,
                transition:"all .15s",
                opacity: Math.abs(opts.indexOf(o) - opts.indexOf(v)) > 2 ? 0.3 : 1,
              }}>{o}</button>
            ))}
          </div>
        </div>
        <div style={{textAlign:"center", color:"var(--ink-3)", fontSize:12, marginTop:8, fontFamily:"var(--font-mono)"}}>swipe · tap value</div>
      </div>
      <AckFooter/>
    </AckShell>
  );
}

function AckShell({ children }) {
  return (
    <div style={{
      background:"var(--paper)", height:"100%",
      display:"flex", flexDirection:"column",
    }}>
      {/* dimmed top, sheet feels like a partial overlay */}
      <div style={{flex:1, background:"rgba(42,38,32,0.55)", padding:"60px 22px 0"}}>
        <div style={{textAlign:"center", color:"rgba(245,239,227,0.7)", fontSize:12, fontFamily:"var(--font-mono)"}}>
          Tap to ack — long-press to log a value
        </div>
      </div>
      <div style={{
        background:"var(--paper)", borderRadius:"24px 24px 0 0",
        boxShadow:"0 -2px 24px rgba(42,38,32,0.18)",
        position:"relative",
      }}>
        <div style={{width:36, height:4, background:"var(--line)", borderRadius:999, margin:"10px auto 0"}}/>
        {children}
      </div>
    </div>
  );
}

function AckHeader({ title, sub }) {
  return (
    <div style={{display:"flex", gap:12, alignItems:"center", padding:"14px 18px 4px"}}>
      <HowlerAvatar photo="mochi" urgency={2} size={48}/>
      <div style={{flex:1}}>
        <div className="h-serif" style={{fontSize:18}}>{title}</div>
        <div style={{fontSize:12, color:"var(--ink-3)"}}>{sub}</div>
      </div>
      <button style={{background:"transparent", border:"none", color:"var(--ink-mute)", fontSize:18}}>✕</button>
    </div>
  );
}

function AckFooter() {
  return (
    <div style={{display:"flex", gap:8, padding:"18px 18px 22px"}}>
      <button style={{
        flex:1, padding:"14px", border:"1px solid var(--line)", borderRadius:14,
        background:"transparent", color:"var(--ink-2)", fontSize:14, fontWeight:500,
      }}>Skip value</button>
      <button style={{
        flex:1.4, padding:"14px", border:"none", borderRadius:14,
        background:"var(--ink)", color:"var(--paper)", fontSize:14, fontWeight:500,
        display:"flex", alignItems:"center", justifyContent:"center", gap:8,
      }}>
        <IA3 name="check" size={16}/> Mark done
      </button>
    </div>
  );
}

function CircleBtn({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      width:48, height:48, borderRadius:"50%",
      border:"1.5px solid var(--line)", background:"transparent",
      fontFamily:"Fraunces, Georgia, serif", fontSize:24, fontWeight:400, color:"var(--ink)",
    }}>{children}</button>
  );
}

window.ACK_VARIANTS = { AckSheetStepper, AckSheetSlider, AckSheetWheel };
