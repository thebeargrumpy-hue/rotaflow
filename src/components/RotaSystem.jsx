import { useState, useMemo, useEffect } from "react";
import {
  DAYS, FULL_DAYS, HALF_HOURS,
  LOCATIONS, SHIFT_TYPES, ROLES, VIEW_MODES, STAFF_COLORS, WAGE_RATE,
  INITIAL_STAFF, INITIAL_SHIFTS,
} from "../constants";
import { calcHours, getMondayOf, addDays, fmtDate, isWeekend } from "../utils";

export default function RotaSystem() {
  const [activeTab,      setActiveTab]      = useState("rota");
  const [shifts,         setShifts]         = useState(() => {
    try { const s = localStorage.getItem("rotaflow-shifts"); return s ? JSON.parse(s) : INITIAL_SHIFTS; }
    catch { return INITIAL_SHIFTS; }
  });
  const [staff,          setStaff]          = useState(() => {
    try { const s = localStorage.getItem("rotaflow-staff"); return s ? JSON.parse(s) : INITIAL_STAFF; }
    catch { return INITIAL_STAFF; }
  });
  const [weekOffset,     setWeekOffset]     = useState(0);
  const [viewWeeks,      setViewWeeks]      = useState("1");
  const [selectedCell,   setSelectedCell]   = useState(null);
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [showSendModal,  setShowSendModal]  = useState(false);
  const [shiftEdit,      setShiftEdit]      = useState({ start:"09:00", end:"17:00", typeIdx:0, locationId:"restaurant", brk:30 });
  const [newStaff,       setNewStaff]       = useState({ name:"", role:ROLES[0], contracted:37.5, email:"" });
  const [filterRole,     setFilterRole]     = useState("All");
  const [publishedWeeks, setPublishedWeeks] = useState(() => {
    try { const s = localStorage.getItem("rotaflow-publishedWeeks"); return s ? new Set(JSON.parse(s)) : new Set(); }
    catch { return new Set(); }
  });
  const [notification,   setNotification]   = useState(null);
  const [sendingEmail,   setSendingEmail]   = useState(false);

  useEffect(() => { localStorage.setItem("rotaflow-shifts",         JSON.stringify(shifts));            }, [shifts]);
  useEffect(() => { localStorage.setItem("rotaflow-staff",          JSON.stringify(staff));             }, [staff]);
  useEffect(() => { localStorage.setItem("rotaflow-publishedWeeks", JSON.stringify([...publishedWeeks])); }, [publishedWeeks]);

  const numWeeks = parseInt(viewWeeks);

  const weekStarts = useMemo(()=>{
    const base=new Date(); base.setDate(base.getDate()+weekOffset*7);
    const mon=getMondayOf(base);
    return Array.from({length:numWeeks},(_,i)=>addDays(mon,i*7));
  },[weekOffset,numWeeks]);

  const allDays = useMemo(()=>
    weekStarts.flatMap((ws,wi)=>
      Array.from({length:7},(_,di)=>({ date:addDays(ws,di), weekIdx:wi, dayIdx:di, key:`w${wi}d${di}` }))
    ),[weekStarts]);

  const periodLabel = useMemo(()=>{
    const f=weekStarts[0], l=addDays(weekStarts[weekStarts.length-1],6);
    return `${fmtDate(f,{day:"numeric",month:"short"})} – ${fmtDate(l,{day:"numeric",month:"short",year:"numeric"})}`;
  },[weekStarts]);

  const filteredStaff = filterRole==="All"?staff:staff.filter(s=>s.role===filterRole);

  const staffStats = useMemo(()=>{
    const map={};
    staff.forEach(s=>{
      let hours=0, wkndShifts=0;
      allDays.forEach(({weekIdx,dayIdx})=>{
        const k=`${s.id}-w${weekIdx}-d${dayIdx}`;
        if(shifts[k]){ hours+=calcHours(shifts[k].start,shifts[k].end,shifts[k].brk); if(isWeekend(dayIdx))wkndShifts++; }
      });
      map[s.id]={hours,wkndShifts};
    });
    return map;
  },[shifts,staff,allDays]);

  const weekendRanking = useMemo(()=>
    [...staff].map(s=>({...s,totalWknds:s.weekendsWorked+(staffStats[s.id]?.wkndShifts||0)}))
              .sort((a,b)=>a.totalWknds-b.totalWknds)
  ,[staff,staffStats]);

  const totalWageCost = useMemo(()=>Object.values(staffStats).reduce((a,s)=>a+s.hours,0)*WAGE_RATE,[staffStats]);

  function openShiftModal(staffId,weekIdx,dayIdx){
    const key=`${staffId}-w${weekIdx}-d${dayIdx}`;
    setSelectedCell({staffId,weekIdx,dayIdx,key});
    setShiftEdit(shifts[key]||{start:"09:00",end:"17:00",typeIdx:0,locationId:"restaurant",brk:30});
    setShowShiftModal(true);
  }

  function saveShift(){
    const wasEmpty=!shifts[selectedCell.key];
    setShifts(p=>({...p,[selectedCell.key]:{...shiftEdit}}));
    if(wasEmpty&&isWeekend(selectedCell.dayIdx))
      setStaff(p=>p.map(s=>s.id===selectedCell.staffId?{...s,weekendsWorked:s.weekendsWorked+1}:s));
    setShowShiftModal(false); showNotif("Shift saved ✓");
  }

  function deleteShift(){
    const existing=shifts[selectedCell.key];
    setShifts(p=>{const n={...p};delete n[selectedCell.key];return n;});
    if(existing&&isWeekend(selectedCell.dayIdx))
      setStaff(p=>p.map(s=>s.id===selectedCell.staffId?{...s,weekendsWorked:Math.max(0,s.weekendsWorked-1)}:s));
    setShowShiftModal(false); showNotif("Shift removed");
  }

  function addStaff(){
    if(!newStaff.name.trim())return;
    const id=Date.now(), initials=newStaff.name.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
    setStaff(p=>[...p,{id,name:newStaff.name,role:newStaff.role,email:newStaff.email,avatar:initials,contracted:Number(newStaff.contracted),color:STAFF_COLORS[p.length%STAFF_COLORS.length],weekendsWorked:0}]);
    setNewStaff({name:"",role:ROLES[0],contracted:37.5,email:""});
    setShowStaffModal(false); showNotif("Staff member added ✓");
  }

  function removeStaff(id){
    setStaff(p=>p.filter(s=>s.id!==id));
    setShifts(p=>{const n={...p};Object.keys(n).forEach(k=>{if(k.startsWith(`${id}-`))delete n[k];});return n;});
  }

  function publishRota(){
    const s=new Set(publishedWeeks); weekStarts.forEach((_,wi)=>s.add(`${weekOffset}-${wi}`)); setPublishedWeeks(s);
    showNotif("Rota published ✓");
  }

  function simulateSend(){
    setSendingEmail(true); setShowSendModal(false);
    setTimeout(()=>{ setSendingEmail(false); showNotif(`📧 Rota sent to ${staff.filter(s=>s.email).length} staff ✓`); },1800);
  }

  function showNotif(msg){ setNotification(msg); setTimeout(()=>setNotification(null),3000); }

  const getLoc  = id => LOCATIONS.find(l=>l.id===id)||LOCATIONS[0];
  const getStype= idx=> SHIFT_TYPES[idx]||SHIFT_TYPES[0];
  const isPublished = weekStarts.every((_,wi)=>publishedWeeks.has(`${weekOffset}-${wi}`));

  return (
    <div style={{fontFamily:"'DM Sans',sans-serif",background:"var(--background)",minHeight:"100vh",color:"var(--foreground)"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>

      {notification&&(
        <div style={{position:"fixed",top:18,right:18,background:"var(--sidebar)",color:"var(--sidebar-foreground)",padding:"10px 18px",borderRadius:8,fontSize:13,fontWeight:500,zIndex:9999,boxShadow:"0 4px 20px rgba(0,0,0,.25)",animation:"sIn .2s ease"}}>
          {notification}
        </div>
      )}

      <style>{`
        @keyframes sIn{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:translateX(0)}}
        @keyframes fUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .cell:hover{background:#dce6f0!important;cursor:pointer}
        .chip:hover{opacity:.82;cursor:pointer}
        ::-webkit-scrollbar{height:5px;width:5px}::-webkit-scrollbar-thumb{background:#CBD5E0;border-radius:3px}
        .tb{background:none;border:none;cursor:pointer;font-family:inherit;font-size:13px;font-weight:500;padding:7px 13px;border-radius:6px;color:#94a3b8;transition:all .15s}
        .tb:hover{background:var(--sidebar-accent);color:var(--sidebar-foreground)}.tb.on{background:#fff;color:var(--foreground)}
        select,input{font-family:inherit;outline:none}
      `}</style>

      {/* NAV */}
      <div style={{background:"var(--sidebar)",padding:"0 18px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",height:56}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:30,height:30,background:"linear-gradient(135deg,#6366f1,#8b5cf6)",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>⚡</div>
            <span style={{fontSize:16,fontWeight:700,color:"var(--sidebar-foreground)"}}>RotaFlow</span>
            <span style={{background:"var(--sidebar-accent)",color:"#94a3b8",fontSize:10,padding:"2px 7px",borderRadius:4,fontWeight:500}}>NMA Catering</span>
          </div>
          <div style={{display:"flex",gap:1}}>
            {[["rota","📅 Rota"],["staff","👥 Staff"],["weekends","🏖 Weekends"],["reports","📊 Reports"]].map(([t,l])=>(
              <button key={t} className={`tb${activeTab===t?" on":""}`} onClick={()=>setActiveTab(t)}>{l}</button>
            ))}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {sendingEmail&&<span style={{fontSize:12,color:"#94a3b8"}}>Sending…</span>}
            <div style={{width:28,height:28,borderRadius:"50%",background:"#6366f1",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#fff"}}>BM</div>
          </div>
        </div>
      </div>

      {/* ===== ROTA TAB ===== */}
      {activeTab==="rota"&&(
        <div style={{padding:"14px 18px"}}>
          {/* Toolbar */}
          <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:12,flexWrap:"wrap"}}>
            <button onClick={()=>setWeekOffset(w=>w-numWeeks)} style={NB}>‹‹</button>
            <button onClick={()=>setWeekOffset(w=>w-1)}        style={NB}>‹</button>
            <span style={{fontSize:13,fontWeight:600,minWidth:200,textAlign:"center"}}>{periodLabel}</span>
            <button onClick={()=>setWeekOffset(w=>w+1)}        style={NB}>›</button>
            <button onClick={()=>setWeekOffset(w=>w+numWeeks)} style={NB}>››</button>
            <button onClick={()=>setWeekOffset(0)} style={{...NB,padding:"3px 9px",fontSize:11}}>Today</button>
            <div style={{marginLeft:"auto",display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
              <div style={{display:"flex",background:"var(--background)",borderRadius:7,border:"1px solid var(--border)",overflow:"hidden"}}>
                {VIEW_MODES.map(v=>(
                  <button key={v.key} onClick={()=>setViewWeeks(v.key)}
                    style={{border:"none",padding:"5px 11px",fontSize:11,fontFamily:"inherit",fontWeight:600,cursor:"pointer",background:viewWeeks===v.key?"var(--sidebar)":"var(--background)",color:viewWeeks===v.key?"var(--sidebar-foreground)":"var(--muted-foreground)",transition:"all .15s"}}>
                    {v.label}
                  </button>
                ))}
              </div>
              <select value={filterRole} onChange={e=>setFilterRole(e.target.value)} style={SEL}>
                <option value="All">All Roles</option>
                {ROLES.map(r=><option key={r}>{r}</option>)}
              </select>
              <button onClick={()=>setShowStaffModal(true)} style={OB}>+ Staff</button>
              <button onClick={()=>setShowSendModal(true)}  style={OB}>📧 Send</button>
              <button onClick={publishRota} style={{...SB,background:isPublished?"var(--primary)":"var(--primary)"}}>
                {isPublished?"✓ Published":"🚀 Publish"}
              </button>
            </div>
          </div>

          {/* Stats */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
            {[["👤","Staff",staff.length],["📅","Shifts",Object.keys(shifts).length],["⏱","Hours",`${Object.values(staffStats).reduce((a,s)=>a+s.hours,0).toFixed(0)}h`],["💷","Est. Cost",`£${totalWageCost.toFixed(0)}`]].map(([icon,lbl,val])=>(
              <div key={lbl} style={{background:"var(--background)",borderRadius:9,padding:"9px 12px",display:"flex",alignItems:"center",gap:8,border:"1px solid var(--border)"}}>
                <span style={{fontSize:18}}>{icon}</span>
                <div><div style={{fontSize:17,fontWeight:700}}>{val}</div><div style={{fontSize:11,color:"var(--muted-foreground)"}}>{lbl}</div></div>
              </div>
            ))}
          </div>

          {/* Grid */}
          <div style={{overflowX:"auto"}}>
            <div style={{minWidth:200+allDays.length*90}}>
              {/* Week label row */}
              {numWeeks>1&&(
                <div style={{display:"grid",gridTemplateColumns:`190px repeat(${allDays.length},1fr) 66px`}}>
                  <div/>
                  {weekStarts.map((ws,wi)=>(
                    <div key={wi} style={{gridColumn:"span 7",textAlign:"center",background:"var(--sidebar-accent)",color:"var(--muted-foreground)",fontSize:10,fontWeight:700,padding:"3px 0",letterSpacing:".06em",borderLeft:"2px solid var(--sidebar)"}}>
                      WK {wi+1} · {fmtDate(ws,{day:"numeric",month:"short"})} – {fmtDate(addDays(ws,6),{day:"numeric",month:"short"})}
                    </div>
                  ))}
                  <div/>
                </div>
              )}
              {/* Day headers */}
              <div style={{display:"grid",gridTemplateColumns:`190px repeat(${allDays.length},1fr) 66px`,background:"var(--sidebar)",color:"var(--sidebar-foreground)"}}>
                <div style={{padding:"8px 10px",fontSize:10,fontWeight:600,color:"var(--muted-foreground)"}}>STAFF MEMBER</div>
                {allDays.map(({date,dayIdx,key})=>(
                  <div key={key} style={{padding:"5px 2px",textAlign:"center",borderLeft:`1px solid ${isWeekend(dayIdx)?"#3b4f68":"#2d3f55"}`,background:isWeekend(dayIdx)?"#243347":"transparent"}}>
                    <div style={{fontSize:9,color:isWeekend(dayIdx)?"var(--warning)":"#64748b",fontWeight:700}}>{DAYS[dayIdx]}</div>
                    <div style={{fontSize:12,fontWeight:700}}>{date.getDate()}</div>
                    <div style={{fontSize:8,color:"#475569"}}>{fmtDate(date,{month:"short"})}</div>
                  </div>
                ))}
                <div style={{padding:"8px 2px",textAlign:"center",borderLeft:"1px solid #2d3f55",fontSize:9,color:"var(--muted-foreground)",fontWeight:600}}>HRS</div>
              </div>

              {/* Staff rows */}
              {filteredStaff.map((member,mi)=>{
                const stats=staffStats[member.id]||{hours:0,wkndShifts:0};
                const target=member.contracted*numWeeks;
                const over=stats.hours>target;
                return(
                  <div key={member.id} style={{display:"grid",gridTemplateColumns:`190px repeat(${allDays.length},1fr) 66px`,borderTop:"1px solid var(--border)",background:mi%2===0?"var(--background)":"var(--secondary)"}}>
                    <div style={{padding:"5px 8px",display:"flex",alignItems:"center",gap:6}}>
                      <div style={{width:26,height:26,borderRadius:"50%",background:member.color,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,flexShrink:0}}>{member.avatar}</div>
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:11,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:130}}>{member.name}</div>
                        <div style={{fontSize:9,color:"var(--muted-foreground)"}}>{member.role}</div>
                      </div>
                    </div>
                    {allDays.map(({weekIdx,dayIdx,key})=>{
                      const sk=`${member.id}-w${weekIdx}-d${dayIdx}`, shift=shifts[sk];
                      const l=shift?getLoc(shift.locationId):null;
                      const wknd=isWeekend(dayIdx);
                      return(
                        <div key={key} className="cell" onClick={()=>openShiftModal(member.id,weekIdx,dayIdx)}
                          style={{borderLeft:`1px solid ${wknd?"#dce6f0":"#EEF2F7"}`,padding:"2px 2px",minHeight:48,display:"flex",alignItems:"center",justifyContent:"center",background:wknd?(mi%2===0?"#FFF9F0":"#FEF7E8"):"inherit"}}>
                          {shift?(
                            <div className="chip" style={{background:l.bg,border:`1.5px solid ${l.border}`,borderRadius:5,padding:"3px 3px",width:"100%"}}>
                              <div style={{display:"flex",alignItems:"center",gap:2,marginBottom:1}}>
                                <div style={{width:5,height:5,borderRadius:"50%",background:l.dot,flexShrink:0}}/>
                                <span style={{fontSize:8,fontWeight:700,color:l.text}}>{l.short}</span>
                              </div>
                              <div style={{fontSize:9,fontWeight:700,color:getStype(shift.typeIdx).text,fontFamily:"DM Mono,monospace"}}>{shift.start}–{shift.end}</div>
                              <div style={{fontSize:8,color:l.border}}>{calcHours(shift.start,shift.end,shift.brk).toFixed(1)}h</div>
                            </div>
                          ):(
                            <span style={{color:"#C8D6E5",fontSize:15}}>+</span>
                          )}
                        </div>
                      );
                    })}
                    <div style={{borderLeft:"1px solid var(--border)",padding:"4px 3px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                      <div style={{fontSize:12,fontWeight:700,color:over?"var(--destructive)":"var(--foreground)"}}>{stats.hours.toFixed(1)}</div>
                      <div style={{fontSize:8,color:"var(--muted-foreground)"}}>{target}h</div>
                      <div style={{width:28,height:3,background:"var(--secondary)",borderRadius:2,marginTop:2}}>
                        <div style={{width:`${Math.min(100,(stats.hours/target)*100)}%`,height:"100%",background:over?"var(--destructive)":"var(--primary)",borderRadius:2}}/>
                      </div>
                      <div style={{fontSize:8,color:"var(--warning)",marginTop:2}}>🏖{stats.wkndShifts}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div style={{display:"flex",gap:10,marginTop:10,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontSize:10,color:"var(--muted-foreground)",fontWeight:700}}>LOCATIONS:</span>
            {LOCATIONS.map(l=>(
              <div key={l.id} style={{display:"flex",alignItems:"center",gap:4,fontSize:11}}>
                <div style={{width:9,height:9,borderRadius:2,background:l.bg,border:`1.5px solid ${l.border}`}}/>
                <span style={{color:"var(--muted-foreground)"}}>{l.label}</span>
              </div>
            ))}
            <span style={{fontSize:10,color:"var(--muted-foreground)",fontWeight:700,marginLeft:6}}>TYPES:</span>
            {SHIFT_TYPES.map(t=>(
              <div key={t.idx} style={{display:"flex",alignItems:"center",gap:3,fontSize:11}}>
                <div style={{width:7,height:7,borderRadius:"50%",background:t.border}}/>
                <span style={{color:"var(--muted-foreground)"}}>{t.label}</span>
              </div>
            ))}
            <span style={{fontSize:10,color:"var(--warning)",marginLeft:6}}>🏖 = weekend shifts this period</span>
          </div>
        </div>
      )}

      {/* ===== STAFF TAB ===== */}
      {activeTab==="staff"&&(
        <div style={{padding:"14px 18px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <h2 style={{margin:0,fontSize:17,fontWeight:700}}>Staff Directory</h2>
            <button onClick={()=>setShowStaffModal(true)} style={SB}>+ Add Staff Member</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
            {staff.map(member=>{
              const stats=staffStats[member.id]||{hours:0,wkndShifts:0};
              return(
                <div key={member.id} style={{background:"var(--background)",borderRadius:11,padding:16,border:"1px solid var(--border)",borderTop:`4px solid ${member.color}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:10}}>
                    <div style={{width:38,height:38,borderRadius:"50%",background:member.color,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700}}>{member.avatar}</div>
                    <div>
                      <div style={{fontWeight:700,fontSize:13}}>{member.name}</div>
                      <div style={{fontSize:10,color:"var(--muted-foreground)",background:"var(--secondary)",padding:"1px 6px",borderRadius:8,display:"inline-block",marginTop:1}}>{member.role}</div>
                    </div>
                  </div>
                  {member.email&&(
                    <div style={{fontSize:11,color:"var(--muted-foreground)",marginBottom:8,display:"flex",alignItems:"center",gap:4,overflow:"hidden"}}>
                      <span>📧</span><span style={{textOverflow:"ellipsis",overflow:"hidden",whiteSpace:"nowrap"}}>{member.email}</span>
                    </div>
                  )}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:8}}>
                    {[["Contract",`${member.contracted}h`],["This Period",`${stats.hours.toFixed(1)}h`],["🏖 Wknds",member.weekendsWorked]].map(([l,v])=>(
                      <div key={l} style={{background:"var(--secondary)",borderRadius:7,padding:"6px",textAlign:"center"}}>
                        <div style={{fontSize:13,fontWeight:700}}>{v}</div><div style={{fontSize:9,color:"var(--muted-foreground)"}}>{l}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{width:"100%",height:4,background:"var(--secondary)",borderRadius:3}}>
                    <div style={{width:`${Math.min(100,(stats.hours/(member.contracted*numWeeks))*100)}%`,height:"100%",background:member.color,borderRadius:3}}/>
                  </div>
                  <button onClick={()=>removeStaff(member.id)} style={{marginTop:9,width:"100%",border:`1px solid var(--destructive)`,background:"#FFF5F5",color:"var(--destructive)",borderRadius:6,padding:"5px",fontSize:11,fontFamily:"inherit",cursor:"pointer",fontWeight:500}}>Remove</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== WEEKENDS TAB ===== */}
      {activeTab==="weekends"&&(
        <div style={{padding:"14px 18px"}}>
          <h2 style={{margin:"0 0 4px",fontSize:17,fontWeight:700}}>Weekend Fairness Tracker</h2>
          <p style={{margin:"0 0 14px",fontSize:12,color:"var(--muted-foreground)"}}>Staff ranked by fewest weekends worked — assign upcoming weekend shifts to those at the top to keep things fair.</p>

          <div style={{background:"var(--background)",borderRadius:11,overflow:"hidden",border:"1px solid var(--border)",marginBottom:18}}>
            <div style={{display:"grid",gridTemplateColumns:"36px 1fr 90px 90px 110px 1fr",background:"var(--sidebar)",color:"var(--muted-foreground)",fontSize:10,fontWeight:700,padding:"9px 14px",letterSpacing:".05em"}}>
              <div>#</div><div>STAFF</div><div>ALL TIME</div><div>THIS PERIOD</div><div>STATUS</div><div>FAIRNESS</div>
            </div>
            {weekendRanking.map((member,rank)=>{
              const stats=staffStats[member.id]||{wkndShifts:0};
              const maxW=Math.max(...weekendRanking.map(s=>s.totalWknds))||1;
              const pct=(member.totalWknds/maxW)*100;
              const isNext=rank<3;
              return(
                <div key={member.id} style={{display:"grid",gridTemplateColumns:"36px 1fr 90px 90px 110px 1fr",padding:"9px 14px",borderTop:"1px solid var(--border)",background:isNext?"#FFFBEB":rank%2===0?"var(--background)":"var(--secondary)",alignItems:"center"}}>
                  <div style={{fontSize:13,fontWeight:700,color:isNext?"var(--warning)":"var(--muted-foreground)"}}>{rank+1}</div>
                  <div style={{display:"flex",alignItems:"center",gap:7}}>
                    <div style={{width:26,height:26,borderRadius:"50%",background:member.color,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700}}>{member.avatar}</div>
                    <div>
                      <div style={{fontSize:12,fontWeight:600}}>{member.name}</div>
                      <div style={{fontSize:10,color:"var(--muted-foreground)"}}>{member.role}</div>
                    </div>
                  </div>
                  <div style={{fontSize:14,fontWeight:700}}>{member.totalWknds}</div>
                  <div style={{fontSize:13,fontWeight:600,color:"var(--muted-foreground)"}}>{stats.wkndShifts}</div>
                  <div>
                    {isNext
                      ?<span style={{background:"#FEF3C7",color:"#d97706",fontSize:10,padding:"3px 7px",borderRadius:8,fontWeight:700}}>⬆ Assign Next</span>
                      :<span style={{color:"var(--muted-foreground)",fontSize:11}}>—</span>}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:5}}>
                    <div style={{flex:1,height:7,background:"var(--secondary)",borderRadius:4,overflow:"hidden"}}>
                      <div style={{width:`${pct}%`,height:"100%",background:pct>75?"var(--destructive)":pct>40?"var(--warning)":"var(--primary)",borderRadius:4,transition:"width .4s"}}/>
                    </div>
                    <span style={{fontSize:10,color:"var(--muted-foreground)",width:20}}>{member.totalWknds}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <h3 style={{fontSize:14,fontWeight:700,margin:"0 0 10px"}}>Weekend Coverage — {periodLabel}</h3>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:10}}>
            {weekStarts.map((ws,wi)=>{
              const satStaff=staff.filter(s=>shifts[`${s.id}-w${wi}-d5`]);
              const sunStaff=staff.filter(s=>shifts[`${s.id}-w${wi}-d6`]);
              return(
                <div key={wi} style={{background:"var(--background)",borderRadius:10,padding:13,border:"1px solid var(--border)"}}>
                  <div style={{fontWeight:700,fontSize:12,marginBottom:8}}>Week {wi+1} · {fmtDate(ws,{day:"numeric",month:"short"})}</div>
                  {[["Saturday 🌤",satStaff],["Sunday ☀️",sunStaff]].map(([lbl,arr])=>(
                    <div key={lbl} style={{marginBottom:7}}>
                      <div style={{fontSize:10,color:"var(--muted-foreground)",fontWeight:600,marginBottom:3}}>{lbl} — {arr.length} staff</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                        {arr.length===0
                          ?<span style={{fontSize:10,color:"var(--destructive)",background:"#FFF5F5",padding:"2px 6px",borderRadius:6,fontWeight:500}}>⚠ None scheduled</span>
                          :arr.map(s=><span key={s.id} style={{background:s.color,color:"#fff",fontSize:10,padding:"2px 6px",borderRadius:6,fontWeight:700}}>{s.avatar}</span>)
                        }
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== REPORTS TAB ===== */}
      {activeTab==="reports"&&(
        <div style={{padding:"14px 18px"}}>
          <h2 style={{margin:"0 0 12px",fontSize:17,fontWeight:700}}>Reports · {periodLabel}</h2>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div style={{background:"var(--background)",borderRadius:11,padding:16,border:"1px solid var(--border)"}}>
              <h3 style={{margin:"0 0 12px",fontSize:13,fontWeight:700}}>Hours by Staff</h3>
              {staff.map(member=>{
                const stats=staffStats[member.id]||{hours:0};
                const target=member.contracted*numWeeks;
                const pct=target>0?Math.min(100,(stats.hours/target)*100):0;
                return(
                  <div key={member.id} style={{marginBottom:8}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                      <span style={{fontSize:11,fontWeight:500}}>{member.name}</span>
                      <span style={{fontSize:10,fontWeight:600,color:stats.hours>target?"var(--destructive)":"var(--muted-foreground)"}}>{stats.hours.toFixed(1)}/{target}h</span>
                    </div>
                    <div style={{width:"100%",height:6,background:"var(--secondary)",borderRadius:3}}>
                      <div style={{width:`${pct}%`,height:"100%",background:stats.hours>target?"var(--destructive)":member.color,borderRadius:3}}/>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{background:"var(--background)",borderRadius:11,padding:16,border:"1px solid var(--border)"}}>
              <h3 style={{margin:"0 0 12px",fontSize:13,fontWeight:700}}>Shifts by Location</h3>
              {LOCATIONS.map(l=>{
                const count=Object.values(shifts).filter(s=>s.locationId===l.id).length;
                const total=Object.keys(shifts).length||1;
                return(
                  <div key={l.id} style={{display:"flex",alignItems:"center",gap:8,marginBottom:9}}>
                    <div style={{width:9,height:9,borderRadius:2,background:l.bg,border:`2px solid ${l.border}`,flexShrink:0}}/>
                    <span style={{fontSize:12,flex:1}}>{l.label}</span>
                    <div style={{width:90,height:7,background:"var(--secondary)",borderRadius:4}}>
                      <div style={{width:`${(count/total)*100}%`,height:"100%",background:l.border,borderRadius:4}}/>
                    </div>
                    <span style={{fontSize:11,fontWeight:600,color:"var(--muted-foreground)",width:18}}>{count}</span>
                  </div>
                );
              })}
            </div>
            <div style={{background:"var(--background)",borderRadius:11,padding:16,border:"1px solid var(--border)"}}>
              <h3 style={{margin:"0 0 12px",fontSize:13,fontWeight:700}}>Cost Summary</h3>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
                {[["Contracted Hrs",`${staff.reduce((a,s)=>a+s.contracted*numWeeks,0)}h`],["Scheduled Hrs",`${Object.values(staffStats).reduce((a,s)=>a+s.hours,0).toFixed(1)}h`],["Est. Wages",`£${totalWageCost.toFixed(0)}`],["Avg / Person",`${(Object.values(staffStats).reduce((a,s)=>a+s.hours,0)/staff.length).toFixed(1)}h`]].map(([l,v])=>(
                  <div key={l} style={{background:"var(--secondary)",borderRadius:7,padding:11}}>
                    <div style={{fontSize:16,fontWeight:700}}>{v}</div>
                    <div style={{fontSize:10,color:"var(--muted-foreground)",marginTop:1}}>{l}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{background:"var(--background)",borderRadius:11,padding:16,border:"1px solid var(--border)"}}>
              <h3 style={{margin:"0 0 12px",fontSize:13,fontWeight:700}}>Weekend Distribution (All Time)</h3>
              {[...staff].sort((a,b)=>b.weekendsWorked-a.weekendsWorked).map(member=>{
                const maxW=Math.max(...staff.map(s=>s.weekendsWorked))||1;
                return(
                  <div key={member.id} style={{display:"flex",alignItems:"center",gap:7,marginBottom:7}}>
                    <div style={{width:22,height:22,borderRadius:"50%",background:member.color,color:"#fff",fontSize:8,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{member.avatar}</div>
                    <span style={{fontSize:11,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{member.name}</span>
                    <div style={{width:70,height:6,background:"var(--secondary)",borderRadius:3}}>
                      <div style={{width:`${(member.weekendsWorked/maxW)*100}%`,height:"100%",background:member.color,borderRadius:3}}/>
                    </div>
                    <span style={{fontSize:11,fontWeight:700,color:"var(--muted-foreground)",width:14}}>{member.weekendsWorked}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ===== SHIFT MODAL ===== */}
      {showShiftModal&&selectedCell&&(()=>{
        const member=staff.find(s=>s.id===selectedCell.staffId);
        const dayDate=allDays.find(d=>d.weekIdx===selectedCell.weekIdx&&d.dayIdx===selectedCell.dayIdx)?.date;
        return(
          <Backdrop onClose={()=>setShowShiftModal(false)}>
            <ModalHead title={member?.name} sub={`${FULL_DAYS[selectedCell.dayIdx]}${dayDate?`, ${fmtDate(dayDate,{day:"numeric",month:"short"})}`:""}`} onClose={()=>setShowShiftModal(false)}/>
            <div style={{padding:16}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:11}}>
                {[["Start","start"],["End","end"]].map(([lbl,f])=>(
                  <div key={f}>
                    <label style={FL}>{lbl} Time</label>
                    <select value={shiftEdit[f]} onChange={e=>setShiftEdit(p=>({...p,[f]:e.target.value}))} style={IS}>
                      {HALF_HOURS.map(h=><option key={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div style={{marginBottom:11}}>
                <label style={FL}>Break</label>
                <select value={shiftEdit.brk} onChange={e=>setShiftEdit(p=>({...p,brk:Number(e.target.value)}))} style={IS}>
                  {[0,15,20,30,45,60].map(b=><option key={b} value={b}>{b===0?"No break":`${b} mins`}</option>)}
                </select>
              </div>
              <div style={{marginBottom:11}}>
                <label style={FL}>Location</label>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
                  {LOCATIONS.map(l=>(
                    <button key={l.id} onClick={()=>setShiftEdit(p=>({...p,locationId:l.id}))}
                      style={{background:shiftEdit.locationId===l.id?l.bg:"var(--secondary)",border:`2px solid ${shiftEdit.locationId===l.id?l.border:"var(--border)"}`,borderRadius:7,padding:"6px 8px",fontSize:11,fontFamily:"inherit",color:shiftEdit.locationId===l.id?l.text:"var(--muted-foreground)",cursor:"pointer",fontWeight:600,textAlign:"left",display:"flex",alignItems:"center",gap:5}}>
                      <div style={{width:7,height:7,borderRadius:"50%",background:shiftEdit.locationId===l.id?l.dot:"#CBD5E0",flexShrink:0}}/>
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{marginBottom:11}}>
                <label style={FL}>Shift Type</label>
                <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                  {SHIFT_TYPES.map(t=>(
                    <button key={t.idx} onClick={()=>setShiftEdit(p=>({...p,typeIdx:t.idx}))}
                      style={{background:t.bg,border:`2px solid ${shiftEdit.typeIdx===t.idx?t.border:"transparent"}`,borderRadius:6,padding:"4px 8px",fontSize:10,fontFamily:"inherit",color:t.text,cursor:"pointer",fontWeight:700}}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{background:"var(--secondary)",borderRadius:7,padding:"8px 11px",marginBottom:11,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:11,color:"var(--muted-foreground)"}}>Net duration</span>
                <span style={{fontSize:13,fontWeight:700,fontFamily:"DM Mono,monospace"}}>{calcHours(shiftEdit.start,shiftEdit.end,shiftEdit.brk).toFixed(2)} hrs</span>
              </div>
              {isWeekend(selectedCell.dayIdx)&&(
                <div style={{background:"#FFFBEB",border:`1px solid var(--warning)`,borderRadius:7,padding:"6px 10px",marginBottom:10,fontSize:11,color:"#92400e"}}>
                  🏖 Weekend shift — will update fairness tracker
                </div>
              )}
              <div style={{display:"flex",gap:7}}>
                {shifts[selectedCell.key]&&(
                  <button onClick={deleteShift} style={{flex:1,border:`1.5px solid var(--destructive)`,background:"#FFF5F5",color:"var(--destructive)",borderRadius:7,padding:"8px",fontSize:12,fontFamily:"inherit",cursor:"pointer",fontWeight:600}}>Remove</button>
                )}
                <button onClick={saveShift} style={{flex:2,background:"var(--primary)",color:"var(--primary-foreground)",border:"none",borderRadius:7,padding:"8px",fontSize:12,fontFamily:"inherit",cursor:"pointer",fontWeight:700}}>
                  {shifts[selectedCell.key]?"Update Shift":"Add Shift"}
                </button>
              </div>
            </div>
          </Backdrop>
        );
      })()}

      {/* ===== ADD STAFF MODAL ===== */}
      {showStaffModal&&(
        <Backdrop onClose={()=>setShowStaffModal(false)}>
          <ModalHead title="Add Staff Member" onClose={()=>setShowStaffModal(false)}/>
          <div style={{padding:16}}>
            {[["Full Name","name","text","e.g. Jamie Oliver"],["Email Address","email","email","e.g. jamie@nma.org.uk"],["Contracted Hrs/Week","contracted","number","e.g. 37.5"]].map(([lbl,field,type,ph])=>(
              <div key={field} style={{marginBottom:11}}>
                <label style={FL}>{lbl}</label>
                <input type={type} placeholder={ph} value={newStaff[field]} onChange={e=>setNewStaff(p=>({...p,[field]:e.target.value}))} style={{...IS,width:"100%",boxSizing:"border-box"}}/>
              </div>
            ))}
            <div style={{marginBottom:14}}>
              <label style={FL}>Role</label>
              <select value={newStaff.role} onChange={e=>setNewStaff(p=>({...p,role:e.target.value}))} style={IS}>
                {ROLES.map(r=><option key={r}>{r}</option>)}
              </select>
            </div>
            <button onClick={addStaff} style={{width:"100%",background:"var(--primary)",color:"var(--primary-foreground)",border:"none",borderRadius:7,padding:"10px",fontSize:13,fontFamily:"inherit",cursor:"pointer",fontWeight:700}}>Add Staff Member</button>
          </div>
        </Backdrop>
      )}

      {/* ===== SEND EMAIL MODAL ===== */}
      {showSendModal&&(
        <Backdrop onClose={()=>setShowSendModal(false)}>
          <ModalHead title="📧 Send Rota by Email" onClose={()=>setShowSendModal(false)}/>
          <div style={{padding:16}}>
            <p style={{margin:"0 0 12px",fontSize:12,color:"var(--muted-foreground)"}}>
              The rota for <strong>{periodLabel}</strong> will be emailed to:
            </p>
            <div style={{maxHeight:230,overflowY:"auto",marginBottom:12}}>
              {staff.map(s=>(
                <div key={s.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:"1px solid var(--border)"}}>
                  <div style={{width:26,height:26,borderRadius:"50%",background:s.color,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700}}>{s.avatar}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600}}>{s.name}</div>
                    {s.email
                      ?<div style={{fontSize:10,color:"var(--muted-foreground)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.email}</div>
                      :<div style={{fontSize:10,color:"var(--destructive)"}}>⚠ No email on file</div>}
                  </div>
                  {s.email
                    ?<span style={{fontSize:10,color:"var(--primary)",fontWeight:600}}>✓</span>
                    :<span style={{fontSize:10,color:"var(--muted-foreground)"}}>Skip</span>}
                </div>
              ))}
            </div>
            <div style={{background:"#F0FDF4",border:"1px solid #86efac",borderRadius:7,padding:"7px 10px",fontSize:11,color:"#166534",marginBottom:12}}>
              ✓ {staff.filter(s=>s.email).length} of {staff.length} staff will receive the rota
            </div>
            <div style={{display:"flex",gap:7}}>
              <button onClick={()=>setShowSendModal(false)} style={{flex:1,border:"1.5px solid var(--border)",background:"var(--background)",color:"var(--muted-foreground)",borderRadius:7,padding:"8px",fontSize:12,fontFamily:"inherit",cursor:"pointer",fontWeight:600}}>Cancel</button>
              <button onClick={simulateSend} style={{flex:2,background:"var(--primary)",color:"var(--primary-foreground)",border:"none",borderRadius:7,padding:"8px",fontSize:12,fontFamily:"inherit",cursor:"pointer",fontWeight:700}}>📧 Send Rota</button>
            </div>
          </div>
        </Backdrop>
      )}
    </div>
  );
}

function Backdrop({children,onClose}){
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,animation:"fUp .15s ease"}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:"var(--background)",borderRadius:13,width:410,maxWidth:"95vw",maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.25)"}}>
        {children}
      </div>
    </div>
  );
}

function ModalHead({title,sub,onClose}){
  return(
    <div style={{background:"var(--sidebar)",color:"var(--sidebar-foreground)",padding:"13px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",borderRadius:"13px 13px 0 0"}}>
      <div>
        <div style={{fontWeight:700,fontSize:14}}>{title}</div>
        {sub&&<div style={{fontSize:10,color:"#94a3b8",marginTop:1}}>{sub}</div>}
      </div>
      <button onClick={onClose} style={{background:"none",border:"none",color:"#94a3b8",fontSize:20,cursor:"pointer",lineHeight:1,padding:0}}>×</button>
    </div>
  );
}

const NB={width:26,height:26,border:"1px solid var(--border)",borderRadius:6,background:"var(--background)",cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit"};
const SEL={border:"1px solid var(--border)",borderRadius:6,padding:"5px 8px",fontSize:11,fontFamily:"inherit",background:"var(--background)",cursor:"pointer"};
const OB={border:"1px solid var(--border)",borderRadius:6,background:"var(--background)",padding:"5px 10px",fontSize:11,fontFamily:"inherit",cursor:"pointer",fontWeight:500,color:"var(--muted-foreground)"};
const SB={background:"var(--primary)",color:"var(--primary-foreground)",border:"none",borderRadius:6,padding:"6px 13px",fontSize:11,fontFamily:"inherit",cursor:"pointer",fontWeight:600};
const FL={fontSize:10,fontWeight:600,color:"var(--muted-foreground)",display:"block",marginBottom:3};
const IS={width:"100%",border:"1.5px solid var(--border)",borderRadius:7,padding:"7px 9px",fontSize:12,fontFamily:"inherit",background:"var(--background)",boxSizing:"border-box"};
