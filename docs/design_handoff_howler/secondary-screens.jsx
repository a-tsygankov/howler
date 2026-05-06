/* global React, HOWLER_DATA, HowlerAvatar, HOWLER_ICONS, HOME_VARIANTS */
const D2 = HOWLER_DATA;
const { IconA: IA, IconB: IB } = HOWLER_ICONS;
const { LabelChip: LChip, AssigneeStack: AStack } = HOME_VARIANTS;

const userById2 = (id) => D2.users.find(u => u.id === id);
const labelById2 = (id) => D2.labels.find(l => l.id === id);

// ============================================================
// TASK LIST / BROWSE — filterable list
// ============================================================
function TaskList() {
  return (
    <div style={{padding:"0 0 100px", background:"var(--paper)", minHeight:"100%"}}>
      <header style={{padding:"22px 22px 12px"}}>
        <div className="h-display" style={{fontSize:28}}>All tasks</div>
        <div style={{display:"flex", gap:8, marginTop:14, overflowX:"auto", paddingBottom:6}}>
          <Pill active>All <span className="mono" style={{opacity:.6, marginLeft:4}}>10</span></Pill>
          <Pill>Pets <span className="mono" style={{opacity:.6, marginLeft:4}}>3</span></Pill>
          <Pill>Chores <span className="mono" style={{opacity:.6, marginLeft:4}}>2</span></Pill>
          <Pill>Personal <span className="mono" style={{opacity:.6, marginLeft:4}}>3</span></Pill>
          <Pill>Health</Pill>
          <Pill>Work</Pill>
        </div>
      </header>
      <div style={{padding:"4px 22px 8px", display:"flex", justifyContent:"space-between", alignItems:"center"}}>
        <div className="cap">Active</div>
        <div style={{display:"flex", gap:6}}>
          <button className="btn btn-ghost" style={{padding:"4px 8px", fontSize:12}}><IA name="filter" size={14}/> By due</button>
        </div>
      </div>
      {D2.tasks.map(t => <TaskListRow key={t.id} t={t}/>)}
    </div>
  );
}

function Pill({ active, children }) {
  return (
    <button style={{
      flex:"none",
      padding:"6px 12px", borderRadius:999, fontSize:13,
      border:"1px solid var(--line)",
      background: active ? "var(--ink)" : "transparent",
      color: active ? "var(--paper)" : "var(--ink-2)",
      borderColor: active ? "var(--ink)" : "var(--line)",
      fontFamily:"var(--font-sans)",
    }}>{children}</button>
  );
}

function TaskListRow({ t }) {
  const lbl = labelById2(t.label);
  const kindMeta = { DAILY:{label:"daily", icon:"clock"}, PERIODIC:{label:"every 3d", icon:"calendar"}, ONESHOT:{label:"once", icon:"flame"} };
  const km = kindMeta[t.kind];
  return (
    <div style={{display:"flex", gap:12, alignItems:"center", padding:"12px 22px", borderBottom:"1px solid var(--line-soft)"}}>
      <HowlerAvatar photo={t.photo} initials={t.initials} urgency={t.urgency} size={40}/>
      <div style={{flex:1, minWidth:0}}>
        <div style={{fontSize:15, fontWeight:500}}>{t.title}</div>
        <div style={{fontSize:12, color:"var(--ink-3)", display:"flex", gap:8, alignItems:"center", marginTop:3}}>
          <span style={{display:"inline-flex", gap:4, alignItems:"center"}}><IA name={km.icon} size={11}/>{km.label}</span>
          <span>·</span>
          <span style={{color: lbl.color}}>{lbl.name}</span>
          <span>·</span>
          <span>{t.due}</span>
        </div>
      </div>
      <AStack ids={t.assignees} size={20}/>
    </div>
  );
}

// ============================================================
// TASK DETAIL — with execution history
// ============================================================
function TaskDetail({ taskId = "t1" }) {
  const t = D2.tasks.find(x => x.id === taskId);
  const lbl = labelById2(t.label);
  const rt = D2.resultTypes.find(r => r.id === t.resultType);
  const execs = D2.executions.filter(e => e.taskId === t.id);
  return (
    <div style={{padding:"0 0 100px", background:"var(--paper)", minHeight:"100%"}}>
      {/* hero band */}
      <div style={{
        background:`linear-gradient(180deg, ${lbl.color}1f 0%, transparent 100%)`,
        padding:"18px 22px 16px",
      }}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
          <button className="btn btn-ghost" style={{padding:"4px 8px", margin:"0 -8px"}}><IA name="more" size={18} color="var(--ink)"/></button>
          <button className="btn btn-ghost" style={{padding:"4px 8px"}}><IA name="more" size={18}/></button>
        </div>
        <div style={{display:"flex", gap:14, alignItems:"center", marginTop:6}}>
          <HowlerAvatar photo={t.photo} initials={t.initials} urgency={t.urgency} size={72}/>
          <div style={{flex:1}}>
            <div className="h-display" style={{fontSize:26, lineHeight:1.1}}>{t.title}</div>
            <div style={{fontSize:13, color:"var(--ink-3)", marginTop:4}}>{t.desc}</div>
          </div>
        </div>
        <div style={{display:"flex", gap:8, marginTop:14, flexWrap:"wrap"}}>
          <LChip lbl={lbl}/>
          <span style={{fontSize:11, padding:"3px 8px", borderRadius:999, background:"var(--paper-2)", color:"var(--ink-3)"}}>
            {t.kind === "DAILY" ? "Every day · 08:00" : t.kind === "PERIODIC" ? "Every 3 days" : "Once · by Fri"}
          </span>
          <span style={{fontSize:11, padding:"3px 8px", borderRadius:999, background:"var(--paper-2)", color:"var(--ink-3)"}}>
            Assignees: {t.assignees.map(id => userById2(id).name).join(", ")}
          </span>
        </div>
      </div>

      {/* Stats strip */}
      {rt && (
        <div style={{padding:"4px 22px 4px"}}>
          <div className="cap" style={{padding:"14px 0 8px"}}>Last 7 days · {rt.name.toLowerCase()}</div>
          <SparkChart data={execs.map(e => e.value).reverse()} unit={rt.unit}/>
        </div>
      )}

      {/* Quick stats */}
      <div style={{padding:"6px 22px 4px", display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8}}>
        <Stat label="Streak" value="7d"/>
        <Stat label="Avg" value="50gr"/>
        <Stat label="Skipped" value="1"/>
      </div>

      {/* History list */}
      <div style={{padding:"18px 0 0"}}>
        <div className="cap" style={{padding:"4px 22px 10px"}}>History</div>
        {execs.map(e => (
          <div key={e.id} style={{display:"flex", gap:12, padding:"10px 22px", borderTop:"1px solid var(--line-soft)", alignItems:"center"}}>
            <div style={{width:28, height:28, borderRadius:"50%", background:userById2(e.user).color, color:"#F5EFE3", fontSize:11, fontWeight:600, display:"flex", alignItems:"center", justifyContent:"center"}}>{userById2(e.user).initials[0]}</div>
            <div style={{flex:1}}>
              <div style={{fontSize:13, fontWeight:500}}>{userById2(e.user).name} · {e.value}{e.unit}</div>
              <div style={{fontSize:11, color:"var(--ink-3)"}}>{e.date}{e.notes ? ` — ${e.notes}` : ""}</div>
            </div>
            <IA name="check" size={14} color="var(--accent-sage)"/>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{background:"#FBF7EC", borderRadius:14, padding:"10px 12px", border:"1px solid var(--line-soft)"}}>
      <div className="cap" style={{fontSize:10}}>{label}</div>
      <div className="h-serif" style={{fontSize:22, marginTop:2}}>{value}</div>
    </div>
  );
}

function SparkChart({ data, unit }) {
  const w = 320, h = 80, pad = 10;
  const max = Math.max(...data) * 1.1;
  const stepX = (w - pad*2) / (data.length - 1);
  const points = data.map((v, i) => [pad + i*stepX, h - pad - (v/max)*(h - pad*2)]);
  const path = "M" + points.map(p => p.join(",")).join(" L");
  const area = path + ` L${w-pad},${h-pad} L${pad},${h-pad} Z`;
  return (
    <div style={{background:"#FBF7EC", borderRadius:14, padding:14, border:"1px solid var(--line-soft)"}}>
      <svg viewBox={`0 0 ${w} ${h}`} style={{width:"100%", height:"auto"}}>
        <path d={area} fill="var(--accent-amber)" opacity=".15"/>
        <path d={path} stroke="var(--accent-amber)" strokeWidth="1.8" fill="none"/>
        {points.map((p,i) => <circle key={i} cx={p[0]} cy={p[1]} r="2.5" fill="var(--accent-amber)"/>)}
      </svg>
      <div style={{display:"flex", justifyContent:"space-between", marginTop:6}}>
        <span className="mono" style={{fontSize:10, color:"var(--ink-3)"}}>7 days ago</span>
        <span className="mono" style={{fontSize:10, color:"var(--ink-3)"}}>today · 50{unit}</span>
      </div>
    </div>
  );
}

// ============================================================
// TASK RESULT TYPES MANAGER
// ============================================================
function ResultTypesManager() {
  return (
    <div style={{padding:"0 0 100px", background:"var(--paper)", minHeight:"100%"}}>
      <header style={{padding:"22px 22px 12px"}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start"}}>
          <div>
            <div className="cap">Settings</div>
            <div className="h-display" style={{fontSize:26, marginTop:4}}>Result types</div>
          </div>
          <button className="btn btn-primary" style={{padding:"6px 12px", fontSize:13}}><IA name="plus" size={14}/> New</button>
        </div>
        <div style={{color:"var(--ink-3)", fontSize:13, marginTop:6, lineHeight:1.4}}>
          Numeric values you can record when completing a task — like grams of cat food, or pushups.
        </div>
      </header>

      <div className="cap" style={{padding:"14px 22px 8px"}}>Defaults</div>
      {D2.resultTypes.map(rt => <ResultTypeRow key={rt.id} rt={rt}/>)}

      <div className="cap" style={{padding:"22px 22px 8px"}}>Custom</div>
      <div style={{padding:"22px", textAlign:"center", border:"1px dashed var(--line)", borderRadius:14, margin:"0 22px", color:"var(--ink-3)", fontSize:13}}>
        No custom types yet.
      </div>
    </div>
  );
}

function ResultTypeRow({ rt }) {
  const unitMap = {times:"plus", gr:"sparkle", min:"clock", star:"star", "%":"sparkle"};
  return (
    <div style={{display:"flex", gap:12, alignItems:"center", padding:"12px 22px", borderTop:"1px solid var(--line-soft)"}}>
      <div style={{width:40, height:40, borderRadius:12, background:"var(--paper-2)", border:"1px solid var(--line-soft)", display:"flex", alignItems:"center", justifyContent:"center", color:"var(--ink-2)"}}>
        <IA name={unitMap[rt.unit] || "sparkle"} size={20}/>
      </div>
      <div style={{flex:1}}>
        <div style={{display:"flex", alignItems:"center", gap:8}}>
          <span style={{fontSize:15, fontWeight:500}}>{rt.name}</span>
          <span className="mono" style={{fontSize:11, color:"var(--ink-3)", padding:"1px 6px", border:"1px solid var(--line-soft)", borderRadius:6}}>{rt.unit}</span>
        </div>
        <div style={{fontSize:12, color:"var(--ink-3)", marginTop:3}}>
          {rt.min !== null ? `${rt.min}` : "—"} → {rt.max !== null ? rt.max : "∞"} · step {rt.step}
          {rt.useLast ? " · pre-fills last" : ""}
        </div>
      </div>
      <IA name="more" size={18} color="var(--ink-mute)"/>
    </div>
  );
}

window.SECONDARY_SCREENS = { TaskList, TaskDetail, ResultTypesManager };
