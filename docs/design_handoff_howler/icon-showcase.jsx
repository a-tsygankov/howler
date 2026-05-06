/* global React, HOWLER_ICONS */
const { IconA: IA5, IconB: IB5, IconC: IC5, NAMES } = HOWLER_ICONS;

const ICON_SHOW = ["paw","broom","heart","briefcase","pill","plant","bowl","bell","clock","calendar","flame","star","dog","cat","home","tooth","run","book","sparkle","check"];

function IconSet({ Comp, title, sub, accent }) {
  return (
    <div style={{padding:"22px 24px", background:"#FBF7EC", borderRadius:18, border:"1px solid var(--line-soft)"}}>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:18}}>
        <div>
          <div className="h-display" style={{fontSize:22}}>{title}</div>
          <div style={{fontSize:13, color:"var(--ink-3)", marginTop:2}}>{sub}</div>
        </div>
        <div style={{
          width:36, height:36, borderRadius:"50%",
          background: accent, color:"#F5EFE3",
          display:"flex", alignItems:"center", justifyContent:"center",
        }}>
          <Comp name="paw" size={20} color="#F5EFE3"/>
        </div>
      </div>
      <div style={{display:"grid", gridTemplateColumns:"repeat(5, 1fr)", gap:14}}>
        {ICON_SHOW.map(n => (
          <div key={n} style={{display:"flex", flexDirection:"column", alignItems:"center", gap:6, padding:"10px 4px", background:"var(--paper)", borderRadius:10}}>
            <Comp name={n} size={28} color="var(--ink)"/>
            <span className="mono" style={{fontSize:9, color:"var(--ink-3)"}}>{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Three icon panels, one per set
function IconShowcaseA() { return <IconSet Comp={IA5} title="Set A — Hand-drawn line" sub="Warm, organic, slightly hand-feeling. The default for Howler." accent="#C77A2A"/>; }
function IconShowcaseB() { return <IconSet Comp={IB5} title="Set B — Solid friendly" sub="Filled geometric, optimistic, more assertive at small sizes." accent="#6E8A5C"/>; }
function IconShowcaseC() { return <IconSet Comp={IC5} title="Set C — Editorial mark" sub="Crisp, low-weight, calmer in dense lists." accent="#8A5B7A"/>; }

window.ICON_SHOWCASES = { IconShowcaseA, IconShowcaseB, IconShowcaseC };
