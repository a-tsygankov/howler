/* global React, HOWLER_DATA, HowlerAvatar, HOWLER_ICONS */
const { IconA } = HOWLER_ICONS;
const D = HOWLER_DATA;

// Helper: get user initials/colors
const userById = (id) => D.users.find(u => u.id === id);
const labelById = (id) => D.labels.find(l => l.id === id);
const labelIcon = (lbl) => ({pets:"paw",chores:"broom",personal:"heart",work:"briefcase",health:"pill"}[lbl?.icon] || lbl?.icon || "sparkle");

// ============================================================
// VARIANT 1 — "Day Ribbon" — switchable: by time-of-day or by label
// Minimal-utility list. Header: date + user avatar. Progress bar below.
// ============================================================
function HomeV1() {
  const [groupBy, setGroupBy] = React.useState("time"); // "time" | "label"
  const byTime = [
    { name: "Morning",  hour: "07:00–11:00", items: D.tasks.filter(t => ["07:30","08:00","09:00","10:00"].includes(t.due)) },
    { name: "Afternoon", hour: "12:00–17:00", items: D.tasks.filter(t => t.due === "today" && t.label !== "l-personal").slice(0,2) },
    { name: "Evening",   hour: "17:00–22:00", items: D.tasks.filter(t => ["17:30","21:00","tonight"].includes(t.due)) },
  ];
  const byLabel = D.labels
    .map(l => ({ name: l.name, color: l.color, icon: labelIcon(l), items: D.tasks.filter(t => t.label === l.id) }))
    .filter(g => g.items.length);
  const groups = groupBy === "time" ? byTime : byLabel;
  return (
    <div style={{padding:"0 0 100px", background:"var(--paper)", minHeight:"100%"}}>
      <header style={{padding:"18px 22px 6px", display:"flex", justifyContent:"space-between", alignItems:"flex-start"}}>
        <div>
          <div className="cap">Wednesday · May 6</div>
          <div className="h-serif" style={{fontSize:18, marginTop:6, color:"var(--ink-2)"}}>5 left today</div>
        </div>
        <HowlerAvatar initials="AX" size={36} urgency={0}/>
      </header>
      <div style={{padding:"10px 22px 12px"}}>
        <ProgressBar value={4} max={9}/>
      </div>
      <div style={{padding:"4px 22px 8px", display:"flex", gap:6}}>
        <SegBtn active={groupBy==="time"}  onClick={() => setGroupBy("time")}>By time</SegBtn>
        <SegBtn active={groupBy==="label"} onClick={() => setGroupBy("label")}>By label</SegBtn>
      </div>
      {groups.map((g,gi) => (
        <section key={g.name} style={{padding:"6px 0 2px"}}>
          <div style={{display:"flex", alignItems:"center", gap:10, padding:"10px 22px 8px"}}>
            {g.color && <span style={{width:8, height:8, borderRadius:"50%", background:g.color}}/>}
            <div className="h-serif" style={{fontSize:16}}>{g.name}</div>
            {g.hour && <div className="cap">{g.hour}</div>}
            <div style={{flex:1}}/>
            <div className="mono" style={{fontSize:10, color:"var(--ink-3)"}}>{g.items.length}</div>
          </div>
          <div>
            {g.items.map((t, i) => <DayRibbonRow key={t.id} t={t} done={i===0 && gi===0}/>)}
          </div>
        </section>
      ))}
    </div>
  );
}

function SegBtn({ active, children, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding:"6px 12px", borderRadius:999, fontSize:12,
      border:"1px solid var(--line)",
      background: active ? "var(--ink)" : "transparent",
      color: active ? "var(--paper)" : "var(--ink-2)",
      borderColor: active ? "var(--ink)" : "var(--line)",
      fontFamily:"var(--font-sans)", fontWeight:500,
    }}>{children}</button>
  );
}

function DayRibbonRow({ t, done }) {
  const lbl = labelById(t.label);
  const isOverdue = t.urgency >= 3;
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:12,
      padding:"10px 22px",
      borderTop:"1px solid var(--line-soft)",
      opacity: done ? 0.55 : 1,
    }}>
      <div className="mono" style={{width:46, color:"var(--ink-3)", fontSize:12, textDecoration: done?"line-through":"none"}}>
        {t.due.match(/\d/) ? t.due : "—"}
      </div>
      <HowlerAvatar photo={t.photo} initials={t.initials} urgency={t.urgency} size={38}/>
      <div style={{flex:1, minWidth:0}}>
        <div style={{fontSize:15, fontWeight:500, textDecoration: done?"line-through":"none", color: done?"var(--ink-3)":"var(--ink)"}}>{t.title}</div>
        <div style={{display:"flex", gap:8, alignItems:"center", marginTop:2}}>
          <span style={{fontSize:12, color: lbl.color}}>· {lbl.name}</span>
          {isOverdue && <span style={{fontSize:11, color:"var(--accent-rose)", fontFamily:"var(--font-mono)", textTransform:"uppercase", letterSpacing:".08em"}}>overdue</span>}
        </div>
      </div>
      <button style={{
        width:28, height:28, borderRadius:"50%",
        background: done ? "var(--accent-sage)" : "transparent",
        border: done ? "none" : "1.5px solid var(--line)",
        color: done ? "var(--paper)" : "var(--ink-3)",
        display:"flex", alignItems:"center", justifyContent:"center", padding:0,
      }}>
        {done ? <IconA name="check" size={16}/> : null}
      </button>
    </div>
  );
}

function ProgressBar({ value, max }) {
  const pct = (value/max)*100;
  return (
    <div style={{display:"flex", alignItems:"center", gap:10}}>
      <div style={{flex:1, height:6, background:"var(--paper-3)", borderRadius:999, overflow:"hidden"}}>
        <div style={{width:`${pct}%`, height:"100%", background:"var(--ink)"}}/>
      </div>
      <div className="mono" style={{fontSize:11, color:"var(--ink-3)"}}>{value}/{max}</div>
    </div>
  );
}

// ============================================================
// VARIANT 2 — "Stack" — large warm cards, urgency-first
// Warm-domestic, card, urgency hierarchy
// ============================================================
function HomeV2() {
  const sorted = [...D.tasks].sort((a,b) => b.urgency - a.urgency).slice(0,6);
  return (
    <div style={{padding:"0 0 100px", background:"var(--paper)", minHeight:"100%"}}>
      <header style={{padding:"22px 20px 12px", display:"flex", justifyContent:"space-between", alignItems:"flex-end"}}>
        <div>
          <div className="cap">Today</div>
          <div className="h-display" style={{fontSize:30, marginTop:6}}>Howler</div>
        </div>
        <HowlerAvatar initials="AX" size={36} urgency={0}/>
      </header>
      <div style={{padding:"4px 20px 14px", color:"var(--ink-3)", fontSize:14}}>
        <span style={{color:"var(--accent-rose)", fontWeight:500}}>1 overdue</span> · 4 due now · 4 later
      </div>
      <div style={{padding:"0 16px", display:"flex", flexDirection:"column", gap:10}}>
        {sorted.map((t, i) => <StackCard key={t.id} t={t} hero={i===0}/>)}
      </div>
    </div>
  );
}

function StackCard({ t, hero }) {
  const lbl = labelById(t.label);
  const ring = window.URG_TONES[t.urgency];
  const urgencyLabel = ["later","soon","now","overdue"][t.urgency];
  return (
    <div style={{
      background:"#FBF7EC", border:"1px solid var(--line-soft)", borderRadius:18,
      padding: hero ? "16px 16px 14px" : "12px 14px",
      display:"flex", gap:12, alignItems:"center",
      boxShadow: hero ? "0 6px 16px rgba(42,38,32,0.06)" : "none",
    }}>
      <HowlerAvatar photo={t.photo} initials={t.initials} urgency={t.urgency} size={hero ? 64 : 48}/>
      <div style={{flex:1, minWidth:0}}>
        <div style={{display:"flex", alignItems:"center", gap:8}}>
          <span style={{fontSize:11, fontFamily:"var(--font-mono)", textTransform:"uppercase", letterSpacing:".08em", color: ring}}>{urgencyLabel}</span>
          {t.due.match(/\d/) && <span className="mono" style={{fontSize:11, color:"var(--ink-3)"}}>{t.due}</span>}
        </div>
        <div className="h-serif" style={{fontSize: hero?22:17, marginTop:2, lineHeight:1.15}}>{t.title}</div>
        <div style={{display:"flex", gap:8, alignItems:"center", marginTop:6}}>
          <LabelChip lbl={lbl}/>
          <AssigneeStack ids={t.assignees} size={18}/>
        </div>
      </div>
      <DoneButton hero={hero}/>
    </div>
  );
}

function LabelChip({ lbl }) {
  return (
    <span style={{
      display:"inline-flex", alignItems:"center", gap:5,
      fontSize:11, padding:"3px 8px", borderRadius:999,
      background: `${lbl.color}1a`, color: lbl.color, fontWeight:500,
    }}>
      <IconA name={labelIcon(lbl)} size={11}/>
      {lbl.name}
    </span>
  );
}

function AssigneeStack({ ids, size = 18 }) {
  return (
    <div style={{display:"inline-flex"}}>
      {ids.map((uid, i) => {
        const u = userById(uid);
        return (
          <div key={uid} style={{
            width:size, height:size, borderRadius:"50%",
            background:u.color, color:"#F5EFE3",
            fontSize: size*0.42, fontWeight:600,
            display:"flex", alignItems:"center", justifyContent:"center",
            marginLeft: i ? -6 : 0, border:"1.5px solid #FBF7EC",
            fontFamily:"var(--font-sans)",
          }}>{u.initials[0]}</div>
        );
      })}
    </div>
  );
}

function DoneButton({ hero }) {
  return (
    <button style={{
      width: hero?52:40, height: hero?52:40, borderRadius:"50%",
      background:"var(--ink)", color:"var(--paper)",
      border:"none", display:"flex", alignItems:"center", justifyContent:"center",
      flex:"none",
    }}>
      <IconA name="check" size={hero?22:18}/>
    </button>
  );
}

// ============================================================
// VARIANT 3 — "Rooms" — grouped by label, dense list
// Minimal-utility, list, label-grouped hierarchy
// ============================================================
function HomeV3() {
  const grouped = D.labels.map(l => ({ label: l, items: D.tasks.filter(t => t.label === l.id) })).filter(g => g.items.length);
  return (
    <div style={{padding:"0 0 100px", background:"var(--paper)", minHeight:"100%"}}>
      <header style={{padding:"22px 22px 14px"}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
          <div className="h-display" style={{fontSize:28}}>Rooms</div>
          <button className="btn btn-ghost" style={{padding:"6px 8px"}}><IconA name="filter" size={18}/></button>
        </div>
        <div style={{color:"var(--ink-3)", fontSize:13, marginTop:4}}>4 of 9 done today</div>
      </header>
      {grouped.map(g => (
        <section key={g.label.id} style={{marginBottom:8}}>
          <div style={{
            display:"flex", alignItems:"center", justifyContent:"space-between",
            padding:"10px 22px", background:`${g.label.color}10`,
            borderTop:"1px solid var(--line-soft)", borderBottom:"1px solid var(--line-soft)",
          }}>
            <div style={{display:"flex", alignItems:"center", gap:8}}>
              <div style={{width:22, height:22, borderRadius:"50%", background:g.label.color, color:"#F5EFE3", display:"flex", alignItems:"center", justifyContent:"center"}}>
                <IconA name={labelIcon(g.label)} size={12}/>
              </div>
              <span className="h-serif" style={{fontSize:16}}>{g.label.name}</span>
            </div>
            <span className="mono" style={{fontSize:11, color:"var(--ink-3)"}}>{g.items.length}</span>
          </div>
          {g.items.map(t => <RoomRow key={t.id} t={t}/>)}
        </section>
      ))}
    </div>
  );
}

function RoomRow({ t }) {
  return (
    <div style={{display:"flex", alignItems:"center", gap:12, padding:"10px 22px", borderBottom:"1px solid var(--line-soft)"}}>
      <HowlerAvatar photo={t.photo} initials={t.initials} urgency={t.urgency} size={32}/>
      <div style={{flex:1, minWidth:0}}>
        <div style={{fontSize:14, fontWeight:500}}>{t.title}</div>
        <div style={{fontSize:12, color:"var(--ink-3)", display:"flex", gap:8}}>
          <span>{t.due}</span><span>·</span><span>{t.kind.toLowerCase()}</span>
        </div>
      </div>
      <AssigneeStack ids={t.assignees} size={18}/>
      <button style={{width:24, height:24, border:"1.5px solid var(--line)", borderRadius:"50%", background:"transparent"}}/>
    </div>
  );
}

// ============================================================
// VARIANT 4 — "Hearth" — playful big avatars, swipe-deck feel
// Playful warm-domestic, card stack, urgency hierarchy
// ============================================================
function HomeV4() {
  const top3 = [...D.tasks].sort((a,b) => b.urgency - a.urgency).slice(0,3);
  const rest = D.tasks.filter(t => !top3.includes(t)).slice(0,4);
  return (
    <div style={{padding:"0 0 110px", background:"var(--paper)", minHeight:"100%"}}>
      <header style={{padding:"18px 22px 4px", display:"flex", justifyContent:"space-between", alignItems:"center"}}>
        <div className="cap">May 6 · Morning</div>
        <div style={{display:"flex", gap:6}}>
          <HowlerAvatar initials="AX" size={28}/>
          <HowlerAvatar initials="SM" size={28}/>
        </div>
      </header>
      <div style={{padding:"8px 22px 14px"}}>
        <div className="h-display" style={{fontSize:32, lineHeight:1.05}}>What needs<br/>doing.</div>
      </div>

      {/* Hero card */}
      <div style={{padding:"6px 18px 14px"}}>
        <HearthHero t={top3[0]}/>
      </div>

      {/* Smaller upcoming */}
      <div style={{padding:"0 18px 12px"}}>
        <div className="cap" style={{padding:"6px 4px 8px"}}>Up next</div>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}}>
          {top3.slice(1).concat(rest).slice(0,4).map(t => <HearthMini key={t.id} t={t}/>)}
        </div>
      </div>
    </div>
  );
}

function HearthHero({ t }) {
  const lbl = labelById(t.label);
  const ring = window.URG_TONES[t.urgency];
  return (
    <div style={{
      background:`linear-gradient(160deg, #FBF7EC 0%, #F0E6CF 100%)`,
      border:"1px solid var(--line-soft)", borderRadius:24,
      padding:"18px 18px 16px",
      position:"relative", overflow:"hidden",
    }}>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start"}}>
        <span style={{fontSize:11, fontFamily:"var(--font-mono)", textTransform:"uppercase", letterSpacing:".1em", color:ring}}>● {["later","soon","due now","overdue"][t.urgency]}</span>
        <span className="mono" style={{fontSize:11, color:"var(--ink-3)"}}>{t.due}</span>
      </div>
      <div style={{display:"flex", gap:14, alignItems:"center", marginTop:14}}>
        <HowlerAvatar photo={t.photo} initials={t.initials} urgency={t.urgency} size={88} ringWidth={4}/>
        <div style={{flex:1}}>
          <div className="h-display" style={{fontSize:24, lineHeight:1.1}}>{t.title}</div>
          <div style={{fontSize:13, color:"var(--ink-3)", marginTop:4}}>{t.desc || "—"}</div>
        </div>
      </div>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:16}}>
        <LabelChip lbl={lbl}/>
        <button style={{
          background:"var(--ink)", color:"var(--paper)", border:"none",
          padding:"10px 18px", borderRadius:999, fontSize:14, fontWeight:500,
          display:"flex", gap:8, alignItems:"center",
        }}>
          <IconA name="check" size={16}/> Mark done
        </button>
      </div>
    </div>
  );
}

function HearthMini({ t }) {
  const lbl = labelById(t.label);
  return (
    <div style={{
      background:"#FBF7EC", border:"1px solid var(--line-soft)", borderRadius:16,
      padding:"12px", display:"flex", flexDirection:"column", gap:10, minHeight:118,
    }}>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
        <HowlerAvatar photo={t.photo} initials={t.initials} urgency={t.urgency} size={36}/>
        <span className="mono" style={{fontSize:10, color:"var(--ink-3)"}}>{t.due}</span>
      </div>
      <div>
        <div style={{fontSize:13, fontWeight:500, lineHeight:1.2}}>{t.title}</div>
        <div style={{fontSize:11, color:lbl.color, marginTop:2}}>{lbl.name}</div>
      </div>
    </div>
  );
}

// ============================================================
// Bottom tab bar (shared)
// ============================================================
function BottomTabs({ active = "home" }) {
  const tabs = [
    { id:"home", icon:"home", label:"Today" },
    { id:"all", icon:"calendar", label:"Tasks" },
    { id:"add", icon:"plus", label:"" },
    { id:"stats", icon:"sparkle", label:"Stats" },
    { id:"me", icon:"more", label:"Me" },
  ];
  return (
    <div style={{
      position:"absolute", left:0, right:0, bottom:0,
      padding:"10px 14px 18px",
      background:"linear-gradient(180deg, rgba(245,239,227,0) 0%, rgba(245,239,227,1) 30%)",
    }}>
      <div style={{
        display:"flex", justifyContent:"space-around", alignItems:"center",
        background:"rgba(255,253,247,0.96)", backdropFilter:"blur(10px)",
        border:"1px solid var(--line-soft)", borderRadius:999,
        padding:"6px 8px", boxShadow:"0 4px 14px rgba(42,38,32,0.06)",
      }}>
        {tabs.map(t => {
          const isAdd = t.id === "add";
          const isActive = t.id === active;
          if (isAdd) return (
            <button key={t.id} style={{
              width:44, height:44, borderRadius:"50%",
              background:"var(--ink)", color:"var(--paper)",
              border:"none", display:"flex", alignItems:"center", justifyContent:"center",
            }}><IconA name="plus" size={20}/></button>
          );
          return (
            <button key={t.id} style={{
              display:"flex", flexDirection:"column", alignItems:"center", gap:2,
              padding:"6px 10px", border:"none", background:"transparent",
              color: isActive ? "var(--ink)" : "var(--ink-mute)",
            }}>
              <IconA name={t.icon} size={20}/>
              <span style={{fontSize:10, fontWeight: isActive ? 600 : 400}}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

window.HOME_VARIANTS = { HomeV1, HomeV2, HomeV3, HomeV4, BottomTabs, LabelChip, AssigneeStack, DoneButton };
