import { useState, useMemo, useEffect, useRef } from "react";
import {
  DAYS, FULL_DAYS, HALF_HOURS,
  LOCATIONS, SHIFT_TYPES, ROLES, VIEW_MODES, STAFF_COLORS, WAGE_RATE,
  INITIAL_STAFF, INITIAL_SHIFTS,
  loadLocations, loadShiftTypes,
} from "../constants";
import { calcHours, getMondayOf, addDays, fmtDate, isWeekend } from "../utils";

const ABSENCE_CODES = [
  { key:"H", label:"Holiday",             color:"#10b981" },
  { key:"A", label:"Medical",             color:"#f59e0b" },
  { key:"U", label:"Unpaid Leave",        color:"#94a3b8" },
  { key:"S", label:"Sickness",            color:"#ef4444" },
  { key:"M", label:"Maternity/Paternity", color:"#8b5cf6" },
  { key:"C", label:"Compassionate",       color:"#3b82f6" },
  { key:"L", label:"Time off in Lieu",    color:"#0ea5e9" },
  { key:"W", label:"Work from Home",      color:"#14b8a6" },
  { key:"R", label:"Rest Day",            color:"#f97316" },
];
const ABSENCE_CODE_MAP = Object.fromEntries(ABSENCE_CODES.map(c=>[c.key,c]));

const DEFAULT_DEPARTMENTS = [
  { id:"foh",     label:"Front of House" },
  { id:"kitchen", label:"Kitchen"        },
];

const DEFAULT_DAILY_INFO_ROWS = [
  { id:"vouchers",  label:"Vouchers"         },
  { id:"tmts",      label:"TMT's"            },
  { id:"founders",  label:"Founders"         },
  { id:"aspects",   label:"Aspects"          },
  { id:"remaining", label:"Remaining Shifts" },
  { id:"notes",     label:"Notes"            },
];

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const CASUAL_BUDGET_KEYS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
const DEFAULT_CASUAL_BUDGET = Object.fromEntries(CASUAL_BUDGET_KEYS.map(k=>[k,0]));

const JOB_TITLES_KEY = "rotaflow_job_titles";
const DEFAULT_JOB_TITLES = [
  { id:"jt_supervisor",     label:"Supervisor"     },
  { id:"jt_waiter",         label:"Waiter"         },
  { id:"jt_bar_staff",      label:"Bar Staff"      },
  { id:"jt_head_chef",      label:"Head Chef"      },
  { id:"jt_sous_chef",      label:"Sous Chef"      },
  { id:"jt_kitchen_porter", label:"Kitchen Porter" },
];

const PLANNER_KEY = "rotaflow_planner";

function fmtDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function daysInMonth(y,m)      { return new Date(y,m+1,0).getDate(); }
function firstWeekdayMon(y,m)  { const d=new Date(y,m,1).getDay(); return d===0?6:d-1; }
function isWeekendDate(y,m,d)  { const w=new Date(y,m,d).getDay(); return w===0||w===6; }
function weekdaysInMonth(y,m) {
  let n=0; const tot=daysInMonth(y,m);
  for(let d=1;d<=tot;d++){ const w=new Date(y,m,d).getDay(); if(w!==0&&w!==6) n++; }
  return n;
}

function migrateStaff(arr) {
  return arr.map(s=>({
    annualHolidayDays: 28,
    annualisedHours:   (s.contracted||40)*52,
    absences:          {},
    department:        "foh",
    contractType:      "full_time",
    allowedLocations:  [],
    ...s,
  }));
}

export default function RotaSystem() {
  // ── existing state ───────────────────────────────────────────────────────
  const [activeTab,      setActiveTab]      = useState("rota");
  const [shifts,         setShifts]         = useState(()=>{
    try { const s=localStorage.getItem("rotaflow-shifts"); return s?JSON.parse(s):INITIAL_SHIFTS; }
    catch { return INITIAL_SHIFTS; }
  });
  const [staff,          setStaff]          = useState(()=>{
    try {
      const s=localStorage.getItem("rotaflow-staff");
      return s?migrateStaff(JSON.parse(s)):migrateStaff(INITIAL_STAFF);
    }
    catch { return migrateStaff(INITIAL_STAFF); }
  });
  const [weekOffset,     setWeekOffset]     = useState(0);
  const [viewWeeks,      setViewWeeks]      = useState("1");
  const [selectedCell,   setSelectedCell]   = useState(null);
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [showSendModal,  setShowSendModal]  = useState(false);
  const [shiftEdit,      setShiftEdit]      = useState({ start:"09:00", end:"17:00", typeIdx:0, locationId:"restaurant", brk:30 });
  const [newStaff,       setNewStaff]       = useState(()=>{
    try{ const s=localStorage.getItem(JOB_TITLES_KEY); if(s){ const ts=JSON.parse(s); if(ts.length) return {name:"",role:ts[0].label,contracted:37.5,email:"",department:"foh"}; } }catch{}
    return {name:"",role:DEFAULT_JOB_TITLES[0].label,contracted:37.5,email:"",department:"foh"};
  });
  const [filterRole,     setFilterRole]     = useState("All");
  const [publishedWeeks, setPublishedWeeks] = useState(()=>{
    try { const s=localStorage.getItem("rotaflow-publishedWeeks"); return s?new Set(JSON.parse(s)):new Set(); }
    catch { return new Set(); }
  });
  const [notification,   setNotification]   = useState(null);
  const [sendingEmail,   setSendingEmail]   = useState(false);
  const [locations,      setLocations]      = useState(loadLocations);
  const [shiftTypes,     setShiftTypes]     = useState(loadShiftTypes);
  const [locDraft,       setLocDraft]       = useState(loadLocations);
  const [stDraft,        setStDraft]        = useState(loadShiftTypes);
  const [casualBudget,      setCasualBudget]      = useState(()=>{
    try{ const s=localStorage.getItem("rotaflow_casual_budget"); if(s) return {...DEFAULT_CASUAL_BUDGET,...JSON.parse(s)}; }catch{}
    return {...DEFAULT_CASUAL_BUDGET};
  });
  const [casualBudgetDraft, setCasualBudgetDraft] = useState(()=>{
    try{ const s=localStorage.getItem("rotaflow_casual_budget"); if(s) return {...DEFAULT_CASUAL_BUDGET,...JSON.parse(s)}; }catch{}
    return {...DEFAULT_CASUAL_BUDGET};
  });
  const [jobTitles,      setJobTitles]      = useState(()=>{
    try{ const s=localStorage.getItem(JOB_TITLES_KEY); if(s) return JSON.parse(s); }catch{}
    return DEFAULT_JOB_TITLES.map(t=>({...t}));
  });
  const [jobTitlesDraft, setJobTitlesDraft] = useState(()=>{
    try{ const s=localStorage.getItem(JOB_TITLES_KEY); if(s) return JSON.parse(s); }catch{}
    return DEFAULT_JOB_TITLES.map(t=>({...t}));
  });
  const [planner, setPlanner] = useState(()=>{
    try{ const s=localStorage.getItem(PLANNER_KEY); if(s) return {weekdayTemplate:[],weekendTemplate:[],overrides:{},...JSON.parse(s)}; }catch{}
    return {weekdayTemplate:[],weekendTemplate:[],overrides:{}};
  });

  // ── new state ────────────────────────────────────────────────────────────
  const [activeDept,        setActiveDept]        = useState(()=>{
    try{ const s=localStorage.getItem("rotaflow_departments"); if(s){ const d=JSON.parse(s); return d[0]?.id||"foh"; } }catch{}
    return "foh";
  });
  const [selectedStaffId,   setSelectedStaffId]   = useState(null);
  const [profileTab,        setProfileTab]        = useState("overview");
  const [editingRowId,      setEditingRowId]      = useState(null);
  const [absencePickerDate, setAbsencePickerDate] = useState(null);
  const [absenceModal,      setAbsenceModal]      = useState(null); // { staffId, dateKey, code }
  const [shiftModalTab,     setShiftModalTab]     = useState("shift"); // "shift"|"absence"
  const [absencePickerCode, setAbsencePickerCode] = useState("H");
  const [staffDividers,     setStaffDividers]     = useState(()=>{
    try{ const s=localStorage.getItem("rotaflow_dividers"); if(s) return JSON.parse(s); }catch{}
    return {};
  });
  const [editingDividerId,  setEditingDividerId]  = useState(null);
  const [overHoursWarning,  setOverHoursWarning]  = useState(null); // { overBy: number }
  const [casualBudgetWarning, setCasualBudgetWarning] = useState(null); // { overBy: number }
  const [departments,       setDepartments]       = useState(()=>{
    try{ const s=localStorage.getItem("rotaflow_departments"); if(s) return JSON.parse(s); }catch{}
    return DEFAULT_DEPARTMENTS;
  });
  const [deptDeleteError,   setDeptDeleteError]   = useState(null); // dept id that can't be deleted
  const [expandedDepts,     setExpandedDepts]     = useState({});
  const [absenceViewYear,   setAbsenceViewYear]   = useState(()=>new Date().getFullYear());
  const [absenceViewMonth,  setAbsenceViewMonth]  = useState(()=>new Date().getMonth());
  const [plannerTemplateTab, setPlannerTemplateTab] = useState("weekday");
  const [plannerYear,        setPlannerYear]        = useState(()=>new Date().getFullYear());
  const [plannerMonth,       setPlannerMonth]       = useState(()=>new Date().getMonth());
  const [plannerSelectedDay, setPlannerSelectedDay] = useState(null);
  const [proposedRota,     setProposedRota]     = useState(null); // generated rota object or null
  const [reviewWeekIdx,    setReviewWeekIdx]    = useState(0);
  const [warningApprovals, setWarningApprovals] = useState({}); // weekIndex -> { warningKey: true }
  const [assigningUid,     setAssigningUid]     = useState(null); // uid of unfilled slot being assigned
  const profileViewYear = new Date().getFullYear();

  const [dailyInfoRows,   setDailyInfoRows]   = useState(()=>{
    try {
      const s=localStorage.getItem("rotaflow_daily_info");
      if(s){ const d=JSON.parse(s); return d.rows||DEFAULT_DAILY_INFO_ROWS; }
    } catch {}
    return DEFAULT_DAILY_INFO_ROWS;
  });
  const [dailyInfoValues, setDailyInfoValues] = useState(()=>{
    try {
      const s=localStorage.getItem("rotaflow_daily_info");
      if(s){ const d=JSON.parse(s); return d.values||{}; }
    } catch {}
    return {};
  });

  // ── persistence ──────────────────────────────────────────────────────────
  useEffect(()=>{ localStorage.setItem("rotaflow-shifts",         JSON.stringify(shifts));              },[shifts]);
  useEffect(()=>{ localStorage.setItem("rotaflow-staff",          JSON.stringify(staff));               },[staff]);
  useEffect(()=>{ localStorage.setItem("rotaflow-publishedWeeks", JSON.stringify([...publishedWeeks])); },[publishedWeeks]);
  useEffect(()=>{ localStorage.setItem("rf_locations",  JSON.stringify(locations));  },[locations]);
  useEffect(()=>{ localStorage.setItem("rf_shiftTypes", JSON.stringify(shiftTypes)); },[shiftTypes]);
  useEffect(()=>{
    localStorage.setItem("rotaflow_daily_info", JSON.stringify({ rows:dailyInfoRows, values:dailyInfoValues }));
  },[dailyInfoRows,dailyInfoValues]);
  useEffect(()=>{ localStorage.setItem("rotaflow_dividers",       JSON.stringify(staffDividers)); },[staffDividers]);
  useEffect(()=>{ localStorage.setItem("rotaflow_departments",    JSON.stringify(departments));  },[departments]);
  useEffect(()=>{ localStorage.setItem("rotaflow_casual_budget",  JSON.stringify(casualBudget)); },[casualBudget]);
  useEffect(()=>{ localStorage.setItem(JOB_TITLES_KEY, JSON.stringify(jobTitles)); },[jobTitles]);
  useEffect(()=>{ localStorage.setItem(PLANNER_KEY,   JSON.stringify(planner));   },[planner]);

  // ── derived values ───────────────────────────────────────────────────────
  const numWeeks = parseInt(viewWeeks);

  const weekStarts = useMemo(()=>{
    const base=new Date(); base.setDate(base.getDate()+weekOffset*7);
    const mon=getMondayOf(base);
    return Array.from({length:numWeeks},(_,i)=>addDays(mon,i*7));
  },[weekOffset,numWeeks]);

  const allDays = useMemo(()=>
    weekStarts.flatMap((ws,wi)=>
      Array.from({length:7},(_,di)=>({ date:addDays(ws,di), weekIdx:weekOffset+wi, dayIdx:di, key:`w${weekOffset+wi}d${di}` }))
    ),[weekStarts,weekOffset]);

  const periodLabel = useMemo(()=>{
    const f=weekStarts[0], l=addDays(weekStarts[weekStarts.length-1],6);
    return `${fmtDate(f,{day:"numeric",month:"short"})} – ${fmtDate(l,{day:"numeric",month:"short",year:"numeric"})}`;
  },[weekStarts]);

  const weekKey = fmtDateKey(weekStarts[0]);

  const visibleMonths = useMemo(()=>new Set(
    allDays.map(({date})=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`)
  ),[allDays]);

  const filteredStaff = staff
    .filter(s=>s.department===activeDept)
    .filter(s=>filterRole==="All"||s.role===filterRole);

  const staffStats = useMemo(()=>{
    const map={};
    staff.forEach(s=>{
      let hours=0, wageHours=0, wkndShifts=0;
      const dailyHrs=(s.contracted||0)/5;
      allDays.forEach(({date,weekIdx,dayIdx})=>{
        const dk=fmtDateKey(date);
        const absCode=(s.absences||{})[dk];
        if(absCode){
          // U (Unpaid) and R (Rest Day) count as 0 for both hours and cost
          if(absCode!=="U"&&absCode!=="R"){ hours+=dailyHrs; wageHours+=dailyHrs; }
        } else {
          const k=`${s.id}-w${weekIdx}-d${dayIdx}`;
          if(shifts[k]){
            const h=calcHours(shifts[k].start,shifts[k].end,shifts[k].brk);
            hours+=h; wageHours+=h;
            if(isWeekend(dayIdx)) wkndShifts++;
          }
        }
      });
      map[s.id]={hours,wageHours,wkndShifts};
    });
    return map;
  },[shifts,staff,allDays]);

  const weekendRanking = useMemo(()=>
    [...staff].map(s=>({...s,totalWknds:s.weekendsWorked+(staffStats[s.id]?.wkndShifts||0)}))
              .sort((a,b)=>a.totalWknds-b.totalWknds)
  ,[staff,staffStats]);

  const totalWageCost = useMemo(()=>
    Object.values(staffStats).reduce((a,s)=>a+s.wageHours,0)*WAGE_RATE
  ,[staffStats]);

  const baseMonday = useMemo(()=>getMondayOf(new Date()),[]);

  const casualMonthlyHours = useMemo(()=>{
    const thisYear=new Date().getFullYear();
    const zeroIds=new Set(staff.filter(s=>(s.contractType||"full_time")==="zero_hours").map(s=>String(s.id)));
    const totals=Array(12).fill(0);
    Object.entries(shifts).forEach(([key,shift])=>{
      const m=key.match(/^(.+)-w(-?\d+)-d(\d+)$/);
      if(!m||!zeroIds.has(m[1])) return;
      const date=addDays(baseMonday,parseInt(m[2])*7+parseInt(m[3]));
      if(date.getFullYear()!==thisYear) return;
      totals[date.getMonth()]+=calcHours(shift.start,shift.end,shift.brk);
    });
    return totals;
  },[shifts,staff,baseMonday]);

  // ── existing helpers ─────────────────────────────────────────────────────
  const getLoc   = id  => locations.find(l=>l.id===id)||locations[0];
  const getStype = idx => shiftTypes[idx]||shiftTypes[0];
  const isPublished = weekStarts.every((_,wi)=>publishedWeeks.has(`${weekOffset}-${wi}`));
  const hasSlots = (planner?.weekdayTemplate?.length ?? 0) > 0 || (planner?.weekendTemplate?.length ?? 0) > 0;

  function openShiftModal(staffId,weekIdx,dayIdx){
    const key=`${staffId}-w${weekIdx}-d${dayIdx}`;
    setSelectedCell({staffId,weekIdx,dayIdx,key});
    setShiftEdit(shifts[key]||{start:"09:00",end:"17:00",typeIdx:0,locationId:"restaurant",brk:30});
    setShiftModalTab("shift");
    setAbsencePickerCode("H");
    setOverHoursWarning(null);
    setCasualBudgetWarning(null);
    setShowShiftModal(true);
  }

  function saveShift(){
    const member=staff.find(s=>s.id===selectedCell.staffId);
    const isZeroHours=(member?.contractType||"full_time")==="zero_hours";
    const newHrs=calcHours(shiftEdit.start,shiftEdit.end,shiftEdit.brk);
    const oldHrs=shifts[selectedCell.key]
      ?calcHours(shifts[selectedCell.key].start,shifts[selectedCell.key].end,shifts[selectedCell.key].brk):0;

    if(isZeroHours){
      if(!casualBudgetWarning){
        const shiftDate=addDays(baseMonday,selectedCell.weekIdx*7+selectedCell.dayIdx);
        const shiftMonth=shiftDate.getMonth();
        const shiftYear=shiftDate.getFullYear();
        const budgetKey=CASUAL_BUDGET_KEYS[shiftMonth];
        const monthBudget=casualBudget[budgetKey]||0;
        const zeroIds=new Set(staff.filter(s=>(s.contractType||"full_time")==="zero_hours").map(s=>String(s.id)));
        let monthTotal=0;
        Object.entries(shifts).forEach(([key,shift])=>{
          if(key===selectedCell.key) return;
          const m=key.match(/^(.+)-w(-?\d+)-d(\d+)$/);
          if(!m||!zeroIds.has(m[1])) return;
          const date=addDays(baseMonday,parseInt(m[2])*7+parseInt(m[3]));
          if(date.getFullYear()===shiftYear&&date.getMonth()===shiftMonth)
            monthTotal+=calcHours(shift.start,shift.end,shift.brk);
        });
        monthTotal+=newHrs;
        if(monthTotal>monthBudget){
          setCasualBudgetWarning({overBy:monthTotal-monthBudget});
          return;
        }
      }
      setCasualBudgetWarning(null);
    } else {
      if(!overHoursWarning){
        const currentHrs=(staffStats[selectedCell.staffId]||{hours:0}).hours;
        const newTotal=currentHrs-oldHrs+newHrs;
        const target=(member?.contracted||0)*numWeeks;
        if(newTotal>target){
          setOverHoursWarning({overBy:newTotal-target,name:member?.name});
          return;
        }
      }
      setOverHoursWarning(null);
    }

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
    if(!newStaff.name.trim()) return;
    const id=Date.now(), initials=newStaff.name.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
    const contracted=Number(newStaff.contracted);
    setStaff(p=>[...p,{
      id, name:newStaff.name, role:newStaff.role, email:newStaff.email, avatar:initials,
      contracted, color:STAFF_COLORS[p.length%STAFF_COLORS.length], weekendsWorked:0,
      annualHolidayDays:28, annualisedHours:contracted*52, absences:{}, department:newStaff.department||departments[0]?.id||"foh",
    }]);
    setNewStaff({name:"",role:jobTitles[0]?.label||"",contracted:37.5,email:"",department:departments[0]?.id||"foh"});
    setShowStaffModal(false); showNotif("Staff member added ✓");
  }

  function removeStaff(id){
    setStaff(p=>p.filter(s=>s.id!==id));
    setShifts(p=>{const n={...p};Object.keys(n).forEach(k=>{if(k.startsWith(`${id}-`))delete n[k];});return n;});
    if(selectedStaffId===id){ setSelectedStaffId(null); setAbsencePickerDate(null); }
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

  function deriveLocColors(hex,label){
    const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
    const toH=n=>Math.max(0,Math.min(255,Math.round(n))).toString(16).padStart(2,"0");
    const bg=`#${toH(r*.1+255*.9)}${toH(g*.1+255*.9)}${toH(b*.1+255*.9)}`;
    const text=`#${toH(r*.55)}${toH(g*.55)}${toH(b*.55)}`;
    const short=label.split(/[\s/]+/).filter(w=>/[a-zA-Z]/.test(w[0]||"")).map(w=>w[0].toUpperCase()).join("").slice(0,4)||"?";
    return {border:hex,dot:hex,bg,text,short};
  }

  function deriveSTColors(hex){
    const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
    const toH=n=>Math.max(0,Math.min(255,Math.round(n))).toString(16).padStart(2,"0");
    return {border:hex,bg:`#${toH(r*.1+255*.9)}${toH(g*.1+255*.9)}${toH(b*.1+255*.9)}`,text:`#${toH(r*.55)}${toH(g*.55)}${toH(b*.55)}`};
  }

  function addDept(){
    const id="dept_"+Date.now();
    setDepartments(p=>[...p,{id,label:"New Department"}]);
  }

  function renameDept(id,label){
    setDepartments(p=>p.map(d=>d.id===id?{...d,label}:d));
  }

  function deleteDept(id){
    if(staff.some(s=>s.department===id)){ setDeptDeleteError(id); return; }
    setDeptDeleteError(null);
    setDepartments(p=>{
      const next=p.filter(d=>d.id!==id);
      if(activeDept===id) setActiveDept(next[0]?.id||"");
      return next;
    });
    setStaffDividers(p=>{ const n={...p}; delete n[id]; return n; });
  }

  function moveDept(idx,dir){
    setDepartments(p=>{
      const next=[...p], target=idx+dir;
      if(target<0||target>=next.length) return p;
      [next[idx],next[target]]=[next[target],next[idx]];
      return next;
    });
  }

  function saveSettings(){ setLocations([...locDraft]); setShiftTypes([...stDraft]); setCasualBudget({...casualBudgetDraft}); setJobTitles([...jobTitlesDraft]); showNotif("Settings saved ✓"); }

  function addLocation(){
    const id="loc_"+Date.now();
    const d=deriveLocColors("#6b7280","New Location");
    setLocDraft(p=>[...p,{id,label:"New Location",...d}]);
  }

  function addShiftType(){
    const idx=stDraft.reduce((m,t)=>Math.max(m,t.idx),0)+1;
    const d=deriveSTColors("#6b7280");
    setStDraft(p=>[...p,{idx,label:"New Shift Type",...d}]);
  }

  function addJobTitle(){
    const id="jt_"+Date.now();
    setJobTitlesDraft(p=>[...p,{id,label:""}]);
  }

  function addPlannerSlot(key){
    const id="slot_"+Date.now();
    const loc=locations[0]?.id||"restaurant";
    const newSlot={id,locationId:loc,staffCount:1,startTime:"09:00",endTime:"17:00",allowedJobTitles:[]};
    setPlanner(p=>{
      if(key==="weekday") return {...p,weekdayTemplate:[...p.weekdayTemplate,newSlot]};
      if(key==="weekend") return {...p,weekendTemplate:[...p.weekendTemplate,newSlot]};
      return {...p,overrides:{...p.overrides,[key]:[...(p.overrides[key]||[]),newSlot]}};
    });
  }

  function removePlannerSlot(key,slotId){
    setPlanner(p=>{
      if(key==="weekday") return {...p,weekdayTemplate:p.weekdayTemplate.filter(s=>s.id!==slotId)};
      if(key==="weekend") return {...p,weekendTemplate:p.weekendTemplate.filter(s=>s.id!==slotId)};
      return {...p,overrides:{...p.overrides,[key]:(p.overrides[key]||[]).filter(s=>s.id!==slotId)}};
    });
  }

  function updatePlannerSlot(key,slotId,patch){
    setPlanner(p=>{
      const upd=arr=>arr.map(s=>s.id===slotId?{...s,...patch}:s);
      if(key==="weekday") return {...p,weekdayTemplate:upd(p.weekdayTemplate)};
      if(key==="weekend") return {...p,weekendTemplate:upd(p.weekendTemplate)};
      return {...p,overrides:{...p.overrides,[key]:upd(p.overrides[key]||[])}};
    });
  }

  function removePlannerOverride(dateKey){
    setPlanner(p=>{ const next={...p.overrides}; delete next[dateKey]; return {...p,overrides:next}; });
    setPlannerSelectedDay(prev=>prev===dateKey?null:prev);
  }

  function handlePlannerDayClick(dateKey){
    if(planner.overrides[dateKey]!==undefined){
      // toggle the override editor open/closed; deletion is via the × button on the cell
      setPlannerSelectedDay(plannerSelectedDay===dateKey?null:dateKey);
    } else {
      const [yr,mo,dy]=dateKey.split("-").map(Number);
      const dow=new Date(yr,mo-1,dy).getDay();
      const isWknd=dow===0||dow===6;
      setPlanner(p=>{
        const template=(isWknd?p.weekendTemplate:p.weekdayTemplate).map((s,i)=>({...s,id:"slot_"+Date.now()+i}));
        return {...p,overrides:{...p.overrides,[dateKey]:template}};
      });
      setPlannerSelectedDay(dateKey);
    }
  }

  // ── Phase 4: rota generation ─────────────────────────────────────────────
  function generateRota(){
    const year=plannerYear, month=plannerMonth;
    const tot=daysInMonth(year,month);
    const allShifts=[];
    const assignedDays={}; // staffId -> Set<dateKey>
    const weekDays={};     // staffId -> weekMonStr -> days assigned this week (max 5)
    const weekHrs={};      // staffId -> weekMonStr -> hours assigned this week
    const proposalWknd={}; // staffId -> weekend shift count in proposal

    // Fix 1: total shifts assigned this month per staff — primary distribution criterion
    const staffMonthShifts={}; // staffId -> count of shifts assigned so far this month

    // Fix 2: rotation offset — staggered per staff member, advances by 1 each week so
    // the preferred starting day shifts forward and no one works the same day block every week.
    // Values cycle 0–4 (Mon–Fri). The sort uses (offset + todayDayIdx) % 5 as a tiebreaker.
    const staffRotOffset={}; // staffId -> current week's rotation offset
    let currentWeekMon=null; // tracks week boundary for advancing offsets

    // ── Guaranteed weekend off ───────────────────────────────────────────────
    const fullWkndCount={};
    const forcedOffSatSun=new Set();
    let forcedWeekendInfo=null;

    // Pre-compute complete weekends in the month (both Sat+Sun within the month)
    const monthWeekends=[];
    for(let d=1;d<=tot;d++){
      const dt=new Date(year,month,d);
      if(dt.getDay()===6){
        const sunDt=addDays(dt,1);
        if(sunDt.getMonth()===month)
          monthWeekends.push({satDk:fmtDateKey(dt),sunDk:fmtDateKey(sunDt)});
      }
    }

    // Supervisors/managers can fill any slot as fallback
    const isSupervisor=s=>/supervisor|manager|team leader/i.test(s.role||"");

    // Build a case-insensitive label→id map from the freshest job titles in localStorage
    // so that staff.role ("Supervisor") correctly resolves to a job title id ("jt_supervisor").
    const savedJtRaw=(()=>{ try{ const r=localStorage.getItem(JOB_TITLES_KEY); return r?JSON.parse(r):null; }catch{ return null; } })();
    const jtSource=savedJtRaw||jobTitles;
    const jtLabelToId=Object.fromEntries(jtSource.map(jt=>[jt.label.trim().toLowerCase(),jt.id]));
    // Pre-compute each staff member's resolved job title id (null if role not in list)
    const staffJtId={};
    staff.forEach(s=>{ staffJtId[s.id]=jtLabelToId[(s.role||"").trim().toLowerCase()]||null; });

    staff.forEach((s,idx)=>{
      assignedDays[s.id]=new Set();
      weekDays[s.id]={};
      weekHrs[s.id]={};
      proposalWknd[s.id]=0;
      fullWkndCount[s.id]=0;
      staffMonthShifts[s.id]=0;
      staffRotOffset[s.id]=idx%5; // stagger initial offsets 0–4 so different staff prefer different start days
    });

    for(let d=1;d<=tot;d++){
      const date=new Date(year,month,d);
      const dk=fmtDateKey(date);
      const dow=date.getDay();
      const isWknd=dow===0||dow===6;
      const weekMon=fmtDateKey(getMondayOf(date));
      const dkWdIdx=(dow+6)%7; // 0=Mon…6=Sun
      const prevDk=dkWdIdx>0?fmtDateKey(addDays(date,-1)):null;

      // Fix 2: at each week boundary, advance every staff member's rotation offset by 1
      if(weekMon!==currentWeekMon){
        if(currentWeekMon!==null){
          staff.forEach(s=>{ staffRotOffset[s.id]=(staffRotOffset[s.id]+1)%5; });
        }
        currentWeekMon=weekMon;
      }

      // Saturday: if this is the last complete weekend, force off any staff who
      // have not yet had a full weekend off this month
      if(dow===6){
        forcedOffSatSun.clear();
        const lastWknd=monthWeekends[monthWeekends.length-1];
        if(lastWknd&&lastWknd.satDk===dk){
          const forcedIds=[];
          staff.forEach(s=>{ if(fullWkndCount[s.id]===0){ forcedOffSatSun.add(s.id); forcedIds.push(s.id); } });
          if(forcedIds.length>0) forcedWeekendInfo={weekMon,staffIds:new Set(forcedIds)};
        }
      }

      const slots=planner.overrides[dk]!==undefined
        ?planner.overrides[dk]
        :(isWknd?planner.weekendTemplate:planner.weekdayTemplate);

      slots.forEach(slot=>{
        const need=slot.staffCount||1;
        const slotHrs=calcHours(slot.startTime,slot.endTime,0);

        for(let i=0;i<need;i++){
          let eligible=staff.filter(s=>{
            if(!(s.allowedLocations||[]).includes(slot.locationId)) return false;
            if((slot.allowedJobTitles||[]).length>0){
              // Match via pre-resolved id so label casing/whitespace differences don't matter.
              // Staff whose role doesn't map to any known title (sJtId===null) are blocked
              // from role-restricted slots but pass through open slots (length===0 above).
              const sJtId=staffJtId[s.id];
              if(!slot.allowedJobTitles.includes(sJtId)&&!isSupervisor(s)) return false;
            }
            if((s.absences||{})[dk]) return false;
            if(assignedDays[s.id].has(dk)) return false;
            if((weekDays[s.id]?.[weekMon]||0)>=5) return false;
            if(isWknd&&forcedOffSatSun.has(s.id)) return false;
            return true;
          });

          eligible=eligible.slice().sort((a,b)=>{
            // 1. Weekend: fewest weekend days this month first (month-level fairness)
            if(isWknd){
              const aW=proposalWknd[a.id]||0;
              const bW=proposalWknd[b.id]||0;
              if(aW!==bW) return aW-bW;
            }

            // 2. Fix 1: fewest total shifts this month → primary distribution criterion.
            //    Ensures staff with 0 shifts are always picked before those with more,
            //    spreading load evenly across all eligible staff rather than reusing the same people.
            const aTot=staffMonthShifts[a.id]||0;
            const bTot=staffMonthShifts[b.id]||0;
            if(aTot!==bTot) return aTot-bTot;

            // 3. Fewest days this week → secondary distribution within equal monthly counts
            const aDays=weekDays[a.id]?.[weekMon]||0;
            const bDays=weekDays[b.id]?.[weekMon]||0;
            if(aDays!==bDays) return aDays-bDays;

            // 4. Prefer extending a consecutive run over starting fresh
            const aAdj=prevDk?assignedDays[a.id].has(prevDk):false;
            const bAdj=prevDk?assignedDays[b.id].has(prevDk):false;
            if(aAdj!==bAdj) return aAdj?-1:1;

            // 5. Fix 2: rotation tiebreaker — among equally-loaded staff, use
            //    (rotationOffset + todayDayIdx) % 5 as a rotating priority value.
            //    Because offset advances each week, Monday priority cycles through
            //    different staff members week-to-week, shifting working-day blocks.
            const aRotPri=(staffRotOffset[a.id]+dkWdIdx)%5;
            const bRotPri=(staffRotOffset[b.id]+dkWdIdx)%5;
            if(aRotPri!==bRotPri) return aRotPri-bRotPri;

            // 6. Most remaining contracted hours this week
            const aIsZero=(a.contractType||"full_time")==="zero_hours";
            const bIsZero=(b.contractType||"full_time")==="zero_hours";
            if(!aIsZero||!bIsZero){
              const aRem=(a.contracted||40)-(weekHrs[a.id]?.[weekMon]||0);
              const bRem=(b.contracted||40)-(weekHrs[b.id]?.[weekMon]||0);
              if(Math.abs(aRem-bRem)>0.01) return bRem-aRem;
            }

            // 7. Weekend final tiebreak: fewest all-time weekend shifts
            if(isWknd) return (a.weekendsWorked||0)-(b.weekendsWorked||0);
            return 0;
          });

          const uid=`${dk}_${slot.id}_${i}`;
          if(eligible.length>0){
            const chosen=eligible[0];
            allShifts.push({uid,date:dk,locationId:slot.locationId,startTime:slot.startTime,endTime:slot.endTime,staffId:chosen.id,unfilled:false});
            assignedDays[chosen.id].add(dk);
            weekDays[chosen.id][weekMon]=(weekDays[chosen.id][weekMon]||0)+1;
            weekHrs[chosen.id][weekMon]=(weekHrs[chosen.id][weekMon]||0)+slotHrs;
            staffMonthShifts[chosen.id]++; // Fix 1: increment monthly total
            if(isWknd) proposalWknd[chosen.id]++;
          } else {
            allShifts.push({uid,date:dk,locationId:slot.locationId,startTime:slot.startTime,endTime:slot.endTime,staffId:null,unfilled:true});
          }
        }
      });

      // Sunday: after slots are assigned, count full weekends off and clear forced-off set
      if(dow===0){
        const satDt=addDays(date,-1);
        if(satDt.getMonth()===month){
          const satDk=fmtDateKey(satDt);
          staff.forEach(s=>{
            if(!assignedDays[s.id].has(satDk)&&!assignedDays[s.id].has(dk))
              fullWkndCount[s.id]++;
          });
        }
        forcedOffSatSun.clear();
      }
    }

    // Group into Mon-Sun calendar weeks
    const firstMon=getMondayOf(new Date(year,month,1));
    const lastDayKey=fmtDateKey(new Date(year,month,tot));
    const weeks=[];
    let ws=new Date(firstMon.getFullYear(),firstMon.getMonth(),firstMon.getDate());
    while(fmtDateKey(ws)<=lastDayKey){
      const we=addDays(ws,6);
      const startStr=fmtDateKey(ws);
      const endStr=fmtDateKey(we);
      const weekShifts=allShifts.filter(s=>s.date>=startStr&&s.date<=endStr);
      const warnings=[];

      // Forced weekend off — informational warning on the week it applies
      if(forcedWeekendInfo&&forcedWeekendInfo.weekMon===startStr){
        forcedWeekendInfo.staffIds.forEach(id=>{
          const m=staff.find(s=>s.id===id);
          if(m) warnings.push({key:`forced_wknd_${id}`,text:`${m.name} has been given this weekend off to guarantee at least 1 full weekend off this month`});
        });
      }

      // Per-staff warnings
      const staffDays={};
      const staffHrs={};
      weekShifts.filter(s=>!s.unfilled).forEach(s=>{
        if(!staffDays[s.staffId]) staffDays[s.staffId]=new Set();
        staffDays[s.staffId].add(s.date);
        staffHrs[s.staffId]=(staffHrs[s.staffId]||0)+calcHours(s.startTime,s.endTime,0);
      });
      staff.forEach(m=>{
        const days=staffDays[m.id]?.size||0;
        if(days>5) warnings.push({key:`over_days_${m.id}`,text:`${m.name} scheduled ${days} days this week (max 5)`});
        const isZeroHrs=(m.contractType||"full_time")==="zero_hours";
        if(!isZeroHrs){
          const hrs=staffHrs[m.id]||0;
          const contracted=m.contracted||40;
          if(days===0){
            // Fix 3: explicit zero-shifts warning — distinct from general under-hours
            warnings.push({key:`no_shifts_${m.id}`,text:`${m.name} has 0 shifts this week — check location permissions and slot job titles`});
          } else if(hrs>contracted){
            warnings.push({key:`over_hrs_${m.id}`,text:`${m.name}: ${hrs.toFixed(1)}h proposed vs ${contracted}h contracted this week`});
          } else if(hrs<contracted){
            warnings.push({key:`under_hrs_${m.id}`,text:`${m.name} is under-hours this week — ${hrs.toFixed(1)}h proposed vs ${contracted}h contracted`});
          }
        }
      });

      // Unfilled slots
      const unfilledCount=weekShifts.filter(s=>s.unfilled).length;
      if(unfilledCount>0) warnings.push({key:"unfilled",text:`${unfilledCount} slot${unfilledCount===1?"":"s"} could not be filled automatically`});

      // Casual budget (monthly total, attach warning to first week only)
      if(weeks.length===0){
        const budgetKey=CASUAL_BUDGET_KEYS[month];
        const monthBudget=casualBudget[budgetKey]||0;
        if(monthBudget>0){
          const zeroIds=new Set(staff.filter(s=>(s.contractType||"full_time")==="zero_hours").map(s=>s.id));
          const casualHrs=allShifts.filter(s=>!s.unfilled&&zeroIds.has(s.staffId))
            .reduce((a,s)=>a+calcHours(s.startTime,s.endTime,0),0);
          if(casualHrs>monthBudget) warnings.push({key:"casual_budget",text:`Casual budget: ${casualHrs.toFixed(1)}h proposed vs ${monthBudget}h budget for ${MONTH_NAMES[month]}`});
        }
      }

      weeks.push({weekIndex:weeks.length,startDate:startStr,endDate:endStr,shifts:weekShifts,warnings});
      ws=addDays(ws,7);
    }

    setProposedRota({year,month,weeks,approved:[],staffFullWkndOff:{...fullWkndCount}});
    setReviewWeekIdx(0);
    setWarningApprovals({});
    setAssigningUid(null);
  }

  function removeProposedShift(weekIdx,uid){
    setProposedRota(prev=>({
      ...prev,
      weeks:prev.weeks.map((w,wi)=>wi!==weekIdx?w:{
        ...w,
        shifts:w.shifts.map(s=>s.uid===uid?{...s,staffId:null,unfilled:true}:s),
      }),
    }));
  }

  function assignProposedShift(weekIdx,uid,staffId){
    setProposedRota(prev=>({
      ...prev,
      weeks:prev.weeks.map((w,wi)=>wi!==weekIdx?w:{
        ...w,
        shifts:w.shifts.map(s=>s.uid===uid?{...s,staffId:Number(staffId),unfilled:false}:s),
      }),
    }));
    setAssigningUid(null);
  }

  function approveWeek(weekIdx){
    const week=proposedRota.weeks[weekIdx];
    const newShifts={...shifts};
    week.shifts.filter(s=>!s.unfilled&&s.staffId!=null).forEach(s=>{
      const date=new Date(s.date+"T00:00:00");
      const wkIdx=Math.round((getMondayOf(date)-baseMonday)/(7*24*3600*1000));
      const dayIdx=(date.getDay()+6)%7;
      const h=parseInt(s.startTime.split(":")[0],10);
      const typeIdx=h<12
        ?(shiftTypes.find(st=>st.label==="Morning")?.idx??shiftTypes[0]?.idx??0)
        :h<17
          ?(shiftTypes.find(st=>st.label==="Afternoon")?.idx??shiftTypes[1]?.idx??1)
          :(shiftTypes.find(st=>st.label==="Evening")?.idx??shiftTypes[2]?.idx??2);
      newShifts[`${s.staffId}-w${wkIdx}-d${dayIdx}`]={start:s.startTime,end:s.endTime,typeIdx,locationId:s.locationId,brk:30};
    });
    setShifts(newShifts);
    setProposedRota(prev=>({...prev,approved:[...prev.approved,weekIdx]}));
    if(weekIdx<proposedRota.weeks.length-1) setReviewWeekIdx(weekIdx+1);
    showNotif(`Week ${weekIdx+1} approved and written to rota ✓`);
  }

  // ── new helpers ──────────────────────────────────────────────────────────
  function updateStaffField(id,patch){
    setStaff(p=>p.map(s=>s.id===id?{...s,...patch}:s));
  }

  function setAbsenceCode(memberId,key,code){
    setStaff(p=>p.map(s=>{
      if(s.id!==memberId) return s;
      const absences={...(s.absences||{})};
      if(code===null) delete absences[key]; else absences[key]=code;
      return {...s,absences};
    }));
  }

  function addDailyInfoRow(){
    const id="row_"+Date.now();
    setDailyInfoRows(p=>[...p,{id,label:"New row"}]);
    setEditingRowId(id);
  }

  function renameInfoRow(id,label){
    setDailyInfoRows(p=>p.map(r=>r.id===id?{...r,label}:r));
  }

  function deleteInfoRow(id){
    if(!window.confirm("Delete this row and all its values?")) return;
    setDailyInfoRows(p=>p.filter(r=>r.id!==id));
    setDailyInfoValues(p=>{
      const next={};
      Object.entries(p).forEach(([wk,rows])=>{
        const {[id]:_removed,...rest}=rows;
        next[wk]=rest;
      });
      return next;
    });
  }

  function addDivider(dept,beforeStaffId){
    const id="div_"+Date.now();
    setStaffDividers(p=>({...p,[dept]:[...(p[dept]||[]),{id,label:"Section",beforeStaffId}]}));
    setEditingDividerId(id);
  }

  function renameDivider(dept,id,label){
    setStaffDividers(p=>({...p,[dept]:(p[dept]||[]).map(d=>d.id===id?{...d,label}:d)}));
  }

  function deleteDivider(dept,id){
    setStaffDividers(p=>({...p,[dept]:(p[dept]||[]).filter(d=>d.id!==id)}));
  }

  function moveDivider(dept,id,direction,visibleStaff){
    setStaffDividers(p=>{
      const divs=(p[dept]||[]);
      const div=divs.find(d=>d.id===id);
      if(!div) return p;
      const curIdx=div.beforeStaffId===null?-1:visibleStaff.findIndex(m=>m.id===div.beforeStaffId);
      let nextBeforeId;
      if(direction==="up"){
        if(curIdx<=0) return p; // already at top (null) or before first
        nextBeforeId=curIdx===1?null:visibleStaff[curIdx-1].id;
      } else {
        if(curIdx>=visibleStaff.length-1) return p; // already before last member
        nextBeforeId=visibleStaff[curIdx+1].id;
      }
      return {...p,[dept]:divs.map(d=>d.id===id?{...d,beforeStaffId:nextBeforeId}:d)};
    });
  }

  function setDailyInfoCell(wk,rowId,dk,val){
    setDailyInfoValues(p=>({
      ...p,
      [wk]:{...(p[wk]||{}),[rowId]:{...((p[wk]||{})[rowId]||{}),[dk]:val}},
    }));
  }

  // ── render ───────────────────────────────────────────────────────────────
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
        select,input,textarea{font-family:inherit;outline:none}
        .agta{width:100%;border:1px solid var(--border);border-radius:4px;padding:3px 5px;font-size:11px;resize:none;overflow:hidden;min-height:26px;background:var(--background);color:var(--foreground);line-height:1.3;box-sizing:border-box;text-align:center}
        .agta:focus{border-color:var(--primary)}
        .agta::placeholder{color:#C8D6E5}
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
            {[["rota","📅 Rota"],["staff","👥 Staff"],["weekends","🏖 Weekends"],["planner","🗓 Planner"],["reports","📊 Reports"],["settings","⚙ Settings"]].map(([t,l])=>(
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
          <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:10,flexWrap:"wrap"}}>
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
              <button onClick={publishRota} style={SB}>{isPublished?"✓ Published":"🚀 Publish"}</button>
            </div>
          </div>

          {/* Department switcher */}
          <div style={{display:"flex",gap:3,marginBottom:10,background:"hsl(220 25% 96%)",borderRadius:8,padding:3,width:"fit-content"}}>
            {departments.map(dept=>(
              <button key={dept.id} onClick={()=>setActiveDept(dept.id)}
                style={{padding:"5px 14px",borderRadius:6,border:"none",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",background:activeDept===dept.id?"var(--background)":"transparent",color:activeDept===dept.id?"var(--foreground)":"var(--muted-foreground)",boxShadow:activeDept===dept.id?"0 1px 3px rgba(0,0,0,.08)":"none",transition:"all .15s"}}>
                {dept.label}
              </button>
            ))}
          </div>

          {/* Stats */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
            {[
              ["👤","Staff",filteredStaff.length],
              ["📅","Shifts",filteredStaff.reduce((a,s)=>{ let c=0; allDays.forEach(({weekIdx,dayIdx})=>{ if(shifts[`${s.id}-w${weekIdx}-d${dayIdx}`]) c++; }); return a+c; },0)],
              ["⏱","Hours",`${filteredStaff.reduce((a,s)=>a+(staffStats[s.id]?.hours||0),0).toFixed(0)}h`],
              ["💷","Est. Cost",`£${(filteredStaff.reduce((a,s)=>a+(staffStats[s.id]?.wageHours||0),0)*WAGE_RATE).toFixed(0)}`],
            ].map(([icon,lbl,val])=>(
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
                <div style={{padding:"8px 10px",fontSize:10,fontWeight:600,color:"var(--muted-foreground)"}}>DAILY INFO</div>
                {allDays.map(({date,dayIdx,key})=>(
                  <div key={key} style={{padding:"5px 2px",textAlign:"center",borderLeft:`1px solid ${isWeekend(dayIdx)?"#3b4f68":"#2d3f55"}`,background:isWeekend(dayIdx)?"#243347":"transparent"}}>
                    <div style={{fontSize:9,color:isWeekend(dayIdx)?"var(--warning)":"#64748b",fontWeight:700}}>{DAYS[dayIdx]}</div>
                    <div style={{fontSize:12,fontWeight:700}}>{date.getDate()}</div>
                    <div style={{fontSize:8,color:"#475569"}}>{fmtDate(date,{month:"short"})}</div>
                  </div>
                ))}
                <div style={{padding:"8px 2px",textAlign:"center",borderLeft:"1px solid #2d3f55",fontSize:9,color:"var(--muted-foreground)",fontWeight:600}}>HRS</div>
              </div>

              {/* Daily info rows */}
              {dailyInfoRows.map((row,ri)=>(
                <div key={row.id} style={{display:"grid",gridTemplateColumns:`190px repeat(${allDays.length},1fr) 66px`,borderTop:"1px solid var(--border)",background:ri%2===0?"var(--background)":"hsl(220 25% 98%)"}}>
                  <div style={{padding:"3px 8px",display:"flex",alignItems:"center",gap:4,borderRight:"1px solid var(--border)"}}>
                    {editingRowId===row.id?(
                      <input autoFocus value={row.label}
                        onChange={e=>renameInfoRow(row.id,e.target.value)}
                        onBlur={()=>setEditingRowId(null)}
                        onKeyDown={e=>e.key==="Enter"&&setEditingRowId(null)}
                        style={{...IS,fontSize:11,padding:"2px 5px",height:24,flex:1}}/>
                    ):(
                      <button onClick={()=>setEditingRowId(row.id)}
                        style={{background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:600,color:"var(--muted-foreground)",display:"flex",alignItems:"center",gap:4,padding:0,textAlign:"left",flex:1,minWidth:0}}>
                        <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row.label}</span>
                        <span style={{fontSize:9,opacity:.4,flexShrink:0}}>✎</span>
                      </button>
                    )}
                    <button onClick={()=>deleteInfoRow(row.id)}
                      title="Delete row"
                      style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:"var(--muted-foreground)",opacity:.4,padding:"0 2px",lineHeight:1,flexShrink:0}}
                      onMouseEnter={e=>e.currentTarget.style.opacity=1}
                      onMouseLeave={e=>e.currentTarget.style.opacity=.4}>
                      ✕
                    </button>
                  </div>
                  {allDays.map(({date,key})=>{
                    const dk=fmtDateKey(date);
                    const val=(dailyInfoValues[weekKey]||{})[row.id]?.[dk]||"";
                    return(
                      <div key={key} style={{borderLeft:"1px solid var(--border)",padding:"2px 2px"}}>
                        <AutoGrowTextarea value={val} onChange={v=>setDailyInfoCell(weekKey,row.id,dk,v)}/>
                      </div>
                    );
                  })}
                  <div style={{borderLeft:"1px solid var(--border)"}}/>
                </div>
              ))}

              {/* Add row + dept label separator */}
              <div style={{display:"grid",gridTemplateColumns:`190px repeat(${allDays.length},1fr) 66px`,borderTop:"1px solid var(--border)",background:"var(--secondary)"}}>
                <div style={{padding:"4px 8px",gridColumn:"1/-1",display:"flex",alignItems:"center",gap:16}}>
                  <button onClick={addDailyInfoRow}
                    style={{background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:600,color:"var(--primary)",padding:0}}>
                    + Add row
                  </button>
                  <span style={{marginLeft:"auto",fontSize:10,fontWeight:700,color:"var(--muted-foreground)",textTransform:"uppercase",letterSpacing:".05em",paddingRight:8}}>
                    {departments.find(d=>d.id===activeDept)?.label||activeDept} — Staff Schedule
                  </span>
                </div>
              </div>

              {/* Staff rows with section dividers */}
              {(()=>{
                const deptDividers=staffDividers[activeDept]||[];
                const rows=[];
                // top-of-list dividers (beforeStaffId===null)
                deptDividers.filter(d=>d.beforeStaffId===null).forEach(div=>{
                  rows.push({type:"divider",div});
                });
                filteredStaff.forEach((member,mi)=>{
                  // dividers before this member
                  deptDividers.filter(d=>d.beforeStaffId===member.id).forEach(div=>{
                    rows.push({type:"divider",div});
                  });
                  rows.push({type:"member",member,mi});
                });
                let staffRowIdx=0;
                return rows.map(row=>{
                  if(row.type==="divider"){
                    const {div}=row;
                    return(
                      <div key={div.id} style={{display:"grid",gridTemplateColumns:`190px repeat(${allDays.length},1fr) 66px`,borderTop:"1px solid var(--border)",background:"#111"}}>
                        <div style={{padding:"3px 8px",display:"flex",alignItems:"center",gap:4,borderRight:"1px solid rgba(255,255,255,.12)"}}>
                          <span style={{fontSize:9,color:"rgba(255,255,255,.5)",opacity:.5,flexShrink:0}}>§</span>
                          {editingDividerId===div.id?(
                            <input autoFocus value={div.label}
                              onChange={e=>renameDivider(activeDept,div.id,e.target.value)}
                              onBlur={()=>setEditingDividerId(null)}
                              onKeyDown={e=>e.key==="Enter"&&setEditingDividerId(null)}
                              style={{...IS,fontSize:10,padding:"1px 4px",height:20,flex:1}}/>
                          ):(
                            <button onClick={()=>setEditingDividerId(div.id)}
                              style={{background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:10,fontWeight:700,color:"rgba(255,255,255,.8)",display:"flex",alignItems:"center",gap:3,padding:0,flex:1,minWidth:0,textAlign:"left"}}>
                              <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{div.label}</span>
                              <span style={{fontSize:8,opacity:.35}}>✎</span>
                            </button>
                          )}
                          <button onClick={()=>moveDivider(activeDept,div.id,"up",filteredStaff)} title="Move up"
                            style={{background:"none",border:"none",cursor:"pointer",fontSize:10,color:"#fff",opacity:.4,padding:"0 1px",flexShrink:0}}
                            onMouseEnter={e=>e.currentTarget.style.opacity=1}
                            onMouseLeave={e=>e.currentTarget.style.opacity=.4}>↑</button>
                          <button onClick={()=>moveDivider(activeDept,div.id,"down",filteredStaff)} title="Move down"
                            style={{background:"none",border:"none",cursor:"pointer",fontSize:10,color:"#fff",opacity:.4,padding:"0 1px",flexShrink:0}}
                            onMouseEnter={e=>e.currentTarget.style.opacity=1}
                            onMouseLeave={e=>e.currentTarget.style.opacity=.4}>↓</button>
                          <button onClick={()=>deleteDivider(activeDept,div.id)} title="Delete divider"
                            style={{background:"none",border:"none",cursor:"pointer",fontSize:10,color:"#fff",opacity:.4,padding:"0 1px",flexShrink:0}}
                            onMouseEnter={e=>e.currentTarget.style.opacity=1}
                            onMouseLeave={e=>e.currentTarget.style.opacity=.4}>✕</button>
                        </div>
                        <div style={{gridColumn:`2 / span ${allDays.length+1}`,borderLeft:"1px solid rgba(255,255,255,.12)",display:"flex",alignItems:"center",padding:"0 8px"}}>
                          <div style={{flex:1,height:1,background:"rgba(255,255,255,.2)"}}/>
                        </div>
                      </div>
                    );
                  }
                  // staff row
                  const {member,mi}=row;
                  const rowIdx=staffRowIdx++;
                  const stats=staffStats[member.id]||{hours:0,wkndShifts:0};
                  const target=member.contracted*numWeeks;
                  const over=stats.hours>target;
                  return(
                    <div key={member.id} style={{display:"grid",gridTemplateColumns:`190px repeat(${allDays.length},1fr) 66px`,borderTop:"1px solid var(--border)",background:rowIdx%2===0?"var(--background)":"var(--secondary)"}}>
                      <div style={{padding:"5px 8px",display:"flex",alignItems:"center",gap:6}}>
                        <div style={{width:26,height:26,borderRadius:"50%",background:member.color,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,flexShrink:0}}>{member.avatar}</div>
                        <div style={{minWidth:0,flex:1}}>
                          <div style={{fontSize:11,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:110}}>{member.name}</div>
                          <div style={{fontSize:9,color:"var(--muted-foreground)"}}>{member.role}</div>
                        </div>
                        <button onClick={()=>addDivider(activeDept,member.id)} title="Insert section above"
                          style={{background:"none",border:"none",cursor:"pointer",fontSize:9,color:"var(--muted-foreground)",opacity:.3,padding:"0 2px",flexShrink:0,lineHeight:1}}
                          onMouseEnter={e=>e.currentTarget.style.opacity=1}
                          onMouseLeave={e=>e.currentTarget.style.opacity=.3}>§</button>
                      </div>
                      {allDays.map(({date,weekIdx,dayIdx,key})=>{
                        const dk=fmtDateKey(date);
                        const absCode=(member.absences||{})[dk];
                        const absInfo=absCode?ABSENCE_CODE_MAP[absCode]:null;
                        const sk=`${member.id}-w${weekIdx}-d${dayIdx}`, shift=shifts[sk];
                        const l=(!absCode&&shift)?getLoc(shift.locationId):null;
                        const wknd=isWeekend(dayIdx);
                        return(
                          <div key={key} className="cell"
                            onClick={()=>absInfo
                              ? setAbsenceModal({staffId:member.id,dateKey:dk,code:absCode})
                              : openShiftModal(member.id,weekIdx,dayIdx)}
                            style={{borderLeft:`1px solid ${wknd?"#dce6f0":"#EEF2F7"}`,padding:"2px 2px",minHeight:48,display:"flex",alignItems:"center",justifyContent:"center",background:wknd?(rowIdx%2===0?"#FFF9F0":"#FEF7E8"):"inherit"}}>
                            {absInfo?(
                              <div className="chip" style={{background:absInfo.color,border:`1.5px solid ${absInfo.color}`,borderRadius:5,padding:"3px 4px",width:"100%"}}>
                                <div style={{fontSize:11,fontWeight:700,color:"#fff",textAlign:"center",lineHeight:1.1}}>{absInfo.key}</div>
                                <div style={{fontSize:8,color:"rgba(255,255,255,.85)",textAlign:"center",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{absInfo.label}</div>
                              </div>
                            ):shift?(
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
                        <div style={{fontSize:8,fontWeight:700,color:over?"#16a34a":"var(--destructive)",lineHeight:1.2}}>
                          {over?`+${(stats.hours-target).toFixed(1)}`:`−${(target-stats.hours).toFixed(1)}`}
                        </div>
                        <div style={{width:28,height:3,background:"var(--secondary)",borderRadius:2,marginTop:2}}>
                          <div style={{width:`${Math.min(100,(stats.hours/target)*100)}%`,height:"100%",background:over?"var(--destructive)":"var(--primary)",borderRadius:2}}/>
                        </div>
                        <div style={{fontSize:8,color:"var(--warning)",marginTop:2}}>🏖{stats.wkndShifts}</div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* Legend */}
          <div style={{display:"flex",gap:10,marginTop:10,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontSize:10,color:"var(--muted-foreground)",fontWeight:700}}>LOCATIONS:</span>
            {locations.map(l=>(
              <div key={l.id} style={{display:"flex",alignItems:"center",gap:4,fontSize:11}}>
                <div style={{width:9,height:9,borderRadius:2,background:l.bg,border:`1.5px solid ${l.border}`}}/>
                <span style={{color:"var(--muted-foreground)"}}>{l.label}</span>
              </div>
            ))}
            <span style={{fontSize:10,color:"var(--muted-foreground)",fontWeight:700,marginLeft:6}}>TYPES:</span>
            {shiftTypes.map(t=>(
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
          {!selectedStaffId?(
            <>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <h2 style={{margin:0,fontSize:17,fontWeight:700}}>Staff Directory</h2>
                <button onClick={()=>setShowStaffModal(true)} style={SB}>+ Add Staff Member</button>
              </div>
              {departments.map(dept=>{
                const deptStaff=staff.filter(s=>s.department===dept.id);
                const open=!!expandedDepts[dept.id];
                return(
                  <div key={dept.id} style={{marginBottom:10}}>
                    <div onClick={()=>setExpandedDepts(p=>({...p,[dept.id]:!p[dept.id]}))}
                      style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",background:"var(--secondary)",border:"1px solid var(--border)",borderRadius:open?"10px 10px 0 0":10,cursor:"pointer",userSelect:"none"}}>
                      <span style={{fontSize:12,display:"inline-block",transform:open?"rotate(90deg)":"rotate(0deg)",transition:"transform .2s",lineHeight:1}}>▸</span>
                      <span style={{fontWeight:700,fontSize:13,flex:1}}>{dept.label}</span>
                      <span style={{background:"var(--background)",border:"1px solid var(--border)",borderRadius:12,padding:"1px 8px",fontSize:11,fontWeight:700,color:"var(--muted-foreground)"}}>{deptStaff.length}</span>
                    </div>
                    {open&&(
                      <div style={{border:"1px solid var(--border)",borderTop:"none",borderRadius:"0 0 10px 10px",padding:12}}>
                        {deptStaff.length===0?(
                          <div style={{fontSize:12,color:"var(--muted-foreground)",padding:"8px 4px"}}>No staff in this department.</div>
                        ):(
                          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
                            {deptStaff.map(member=>{
                              const stats=staffStats[member.id]||{hours:0,wkndShifts:0};
                              return(
                                <div key={member.id}
                                  style={{background:"var(--background)",borderRadius:11,padding:16,border:"1px solid var(--border)",borderTop:`4px solid ${member.color}`,cursor:"pointer"}}
                                  onClick={()=>{ setSelectedStaffId(member.id); setProfileTab("overview"); setAbsencePickerDate(null); }}>
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
                                  <button onClick={e=>{ e.stopPropagation(); removeStaff(member.id); }}
                                    style={{marginTop:9,width:"100%",border:`1px solid var(--destructive)`,background:"#FFF5F5",color:"var(--destructive)",borderRadius:6,padding:"5px",fontSize:11,fontFamily:"inherit",cursor:"pointer",fontWeight:500}}>
                                    Remove
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          ):(()=>{
            const member=staff.find(s=>s.id===selectedStaffId);
            if(!member){ setSelectedStaffId(null); return null; }
            const dailyHours=member.contracted/5;

            // Monthly breakdown for Overview tab
            const monthlyData=Array.from({length:12},(_,m)=>{
              const mk=`${profileViewYear}-${String(m+1).padStart(2,"0")}`;
              const expectedHrs=weekdaysInMonth(profileViewYear,m)*dailyHours;
              let absenceDays=0;
              Object.entries(member.absences||{}).forEach(([k,code])=>{ if(k.startsWith(mk)&&code!=="W") absenceDays++; });
              const absenceHrs=absenceDays*dailyHours;
              // Rota'd hrs: computed from actual shift data for months in the current rota view
              // TODO: months outside the current view show "—" because shift keys are view-relative
              let rotaHrs=null;
              if(visibleMonths.has(mk)){
                rotaHrs=0;
                allDays.forEach(({date,weekIdx,dayIdx})=>{
                  const dm=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;
                  if(dm===mk){
                    const sk=`${member.id}-w${weekIdx}-d${dayIdx}`;
                    if(shifts[sk]) rotaHrs+=calcHours(shifts[sk].start,shifts[sk].end,shifts[sk].brk);
                  }
                });
              }
              const diff=rotaHrs!==null?rotaHrs-expectedHrs:null;
              return {m,mk,expectedHrs,absenceHrs,rotaHrs,diff};
            });
            const ytdExpected=monthlyData.reduce((a,r)=>a+r.expectedHrs,0);
            const ytdRota=monthlyData.reduce((a,r)=>a+(r.rotaHrs||0),0);
            const ytdDiff=ytdRota-ytdExpected;

            // Absence stats for current calendar year/month view
            const calYear=absenceViewYear, calMonth=absenceViewMonth;
            const yCounts=Object.fromEntries(ABSENCE_CODES.map(c=>[c.key,0]));
            Object.entries(member.absences||{}).forEach(([k,code])=>{
              if(k.startsWith(String(calYear))&&yCounts[code]!==undefined) yCounts[code]++;
            });
            const holidayUsedHrs=yCounts.H*dailyHours;
            const holidayAllowHrs=(member.annualHolidayDays||28)*dailyHours;
            const holidayRemHrs=holidayAllowHrs-holidayUsedHrs;
            const daysLeft=dailyHours>0?holidayRemHrs/dailyHours:0;

            // Calendar helpers
            const calDays=daysInMonth(calYear,calMonth);
            const calOffset=firstWeekdayMon(calYear,calMonth);
            const calPad=String(calMonth+1).padStart(2,"0");

            return(
              <div>
                {/* Profile header */}
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:44,height:44,borderRadius:"50%",background:member.color,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:700}}>{member.avatar}</div>
                    <div>
                      <div style={{fontSize:17,fontWeight:700}}>{member.name}</div>
                      <div style={{fontSize:11,color:"var(--muted-foreground)",background:"var(--secondary)",padding:"1px 7px",borderRadius:8,display:"inline-block",marginTop:2}}>{member.role}</div>
                    </div>
                  </div>
                  <button onClick={()=>{ setSelectedStaffId(null); setAbsencePickerDate(null); }}
                    style={{background:"none",border:"1px solid var(--border)",borderRadius:6,padding:"5px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit",color:"var(--muted-foreground)"}}>
                    ← Back
                  </button>
                </div>

                {/* Sub-tabs */}
                <div style={{display:"flex",borderBottom:"1px solid var(--border)",marginBottom:16}}>
                  {[["overview","Overview"],["absences","Absences"]].map(([k,label])=>(
                    <button key={k} onClick={()=>setProfileTab(k)}
                      style={{background:"none",border:"none",borderBottom:`2px solid ${profileTab===k?"var(--primary)":"transparent"}`,padding:"8px 16px",fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"inherit",color:profileTab===k?"var(--primary)":"var(--muted-foreground)",marginBottom:-1}}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* ── OVERVIEW ── */}
                {profileTab==="overview"&&(
                  <>
                    {/* Editable fields */}
                    <div style={{background:"var(--background)",border:"1px solid var(--border)",borderRadius:10,padding:14,marginBottom:14,display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",gap:12}}>
                      <div>
                        <label style={FL}>Contracted hrs/wk</label>
                        <input type="number" value={member.contracted??""} onChange={e=>updateStaffField(member.id,{contracted:Number(e.target.value)||0})} style={{...IS,fontFamily:"DM Mono,monospace"}}/>
                      </div>
                      <div>
                        <label style={FL}>Annual holiday (days)</label>
                        <input type="number" value={member.annualHolidayDays??""} onChange={e=>updateStaffField(member.id,{annualHolidayDays:Number(e.target.value)||0})} style={{...IS,fontFamily:"DM Mono,monospace"}}/>
                      </div>
                      <div>
                        <label style={FL}>Annualised hours</label>
                        <div style={{display:"flex",alignItems:"center",gap:5}}>
                          <input type="number" value={member.annualisedHours??""} onChange={e=>updateStaffField(member.id,{annualisedHours:Number(e.target.value)||0})} style={{...IS,fontFamily:"DM Mono,monospace",flex:1}}/>
                          <button onClick={()=>updateStaffField(member.id,{annualisedHours:member.contracted*52})}
                            style={{background:"none",border:"none",color:"var(--primary)",fontSize:10,cursor:"pointer",fontFamily:"inherit",textDecoration:"underline",whiteSpace:"nowrap",padding:0}}>
                            reset
                          </button>
                        </div>
                      </div>
                      <div>
                        <label style={FL}>Department</label>
                        <select value={member.department||departments[0]?.id||""} onChange={e=>updateStaffField(member.id,{department:e.target.value})} style={IS}>
                          {departments.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={FL}>Contract Type</label>
                        <select value={member.contractType||"full_time"} onChange={e=>updateStaffField(member.id,{contractType:e.target.value})} style={IS}>
                          <option value="full_time">Full Time</option>
                          <option value="part_time">Part Time</option>
                          <option value="zero_hours">Zero Hours / Casual</option>
                        </select>
                      </div>
                    </div>

                    {/* Allowed locations */}
                    <div style={{background:"var(--background)",border:"1px solid var(--border)",borderRadius:10,padding:14,marginBottom:14}}>
                      <div style={{fontSize:11,fontWeight:700,color:"var(--muted-foreground)",marginBottom:3}}>Allowed locations</div>
                      <div style={{fontSize:11,color:"var(--muted-foreground)",marginBottom:10}}>Select the locations this staff member can work at.</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                        {locations.map(loc=>{
                          const allowed=(member.allowedLocations||[]).includes(loc.id);
                          return(
                            <button key={loc.id}
                              onClick={()=>{
                                const current=member.allowedLocations||[];
                                updateStaffField(member.id,{allowedLocations:allowed?current.filter(id=>id!==loc.id):[...current,loc.id]});
                              }}
                              style={{display:"flex",alignItems:"center",gap:6,padding:"7px 11px",borderRadius:8,border:`2px solid ${allowed?"hsl(160 84% 39%)":"var(--border)"}`,background:allowed?"hsl(160 84% 39% / 0.08)":"var(--background)",color:allowed?"hsl(160 84% 25%)":"var(--muted-foreground)",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,transition:"all .12s"}}>
                              <div style={{width:8,height:8,borderRadius:"50%",background:allowed?"hsl(160 84% 39%)":loc.border,flexShrink:0}}/>
                              {loc.label}
                              {allowed&&<span style={{marginLeft:2,fontSize:10}}>✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Monthly hours table */}
                    <div style={{background:"var(--background)",border:"1px solid var(--border)",borderRadius:10,overflow:"hidden"}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderBottom:"1px solid var(--border)",background:"var(--secondary)"}}>
                        <span style={{fontSize:11,fontWeight:700,color:"var(--muted-foreground)",textTransform:"uppercase",letterSpacing:".05em"}}>
                          Hours by month — {profileViewYear}
                        </span>
                        <div style={{display:"flex",gap:14,fontSize:11,color:"var(--muted-foreground)"}}>
                          <span>YTD expected <strong style={{color:"var(--foreground)"}}>{ytdExpected.toFixed(1)}h</strong></span>
                          <span>YTD rota'd <strong style={{color:"var(--foreground)"}}>{ytdRota.toFixed(1)}h</strong></span>
                          <span>Diff <strong style={{color:ytdDiff<0?"var(--destructive)":"var(--primary)"}}>{ytdDiff>=0?"+":""}{ytdDiff.toFixed(1)}h</strong></span>
                        </div>
                      </div>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                        <thead>
                          <tr>
                            {["Month","Expected hrs","Rota'd hrs","Absence hrs","Difference"].map(h=>(
                              <th key={h} style={{padding:"6px 12px",textAlign:h==="Month"?"left":"right",fontSize:10,fontWeight:600,color:"var(--muted-foreground)",borderBottom:"1px solid var(--border)",background:"var(--secondary)"}}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {monthlyData.map(row=>(
                            <tr key={row.mk} style={{borderTop:"1px solid var(--border)"}}>
                              <td style={{padding:"6px 12px",fontWeight:500}}>{MONTH_NAMES[row.m]}</td>
                              <td style={{padding:"6px 12px",textAlign:"right",color:"var(--muted-foreground)",fontFamily:"DM Mono,monospace"}}>{row.expectedHrs.toFixed(1)}</td>
                              <td style={{padding:"6px 12px",textAlign:"right",fontFamily:"DM Mono,monospace",color:row.rotaHrs===null?"var(--muted-foreground)":"var(--foreground)"}}>
                                {row.rotaHrs===null?"—":row.rotaHrs.toFixed(1)}
                              </td>
                              <td style={{padding:"6px 12px",textAlign:"right",color:"var(--muted-foreground)",fontFamily:"DM Mono,monospace"}}>{row.absenceHrs.toFixed(1)}</td>
                              <td style={{padding:"6px 12px",textAlign:"right",fontFamily:"DM Mono,monospace",fontWeight:600,color:row.diff===null?"var(--muted-foreground)":row.diff<0?"var(--destructive)":row.diff>0?"var(--primary)":"var(--muted-foreground)"}}>
                                {row.diff===null?"—":`${row.diff>=0?"+":""}${row.diff.toFixed(1)}`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {/* ── ABSENCES ── */}
                {profileTab==="absences"&&(
                  <>
                    {/* Stat cards */}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
                      {[
                        ["Holiday used (hrs)",      holidayUsedHrs.toFixed(1), false],
                        ["Holiday remaining (hrs)",  holidayRemHrs.toFixed(1),  true ],
                        ["Days left",                daysLeft.toFixed(1),       true ],
                      ].map(([lbl,val,accent])=>(
                        <div key={lbl} style={{background:accent?"hsl(160 84% 39% / 0.08)":"var(--background)",border:"1px solid var(--border)",borderRadius:9,padding:"12px 14px"}}>
                          <div style={{fontSize:10,fontWeight:600,color:"var(--muted-foreground)",textTransform:"uppercase",letterSpacing:".05em",marginBottom:6}}>{lbl}</div>
                          <div style={{fontSize:20,fontWeight:700,fontFamily:"DM Mono,monospace",color:accent?"hsl(160 84% 25%)":"var(--foreground)"}}>{val}</div>
                        </div>
                      ))}
                    </div>

                    {/* Code totals strip */}
                    <div style={{background:"var(--background)",border:"1px solid var(--border)",borderRadius:10,overflow:"hidden",marginBottom:14}}>
                      <div style={{padding:"8px 12px",fontSize:10,fontWeight:700,color:"var(--muted-foreground)",textTransform:"uppercase",letterSpacing:".05em",borderBottom:"1px solid var(--border)",background:"var(--secondary)"}}>
                        {calYear} totals by type
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:`repeat(${ABSENCE_CODES.length},1fr)`}}>
                        {ABSENCE_CODES.map(c=>(
                          <div key={c.key} style={{padding:"10px 0",textAlign:"center",borderRight:"1px solid var(--border)"}}>
                            <div style={{width:7,height:7,borderRadius:"50%",background:c.color,margin:"0 auto 5px"}}/>
                            <div style={{fontSize:14,fontWeight:700,fontFamily:"DM Mono,monospace"}}>{yCounts[c.key]}</div>
                            <div style={{fontSize:9,color:"var(--muted-foreground)",marginTop:2}}>{c.key}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Calendar */}
                    <div style={{background:"var(--background)",border:"1px solid var(--border)",borderRadius:10,overflow:"hidden",marginBottom:absencePickerDate?72:14}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderBottom:"1px solid var(--border)",background:"var(--secondary)"}}>
                        <div style={{display:"flex",alignItems:"center",gap:4}}>
                          <button onClick={()=>{ let m=calMonth-1,y=calYear; if(m<0){m=11;y--;} setAbsenceViewMonth(m); setAbsenceViewYear(y); }}
                            style={{background:"none",border:"none",cursor:"pointer",fontSize:16,color:"var(--muted-foreground)",lineHeight:1,padding:"0 4px"}}>‹</button>
                          <span style={{fontSize:13,fontWeight:600,minWidth:148,textAlign:"center"}}>{MONTH_NAMES[calMonth]} {calYear}</span>
                          <button onClick={()=>{ let m=calMonth+1,y=calYear; if(m>11){m=0;y++;} setAbsenceViewMonth(m); setAbsenceViewYear(y); }}
                            style={{background:"none",border:"none",cursor:"pointer",fontSize:16,color:"var(--muted-foreground)",lineHeight:1,padding:"0 4px"}}>›</button>
                        </div>
                        <div style={{display:"flex",gap:7,flexWrap:"wrap",justifyContent:"flex-end"}}>
                          {ABSENCE_CODES.map(c=>(
                            <div key={c.key} style={{display:"flex",alignItems:"center",gap:3,fontSize:10,color:"var(--muted-foreground)"}}>
                              <div style={{width:6,height:6,borderRadius:"50%",background:c.color}}/>
                              {c.key}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",padding:"4px 8px",borderBottom:"1px solid var(--border)"}}>
                        {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d=>(
                          <div key={d} style={{textAlign:"center",fontSize:10,fontWeight:600,color:"var(--muted-foreground)",padding:"3px 0"}}>{d}</div>
                        ))}
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,padding:"3px 6px"}}>
                        {Array.from({length:calOffset}).map((_,i)=><div key={"e"+i}/>)}
                        {Array.from({length:calDays}).map((_,i)=>{
                          const d=i+1;
                          const dk=`${calYear}-${calPad}-${String(d).padStart(2,"0")}`;
                          const code=(member.absences||{})[dk];
                          const ci=code?ABSENCE_CODE_MAP[code]:null;
                          const wknd=isWeekendDate(calYear,calMonth,d);
                          return(
                            <button key={dk} onClick={()=>setAbsencePickerDate(dk)}
                              style={{height:26,borderRadius:5,border:absencePickerDate===dk?"2px solid var(--primary)":"1px solid var(--border)",background:ci?ci.color:wknd?"hsl(220 20% 97%)":"var(--background)",color:ci?"#fff":wknd?"var(--muted-foreground)":"var(--foreground)",fontSize:10,fontWeight:ci?700:400,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center"}}>
                              {d}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Code picker bottom bar */}
                    {absencePickerDate&&(
                      <div style={{position:"fixed",bottom:0,left:0,right:0,background:"var(--background)",borderTop:"1px solid var(--border)",padding:"10px 18px",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",zIndex:200,boxShadow:"0 -4px 16px rgba(0,0,0,.06)"}}>
                        <span style={{fontSize:11,fontWeight:600,color:"var(--muted-foreground)",marginRight:4}}>{absencePickerDate} —</span>
                        {ABSENCE_CODES.map(c=>(
                          <button key={c.key} onClick={()=>{ setAbsenceCode(member.id,absencePickerDate,c.key); setAbsencePickerDate(null); }}
                            style={{background:c.color,color:"#fff",border:"none",borderRadius:5,padding:"5px 9px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                            {c.key} · {c.label}
                          </button>
                        ))}
                        <button onClick={()=>{ setAbsenceCode(member.id,absencePickerDate,null); setAbsencePickerDate(null); }}
                          style={{background:"none",border:"1px solid var(--border)",borderRadius:5,padding:"5px 9px",fontSize:11,color:"var(--muted-foreground)",cursor:"pointer",fontFamily:"inherit"}}>
                          Clear
                        </button>
                        <button onClick={()=>setAbsencePickerDate(null)}
                          style={{marginLeft:"auto",background:"none",border:"none",fontSize:18,cursor:"pointer",color:"var(--muted-foreground)",lineHeight:1,padding:0}}>×</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })()}
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
                  <div>{isNext?<span style={{background:"#FEF3C7",color:"#d97706",fontSize:10,padding:"3px 7px",borderRadius:8,fontWeight:700}}>⬆ Assign Next</span>:<span style={{color:"var(--muted-foreground)",fontSize:11}}>—</span>}</div>
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
              const satStaff=staff.filter(s=>shifts[`${s.id}-w${weekOffset+wi}-d5`]);
              const sunStaff=staff.filter(s=>shifts[`${s.id}-w${weekOffset+wi}-d6`]);
              return(
                <div key={wi} style={{background:"var(--background)",borderRadius:10,padding:13,border:"1px solid var(--border)"}}>
                  <div style={{fontWeight:700,fontSize:12,marginBottom:8}}>Week {wi+1} · {fmtDate(ws,{day:"numeric",month:"short"})}</div>
                  {[["Saturday 🌤",satStaff],["Sunday ☀️",sunStaff]].map(([lbl,arr])=>(
                    <div key={lbl} style={{marginBottom:7}}>
                      <div style={{fontSize:10,color:"var(--muted-foreground)",fontWeight:600,marginBottom:3}}>{lbl} — {arr.length} staff</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                        {arr.length===0
                          ?<span style={{fontSize:10,color:"var(--destructive)",background:"#FFF5F5",padding:"2px 6px",borderRadius:6,fontWeight:500}}>⚠ None scheduled</span>
                          :arr.map(s=><span key={s.id} style={{background:s.color,color:"#fff",fontSize:10,padding:"2px 6px",borderRadius:6,fontWeight:700}}>{s.avatar}</span>)}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== PLANNER TAB ===== */}
      {activeTab==="planner"&&proposedRota&&(()=>{
        const week=proposedRota.weeks[reviewWeekIdx];
        const isApproved=proposedRota.approved.includes(reviewWeekIdx);
        const allApproved=proposedRota.approved.length===proposedRota.weeks.length;
        const weekApprovals=warningApprovals[reviewWeekIdx]||{};
        const canApprove=!isApproved&&(week.warnings.length===0||week.warnings.every(w=>weekApprovals[w.key]));

        // Build grid data
        const [sy,sm,sd]=week.startDate.split("-").map(Number);
        const weekDates=Array.from({length:7},(_,i)=>addDays(new Date(sy,sm-1,sd),i));
        const inMonth=dt=>dt.getMonth()===proposedRota.month&&dt.getFullYear()===proposedRota.year;

        const shiftsByStaff={}; // staffId -> dateKey -> shift[]
        const unfilledByDate={}; // dateKey -> shift[]
        week.shifts.forEach(s=>{
          if(s.unfilled){
            if(!unfilledByDate[s.date]) unfilledByDate[s.date]=[];
            unfilledByDate[s.date].push(s);
          } else {
            if(!shiftsByStaff[s.staffId]) shiftsByStaff[s.staffId]={};
            if(!shiftsByStaff[s.staffId][s.date]) shiftsByStaff[s.staffId][s.date]=[];
            shiftsByStaff[s.staffId][s.date].push(s);
          }
        });
        const activeStaff=staff.filter(s=>shiftsByStaff[s.id]);
        const hasUnfilled=Object.keys(unfilledByDate).length>0;

        // Summary stats for "all approved" screen
        const totalShifts=proposedRota.weeks.flatMap(w=>w.shifts).filter(s=>!s.unfilled).length;
        const totalHrs=proposedRota.weeks.flatMap(w=>w.shifts).filter(s=>!s.unfilled)
          .reduce((a,s)=>a+calcHours(s.startTime,s.endTime,0),0);
        const estCost=(totalHrs*WAGE_RATE).toLocaleString("en-GB",{style:"currency",currency:"GBP",maximumFractionDigits:0});

        return(
          <div style={{padding:"14px 18px 80px"}}>
            {/* Header */}
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
              <div>
                <h2 style={{margin:"0 0 2px",fontSize:17,fontWeight:700}}>
                  Review proposed rota — {MONTH_NAMES[proposedRota.month]} {proposedRota.year}
                </h2>
                <p style={{margin:0,fontSize:12,color:"var(--muted-foreground)"}}>Approve each week to write shifts to the rota.</p>
              </div>
              <button onClick={()=>{ if(window.confirm("Discard this proposed rota and return to the planner?")){ setProposedRota(null); setWarningApprovals({}); setReviewWeekIdx(0); setAssigningUid(null); } }}
                style={{border:"1.5px solid var(--destructive)",background:"#FFF5F5",color:"var(--destructive)",borderRadius:7,padding:"6px 13px",fontSize:12,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>
                ← Back to planner
              </button>
            </div>

            {allApproved?(
              /* ── Rota complete summary ── */
              <div style={{background:"#F0FDF4",border:"1.5px solid #10b981",borderRadius:12,padding:24,textAlign:"center"}}>
                <div style={{fontSize:32,marginBottom:8}}>✓</div>
                <h3 style={{margin:"0 0 6px",fontSize:16,fontWeight:700,color:"#065f46"}}>Rota complete!</h3>
                <p style={{margin:"0 0 18px",fontSize:13,color:"#047857"}}>All weeks approved and written to the rota.</p>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,maxWidth:340,margin:"0 auto 20px"}}>
                  {[["Shifts",totalShifts],["Hours",`${totalHrs.toFixed(0)}h`],["Est. cost",estCost]].map(([lbl,val])=>(
                    <div key={lbl} style={{background:"#fff",border:"1px solid #6ee7b7",borderRadius:9,padding:"12px 8px"}}>
                      <div style={{fontSize:18,fontWeight:700,color:"#065f46"}}>{val}</div>
                      <div style={{fontSize:11,color:"#047857",marginTop:2}}>{lbl}</div>
                    </div>
                  ))}
                </div>
                <button onClick={()=>{ setProposedRota(null); setWarningApprovals({}); setReviewWeekIdx(0); }}
                  style={{background:"#10b981",color:"#fff",border:"none",borderRadius:8,padding:"10px 22px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                  Back to planner
                </button>
              </div>
            ):(
              <>
                {/* Week navigator + progress */}
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,flexWrap:"wrap"}}>
                  <button onClick={()=>setReviewWeekIdx(i=>Math.max(0,i-1))} disabled={reviewWeekIdx===0}
                    style={{...NB,opacity:reviewWeekIdx===0?.4:1}}>‹</button>
                  <span style={{fontSize:14,fontWeight:700}}>Week {reviewWeekIdx+1} of {proposedRota.weeks.length}</span>
                  <button onClick={()=>setReviewWeekIdx(i=>Math.min(proposedRota.weeks.length-1,i+1))} disabled={reviewWeekIdx===proposedRota.weeks.length-1}
                    style={{...NB,opacity:reviewWeekIdx===proposedRota.weeks.length-1?.4:1}}>›</button>
                  <div style={{display:"flex",gap:5,marginLeft:6}}>
                    {proposedRota.weeks.map((w,i)=>{
                      const done=proposedRota.approved.includes(i);
                      return(
                        <div key={i} onClick={()=>setReviewWeekIdx(i)}
                          style={{width:26,height:26,borderRadius:"50%",border:`2px solid ${done?"#10b981":i===reviewWeekIdx?"hsl(160 84% 39%)":"var(--border)"}`,background:done?"#10b981":i===reviewWeekIdx?"hsl(160 84% 39% / 0.12)":"var(--background)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:done?"#fff":i===reviewWeekIdx?"hsl(160 84% 25%)":"var(--muted-foreground)",transition:"all .12s"}}>
                          {done?"✓":i+1}
                        </div>
                      );
                    })}
                  </div>
                  <span style={{fontSize:11,color:"var(--muted-foreground)",marginLeft:4}}>
                    {week.startDate} – {week.endDate}
                  </span>
                  {isApproved&&<span style={{fontSize:11,fontWeight:700,color:"#10b981",background:"#F0FDF4",border:"1px solid #6ee7b7",borderRadius:5,padding:"2px 8px"}}>Approved ✓</span>}
                </div>

                {/* Mini rota grid */}
                <div style={{overflowX:"auto",marginBottom:16}}>
                  <div style={{minWidth:600}}>
                    {/* Column headers */}
                    <div style={{display:"grid",gridTemplateColumns:`140px repeat(7,1fr)`,gap:2,marginBottom:3}}>
                      <div/>
                      {weekDates.map((dt,i)=>{
                        const inM=inMonth(dt);
                        return(
                          <div key={i} style={{textAlign:"center",padding:"4px 2px",background:inM?"var(--secondary)":"hsl(220 20% 97%)",borderRadius:5,opacity:inM?1:.5}}>
                            <div style={{fontSize:10,fontWeight:700,color:"var(--muted-foreground)",letterSpacing:".04em"}}>{DAYS[i]}</div>
                            <div style={{fontSize:12,fontWeight:700,color:"var(--foreground)"}}>{dt.getDate()}</div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Staff rows */}
                    {activeStaff.map(member=>(
                      <div key={member.id} style={{display:"grid",gridTemplateColumns:`140px repeat(7,1fr)`,gap:2,marginBottom:2}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 2px"}}>
                          <div style={{width:22,height:22,borderRadius:"50%",background:member.color||"#6366f1",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:"#fff",flexShrink:0}}>{member.avatar}</div>
                          <span style={{fontSize:11,fontWeight:600,color:"var(--foreground)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{member.name}</span>
                        </div>
                        {weekDates.map((dt,di)=>{
                          const dk=fmtDateKey(dt);
                          const cellShifts=(shiftsByStaff[member.id]||{})[dk]||[];
                          const inM=inMonth(dt);
                          return(
                            <div key={di} style={{minHeight:42,padding:2,background:inM?"var(--background)":"hsl(220 20% 98%)",border:"1px solid var(--border)",borderRadius:5,opacity:inM?1:.45,display:"flex",flexDirection:"column",gap:2}}>
                              {cellShifts.map(s=>{
                                const loc=getLoc(s.locationId);
                                return(
                                  <div key={s.uid} style={{background:loc.bg,border:`1px solid ${loc.border}`,borderRadius:4,padding:"2px 4px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:2}}>
                                    <span style={{fontSize:9,fontWeight:700,color:loc.text,lineHeight:1.3}}>{loc.short}<br/>{s.startTime}–{s.endTime}</span>
                                    {!isApproved&&<button onClick={()=>removeProposedShift(reviewWeekIdx,s.uid)} style={{background:"none",border:"none",cursor:"pointer",color:loc.text,fontSize:11,lineHeight:1,padding:0,opacity:.7,flexShrink:0}}>×</button>}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    ))}

                    {/* Unfilled row */}
                    {hasUnfilled&&(
                      <div style={{display:"grid",gridTemplateColumns:`140px repeat(7,1fr)`,gap:2,marginTop:4}}>
                        <div style={{display:"flex",alignItems:"center",padding:"4px 2px"}}>
                          <span style={{fontSize:11,fontWeight:700,color:"var(--destructive)"}}>Unfilled</span>
                        </div>
                        {weekDates.map((dt,di)=>{
                          const dk=fmtDateKey(dt);
                          const unfSlots=unfilledByDate[dk]||[];
                          return(
                            <div key={di} style={{minHeight:42,padding:2,display:"flex",flexDirection:"column",gap:2}}>
                              {unfSlots.map(s=>{
                                const loc=getLoc(s.locationId);
                                if(assigningUid===s.uid&&!isApproved){
                                  return(
                                    <select key={s.uid} autoFocus
                                      onChange={e=>{ if(e.target.value) assignProposedShift(reviewWeekIdx,s.uid,e.target.value); else setAssigningUid(null); }}
                                      onBlur={()=>setAssigningUid(null)}
                                      style={{fontSize:10,borderRadius:4,border:"1.5px solid hsl(160 84% 39%)",padding:"2px 4px",fontFamily:"inherit",width:"100%",background:"var(--background)"}}>
                                      <option value="">— assign —</option>
                                      {staff.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
                                    </select>
                                  );
                                }
                                return(
                                  <div key={s.uid} onClick={()=>!isApproved&&setAssigningUid(s.uid)}
                                    style={{border:`1.5px dashed #ef4444`,borderRadius:4,padding:"2px 4px",cursor:isApproved?"default":"pointer",background:"#FFF5F5",display:"flex",alignItems:"center"}}>
                                    <span style={{fontSize:9,fontWeight:600,color:"#ef4444",lineHeight:1.3}}>{loc.short}<br/>{s.startTime}–{s.endTime}</span>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Warnings panel */}
                <div style={{marginBottom:16}}>
                  {week.warnings.length===0?(
                    <div style={{background:"#F0FDF4",border:"1px solid #6ee7b7",borderRadius:9,padding:"10px 14px",fontSize:12,color:"#047857",fontWeight:600}}>
                      No warnings for this week ✓
                    </div>
                  ):(
                    <div style={{background:"#FFFBEB",border:"1px solid #fde68a",borderRadius:9,padding:"12px 14px"}}>
                      <div style={{fontSize:12,fontWeight:700,color:"#92400e",marginBottom:8}}>Warnings — resolve or approve to continue</div>
                      {week.warnings.map(w=>{
                        const checked=!!weekApprovals[w.key];
                        return(
                          <label key={w.key} style={{display:"flex",alignItems:"flex-start",gap:8,cursor:"pointer",marginBottom:6,padding:"6px 8px",background:checked?"#FEF3C7":"transparent",borderRadius:6,transition:"background .1s"}}>
                            <input type="checkbox" checked={checked} onChange={e=>{
                              setWarningApprovals(prev=>({...prev,[reviewWeekIdx]:{...(prev[reviewWeekIdx]||{}),[w.key]:e.target.checked}}));
                            }} style={{marginTop:2,accentColor:"#d97706",flexShrink:0}}/>
                            <span style={{fontSize:12,color:"#92400e"}}>{w.text}</span>
                            {checked&&<span style={{fontSize:10,fontWeight:700,color:"#d97706",marginLeft:"auto",whiteSpace:"nowrap"}}>Approve anyway</span>}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Full weekends off — month summary */}
                {proposedRota.staffFullWkndOff&&(
                  <div style={{marginBottom:16,background:"var(--secondary)",border:"1px solid var(--border)",borderRadius:9,padding:"12px 14px"}}>
                    <div style={{fontSize:12,fontWeight:700,color:"var(--muted-foreground)",marginBottom:8,letterSpacing:".02em"}}>Full weekends off — {MONTH_NAMES[proposedRota.month]}</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                      {staff.map(s=>{
                        const count=proposedRota.staffFullWkndOff?.[s.id]??0;
                        const ok=count>=1;
                        return(
                          <div key={s.id} style={{fontSize:11,padding:"3px 9px",borderRadius:6,background:ok?"#F0FDF4":"#FFF5F5",border:`1px solid ${ok?"#6ee7b7":"#fca5a5"}`,color:ok?"#047857":"#dc2626",fontWeight:500,whiteSpace:"nowrap"}}>
                            {s.name} — {count} full weekend{count!==1?"s":""} off this month {ok?"✓":"⚠"}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Approve week button */}
                <button disabled={!canApprove} onClick={()=>approveWeek(reviewWeekIdx)}
                  style={{width:"100%",background:canApprove?"hsl(160 84% 39%)":isApproved?"var(--secondary)":"var(--secondary)",color:canApprove?"#fff":"var(--muted-foreground)",border:"none",borderRadius:9,padding:"13px",fontSize:14,fontFamily:"inherit",cursor:canApprove?"pointer":"default",fontWeight:700,letterSpacing:".02em",transition:"all .15s"}}>
                  {isApproved?"Week approved ✓":`Approve week ${reviewWeekIdx+1} and write to rota`}
                </button>
              </>
            )}
          </div>
        );
      })()}

      {activeTab==="planner"&&!proposedRota&&(
        <div style={{padding:"14px 18px 80px"}}>
          <h2 style={{margin:"0 0 4px",fontSize:17,fontWeight:700}}>Rota Planner</h2>
          <p style={{margin:"0 0 18px",fontSize:12,color:"var(--muted-foreground)"}}>Define shift templates for weekdays and weekends, override specific days, then generate a rota.</p>

          {/* Template sub-tabs */}
          <h3 style={{fontSize:13,fontWeight:700,margin:"0 0 10px"}}>Shift templates</h3>
          <div style={{display:"flex",gap:2,background:"hsl(220 25% 96%)",borderRadius:8,padding:3,width:"fit-content",marginBottom:14}}>
            {[["weekday","Weekday (Mon–Fri)"],["weekend","Weekend (Sat–Sun)"]].map(([k,label])=>(
              <button key={k} onClick={()=>setPlannerTemplateTab(k)}
                style={{padding:"5px 14px",borderRadius:6,border:"none",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",background:plannerTemplateTab===k?"var(--background)":"transparent",color:plannerTemplateTab===k?"var(--foreground)":"var(--muted-foreground)",boxShadow:plannerTemplateTab===k?"0 1px 3px rgba(0,0,0,.08)":"none",transition:"all .15s"}}>
                {label}
              </button>
            ))}
          </div>

          {/* Template slots */}
          {(()=>{
            const slots=plannerTemplateTab==="weekday"?planner.weekdayTemplate:planner.weekendTemplate;
            const editKey=plannerTemplateTab;
            return(
              <>
                {slots.length===0&&(
                  <div style={{fontSize:12,color:"var(--muted-foreground)",padding:"10px 0",marginBottom:6}}>No slots defined yet — add one below.</div>
                )}
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:12,marginBottom:10}}>
                  {slots.map(slot=>(
                    <PlannerSlotCard key={slot.id} slot={slot} editKey={editKey} locations={locations} jobTitles={jobTitles} onUpdate={updatePlannerSlot} onRemove={removePlannerSlot}/>
                  ))}
                </div>
                <button onClick={()=>addPlannerSlot(editKey)}
                  style={{marginBottom:28,border:"1.5px dashed var(--border)",background:"transparent",borderRadius:8,padding:"8px 18px",fontSize:12,cursor:"pointer",fontFamily:"inherit",color:"var(--muted-foreground)",fontWeight:600}}>
                  + Add slot
                </button>
              </>
            );
          })()}

          {/* Day overrides */}
          <h3 style={{fontSize:13,fontWeight:700,margin:"0 0 4px"}}>Day overrides</h3>
          <p style={{margin:"0 0 12px",fontSize:12,color:"var(--muted-foreground)"}}>Click a day to create a custom slot list and edit its slots. Use the × button on a custom day to remove the override.</p>

          {/* Month/year nav */}
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
            <button onClick={()=>{ let mo=plannerMonth-1,y=plannerYear; if(mo<0){mo=11;y--;} setPlannerMonth(mo); setPlannerYear(y); }}
              style={{background:"none",border:"1px solid var(--border)",borderRadius:6,padding:"4px 9px",cursor:"pointer",fontSize:14,lineHeight:1,color:"var(--muted-foreground)"}}>‹</button>
            <span style={{fontSize:14,fontWeight:700,minWidth:160,textAlign:"center"}}>{MONTH_NAMES[plannerMonth]} {plannerYear}</span>
            <button onClick={()=>{ let mo=plannerMonth+1,y=plannerYear; if(mo>11){mo=0;y++;} setPlannerMonth(mo); setPlannerYear(y); }}
              style={{background:"none",border:"1px solid var(--border)",borderRadius:6,padding:"4px 9px",cursor:"pointer",fontSize:14,lineHeight:1,color:"var(--muted-foreground)"}}>›</button>
          </div>

          {/* Calendar grid */}
          {(()=>{
            const cy=plannerYear, cm=plannerMonth;
            const numDays=daysInMonth(cy,cm);
            const offset=firstWeekdayMon(cy,cm);
            const padM=String(cm+1).padStart(2,"0");
            return(
              <div style={{background:"var(--background)",border:"1px solid var(--border)",borderRadius:10,overflow:"hidden",marginBottom:16}}>
                <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",borderBottom:"1px solid var(--border)",background:"var(--secondary)"}}>
                  {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d=>(
                    <div key={d} style={{textAlign:"center",fontSize:10,fontWeight:700,color:"var(--muted-foreground)",padding:"6px 0",letterSpacing:".04em"}}>{d}</div>
                  ))}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,padding:8}}>
                  {Array.from({length:offset}).map((_,i)=><div key={"e"+i}/>)}
                  {Array.from({length:numDays}).map((_,i)=>{
                    const day=i+1;
                    const dk=`${cy}-${padM}-${String(day).padStart(2,"0")}`;
                    const dow=new Date(cy,cm,day).getDay();
                    const wknd=dow===0||dow===6;
                    const hasOverride=planner.overrides[dk]!==undefined;
                    const isSelected=plannerSelectedDay===dk;
                    return(
                      <div key={dk} onClick={()=>handlePlannerDayClick(dk)}
                        style={{position:"relative",background:isSelected?"hsl(160 84% 39% / 0.12)":hasOverride?"#FFFBEB":wknd?"hsl(220 20% 97%)":"var(--background)",border:`1.5px solid ${isSelected?"hsl(160 84% 39%)":hasOverride?"#f59e0b":"var(--border)"}`,borderRadius:7,padding:"6px 5px",cursor:"pointer",minHeight:54,display:"flex",flexDirection:"column",alignItems:"center",gap:3,transition:"all .1s"}}>
                        <span style={{fontSize:11,fontWeight:isSelected||hasOverride?700:400,color:isSelected?"hsl(160 84% 25%)":hasOverride?"#92400e":wknd?"var(--muted-foreground)":"var(--foreground)"}}>{day}</span>
                        {hasOverride&&<span style={{fontSize:9,background:"#FEF3C7",color:"#d97706",border:"1px solid #fde68a",borderRadius:4,padding:"1px 4px",fontWeight:700,lineHeight:1.3}}>Custom</span>}
                        {hasOverride&&<span style={{fontSize:9,color:"var(--muted-foreground)"}}>{(planner.overrides[dk]||[]).length}s</span>}
                        {hasOverride&&(
                          <button onClick={e=>{ e.stopPropagation(); removePlannerOverride(dk); }}
                            style={{position:"absolute",top:3,right:3,width:15,height:15,background:"#ef4444",color:"#fff",border:"none",borderRadius:3,cursor:"pointer",fontSize:10,lineHeight:1,padding:0,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>×</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Override slot editor */}
          {plannerSelectedDay&&planner.overrides[plannerSelectedDay]&&(
            <div style={{marginBottom:24,background:"#FFFBEB",border:"1px solid #fde68a",borderRadius:10,padding:14}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                <div>
                  <span style={{fontSize:13,fontWeight:700}}>Override — {plannerSelectedDay}</span>
                  <span style={{marginLeft:8,fontSize:11,color:"var(--muted-foreground)"}}>Custom slots for this day</span>
                </div>
                <button onClick={()=>removePlannerOverride(plannerSelectedDay)}
                  style={{border:"1.5px solid var(--destructive)",background:"#FFF5F5",color:"var(--destructive)",borderRadius:6,padding:"4px 10px",fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>
                  Remove override
                </button>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:12,marginBottom:10}}>
                {planner.overrides[plannerSelectedDay].map(slot=>(
                  <PlannerSlotCard key={slot.id} slot={slot} editKey={plannerSelectedDay} locations={locations} jobTitles={jobTitles} onUpdate={updatePlannerSlot} onRemove={removePlannerSlot}/>
                ))}
              </div>
              {planner.overrides[plannerSelectedDay].length===0&&(
                <div style={{fontSize:12,color:"var(--muted-foreground)",marginBottom:10}}>No slots — add one below or remove the override.</div>
              )}
              <button onClick={()=>addPlannerSlot(plannerSelectedDay)}
                style={{border:"1.5px dashed #d97706",background:"transparent",borderRadius:8,padding:"8px 18px",fontSize:12,cursor:"pointer",fontFamily:"inherit",color:"#92400e",fontWeight:600}}>
                + Add slot
              </button>
            </div>
          )}

          {/* Generate button */}
          <button disabled={!hasSlots} onClick={generateRota}
            style={{width:"100%",background:hasSlots?"hsl(160 84% 39%)":"var(--secondary)",color:hasSlots?"#fff":"var(--muted-foreground)",border:"none",borderRadius:9,padding:"13px",fontSize:14,fontFamily:"inherit",cursor:hasSlots?"pointer":"default",fontWeight:700,letterSpacing:".02em",transition:"all .15s"}}>
            Generate rota for {MONTH_NAMES[plannerMonth]} {plannerYear}
          </button>
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
              {locations.map(l=>{
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
                {[
                  ["Contracted Hrs",`${staff.reduce((a,s)=>a+s.contracted*numWeeks,0)}h`],
                  ["Scheduled Hrs",`${Object.values(staffStats).reduce((a,s)=>a+s.hours,0).toFixed(1)}h`],
                  ["Est. Wages",`£${totalWageCost.toFixed(0)}`],
                  ["Avg / Person",`${(Object.values(staffStats).reduce((a,s)=>a+s.hours,0)/staff.length).toFixed(1)}h`],
                ].map(([l,v])=>(
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

          {/* Casual Hours Budget */}
          {(()=>{
            const now=new Date();
            const currentMonth=now.getMonth();
            const thisYear=now.getFullYear();
            const annualBudget=CASUAL_BUDGET_KEYS.reduce((a,k)=>a+(casualBudget[k]||0),0);
            const usedYTD=casualMonthlyHours.slice(0,currentMonth).reduce((a,v)=>a+v,0);
            const remaining=annualBudget-usedYTD;
            const monthsOver=CASUAL_BUDGET_KEYS.filter((k,i)=>i<currentMonth&&casualMonthlyHours[i]>(casualBudget[k]||0)).length;
            return(
              <>
                <h3 style={{fontSize:14,fontWeight:700,margin:"18px 0 10px"}}>Casual Hours Budget — {thisYear}</h3>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
                  {[
                    ["Annual Budget",`${annualBudget.toFixed(1)}h`,"neutral"],
                    ["Used YTD",`${usedYTD.toFixed(1)}h`,"neutral"],
                    ["Remaining",`${remaining.toFixed(1)}h`,remaining>=0?"good":"bad"],
                    ["Months Over Budget",monthsOver,monthsOver===0?"good":"bad"],
                  ].map(([lbl,val,tone])=>(
                    <div key={lbl} style={{background:tone==="good"?"hsl(160 84% 39% / 0.08)":tone==="bad"?"hsl(0 84% 39% / 0.06)":"var(--background)",border:"1px solid var(--border)",borderRadius:9,padding:"12px 14px"}}>
                      <div style={{fontSize:10,fontWeight:600,color:"var(--muted-foreground)",textTransform:"uppercase",letterSpacing:".05em",marginBottom:6}}>{lbl}</div>
                      <div style={{fontSize:20,fontWeight:700,fontFamily:"DM Mono,monospace",color:tone==="good"?"hsl(160 84% 25%)":tone==="bad"?"var(--destructive)":"var(--foreground)"}}>{val}</div>
                    </div>
                  ))}
                </div>
                <div style={{background:"var(--background)",border:"1px solid var(--border)",borderRadius:11,overflow:"hidden",marginBottom:14}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead>
                      <tr>
                        {["Month","Budget (hrs)","Actual (hrs)","Difference","Usage","Status"].map(h=>(
                          <th key={h} style={{padding:"8px 12px",textAlign:h==="Month"?"left":"center",fontSize:10,fontWeight:600,color:"var(--muted-foreground)",borderBottom:"1px solid var(--border)",background:"var(--secondary)"}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {CASUAL_BUDGET_KEYS.map((key,i)=>{
                        const budget=casualBudget[key]||0;
                        const actual=casualMonthlyHours[i];
                        const diff=actual-budget;
                        const pct=budget>0?Math.min(100,(actual/budget)*100):0;
                        const isCompleted=i<currentMonth;
                        const isOver=isCompleted&&diff>0;
                        const isNear=isCompleted&&!isOver&&actual>=budget*0.9;
                        const statusLabel=!isCompleted?"Upcoming":isOver?"Over":isNear?"Near limit":"On track";
                        const statusColor=!isCompleted?"var(--muted-foreground)":isOver?"#dc2626":isNear?"#d97706":"#16a34a";
                        const statusBg=!isCompleted?"var(--secondary)":isOver?"#FEF2F2":isNear?"#FFFBEB":"#F0FDF4";
                        const diffColor=!isCompleted?"var(--muted-foreground)":isOver?"#dc2626":isNear?"#d97706":"#16a34a";
                        return(
                          <tr key={key} style={{borderTop:"1px solid var(--border)",background:i===currentMonth?"hsl(220 100% 98%)":"inherit"}}>
                            <td style={{padding:"8px 12px",fontWeight:500}}>{MONTH_NAMES[i]}</td>
                            <td style={{padding:"8px 12px",textAlign:"center",fontFamily:"DM Mono,monospace"}}>{budget.toFixed(1)}</td>
                            <td style={{padding:"8px 12px",textAlign:"center",fontFamily:"DM Mono,monospace",color:isCompleted?"var(--foreground)":"var(--muted-foreground)"}}>{actual.toFixed(1)}</td>
                            <td style={{padding:"8px 12px",textAlign:"center",fontFamily:"DM Mono,monospace",fontWeight:600,color:diffColor}}>
                              {isCompleted?(diff>=0?"+":"")+diff.toFixed(1):"—"}
                            </td>
                            <td style={{padding:"8px 12px",textAlign:"center"}}>
                              <div style={{width:80,height:6,background:"var(--secondary)",borderRadius:3,margin:"0 auto"}}>
                                <div style={{width:`${pct}%`,height:"100%",background:isOver?"#dc2626":isNear?"#d97706":"#16a34a",borderRadius:3}}/>
                              </div>
                            </td>
                            <td style={{padding:"8px 12px",textAlign:"center"}}>
                              <span style={{background:statusBg,color:statusColor,padding:"2px 8px",borderRadius:8,fontSize:10,fontWeight:700}}>{statusLabel}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ===== SETTINGS TAB ===== */}
      {activeTab==="settings"&&(
        <div style={{padding:"14px 18px 90px"}}>
          <h2 style={{margin:"0 0 4px",fontSize:17,fontWeight:700}}>Settings</h2>
          <p style={{margin:"0 0 20px",fontSize:12,color:"var(--muted-foreground)"}}>Customise departments, locations, and shift types. Location and shift type changes apply after saving.</p>

          {/* Departments */}
          <h3 style={{fontSize:13,fontWeight:700,margin:"0 0 10px"}}>Departments</h3>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12,marginBottom:8}}>
            {departments.map((dept,i)=>(
              <div key={dept.id} style={{background:"#fff",border:"1px solid #E8EFF5",borderRadius:10,padding:14}}>
                <div style={{marginBottom:10}}>
                  <label style={FL}>Name</label>
                  <input value={dept.label} onChange={e=>renameDept(dept.id,e.target.value)} style={{...IS,fontSize:11}}/>
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <button onClick={()=>moveDept(i,-1)} disabled={i===0}
                    style={{border:"1px solid var(--border)",background:"var(--secondary)",borderRadius:5,padding:"3px 7px",fontSize:11,cursor:i===0?"default":"pointer",opacity:i===0?.35:1,fontFamily:"inherit"}}>↑</button>
                  <button onClick={()=>moveDept(i,1)} disabled={i===departments.length-1}
                    style={{border:"1px solid var(--border)",background:"var(--secondary)",borderRadius:5,padding:"3px 7px",fontSize:11,cursor:i===departments.length-1?"default":"pointer",opacity:i===departments.length-1?.35:1,fontFamily:"inherit"}}>↓</button>
                  <button onClick={()=>deleteDept(dept.id)}
                    style={{marginLeft:"auto",border:"1.5px solid var(--destructive)",background:"#FFF5F5",color:"var(--destructive)",borderRadius:5,padding:"3px 9px",fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>
                    Delete
                  </button>
                </div>
                {deptDeleteError===dept.id&&(
                  <div style={{marginTop:8,fontSize:11,color:"var(--destructive)",lineHeight:1.4}}>
                    Reassign all staff from this department before deleting.
                  </div>
                )}
              </div>
            ))}
          </div>
          <button onClick={addDept}
            style={{marginBottom:28,border:"1.5px dashed var(--border)",background:"transparent",borderRadius:8,padding:"8px 18px",fontSize:12,cursor:"pointer",fontFamily:"inherit",color:"var(--muted-foreground)",fontWeight:600}}>
            + Add Department
          </button>

          {/* Locations */}
          <h3 style={{fontSize:13,fontWeight:700,margin:"0 0 10px"}}>Locations</h3>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12,marginBottom:8}}>
            {locDraft.map((loc,i)=>{
              const orig=LOCATIONS.find(l=>l.id===loc.id);
              return(
                <div key={loc.id} style={{background:"#fff",border:"1px solid #E8EFF5",borderRadius:10,padding:14}}>
                  {/* Live preview chip */}
                  <div style={{marginBottom:10}}>
                    <div style={{display:"inline-flex",flexDirection:"column",background:loc.bg,border:`1.5px solid ${loc.border}`,borderRadius:5,padding:"4px 7px",gap:2}}>
                      <div style={{display:"flex",alignItems:"center",gap:3}}>
                        <div style={{width:6,height:6,borderRadius:"50%",background:loc.dot,flexShrink:0}}/>
                        <span style={{fontSize:9,fontWeight:700,color:loc.text}}>{loc.short||"?"}</span>
                      </div>
                      <div style={{fontSize:9,fontWeight:700,color:"#065f46",fontFamily:"DM Mono,monospace"}}>09:00–17:00</div>
                      <div style={{fontSize:8,color:loc.border}}>8.0h</div>
                    </div>
                  </div>
                  <div style={{marginBottom:8}}>
                    <label style={FL}>Name</label>
                    <input value={loc.label} onChange={e=>{
                      const label=e.target.value;
                      const d=deriveLocColors(loc.border,label);
                      setLocDraft(p=>p.map((l,j)=>j===i?{...l,label,short:d.short}:l));
                    }} style={{...IS,fontSize:11}}/>
                  </div>
                  <div style={{marginBottom:8,display:"flex",alignItems:"center",gap:8}}>
                    <label style={{...FL,margin:0}}>Colour</label>
                    <input type="color" value={loc.border} onChange={e=>{
                      const d=deriveLocColors(e.target.value,loc.label);
                      setLocDraft(p=>p.map((l,j)=>j===i?{...l,...d}:l));
                    }} style={{width:34,height:28,border:"1px solid var(--border)",borderRadius:5,cursor:"pointer",padding:2,background:"none"}}/>
                  </div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:6}}>
                    {orig&&(
                      <button onClick={()=>setLocDraft(p=>p.map((l,j)=>j===i?JSON.parse(JSON.stringify(orig)):l))}
                        style={{background:"none",border:"none",color:"var(--muted-foreground)",fontSize:11,cursor:"pointer",textDecoration:"underline",padding:0}}>
                        reset to default
                      </button>
                    )}
                    <button onClick={()=>setLocDraft(p=>p.filter((_,j)=>j!==i))}
                      style={{marginLeft:"auto",border:"1.5px solid var(--destructive)",background:"#FFF5F5",color:"var(--destructive)",borderRadius:5,padding:"3px 9px",fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <button onClick={addLocation}
            style={{marginBottom:28,border:"1.5px dashed var(--border)",background:"transparent",borderRadius:8,padding:"8px 18px",fontSize:12,cursor:"pointer",fontFamily:"inherit",color:"var(--muted-foreground)",fontWeight:600}}>
            + Add Location
          </button>

          {/* Shift Types */}
          <h3 style={{fontSize:13,fontWeight:700,margin:"0 0 10px"}}>Shift Types</h3>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12,marginBottom:8}}>
            {stDraft.map((st,i)=>{
              const orig=SHIFT_TYPES.find(t=>t.idx===st.idx);
              return(
                <div key={st.idx} style={{background:"#fff",border:"1px solid #E8EFF5",borderRadius:10,padding:14}}>
                  {/* Live preview */}
                  <div style={{marginBottom:10,display:"flex",flexDirection:"column",gap:5}}>
                    <span style={{display:"inline-block",background:st.bg,border:`2px solid ${st.border}`,borderRadius:6,padding:"3px 9px",fontSize:10,color:st.text,fontWeight:700,alignSelf:"flex-start"}}>
                      {st.label||"…"}
                    </span>
                    <span style={{fontSize:9,fontWeight:700,color:st.text,fontFamily:"DM Mono,monospace"}}>09:00–17:00</span>
                  </div>
                  <div style={{marginBottom:8}}>
                    <label style={FL}>Name</label>
                    <input value={st.label} onChange={e=>setStDraft(p=>p.map((t,j)=>j===i?{...t,label:e.target.value}:t))}
                      style={{...IS,fontSize:11}}/>
                  </div>
                  <div style={{marginBottom:8,display:"flex",alignItems:"center",gap:8}}>
                    <label style={{...FL,margin:0}}>Colour</label>
                    <input type="color" value={st.border} onChange={e=>{
                      const d=deriveSTColors(e.target.value);
                      setStDraft(p=>p.map((t,j)=>j===i?{...t,...d}:t));
                    }} style={{width:34,height:28,border:"1px solid var(--border)",borderRadius:5,cursor:"pointer",padding:2,background:"none"}}/>
                  </div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:6}}>
                    {orig&&(
                      <button onClick={()=>setStDraft(p=>p.map((t,j)=>j===i?JSON.parse(JSON.stringify(orig)):t))}
                        style={{background:"none",border:"none",color:"var(--muted-foreground)",fontSize:11,cursor:"pointer",textDecoration:"underline",padding:0}}>
                        reset to default
                      </button>
                    )}
                    <button onClick={()=>setStDraft(p=>p.filter((_,j)=>j!==i))}
                      style={{marginLeft:"auto",border:"1.5px solid var(--destructive)",background:"#FFF5F5",color:"var(--destructive)",borderRadius:5,padding:"3px 9px",fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <button onClick={addShiftType}
            style={{marginBottom:28,border:"1.5px dashed var(--border)",background:"transparent",borderRadius:8,padding:"8px 18px",fontSize:12,cursor:"pointer",fontFamily:"inherit",color:"var(--muted-foreground)",fontWeight:600}}>
            + Add Shift Type
          </button>

          {/* Job Titles */}
          <h3 style={{fontSize:13,fontWeight:700,margin:"0 0 4px"}}>Job titles</h3>
          <p style={{margin:"0 0 10px",fontSize:12,color:"var(--muted-foreground)"}}>Define the job titles available across your organisation.</p>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12,marginBottom:8}}>
            {jobTitlesDraft.map((jt,i)=>(
              <div key={jt.id} style={{background:"#fff",border:"1px solid #E8EFF5",borderRadius:10,padding:14}}>
                <div style={{marginBottom:10}}>
                  <label style={FL}>Title</label>
                  <input value={jt.label} onChange={e=>setJobTitlesDraft(p=>p.map((t,j)=>j===i?{...t,label:e.target.value}:t))}
                    style={{...IS,fontSize:11}} placeholder="e.g. Head Chef"/>
                </div>
                <div style={{display:"flex",justifyContent:"flex-end"}}>
                  <button onClick={()=>setJobTitlesDraft(p=>p.filter((_,j)=>j!==i))}
                    style={{border:"1.5px solid var(--destructive)",background:"#FFF5F5",color:"var(--destructive)",borderRadius:5,padding:"3px 9px",fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button onClick={addJobTitle}
            style={{marginBottom:28,border:"1.5px dashed var(--border)",background:"transparent",borderRadius:8,padding:"8px 18px",fontSize:12,cursor:"pointer",fontFamily:"inherit",color:"var(--muted-foreground)",fontWeight:600}}>
            + Add job title
          </button>

          {/* Casual Budget */}
          <h3 style={{fontSize:13,fontWeight:700,margin:"0 0 10px"}}>Casual Budget (hours per month)</h3>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:12,marginBottom:28}}>
            {CASUAL_BUDGET_KEYS.map((key,i)=>(
              <div key={key} style={{background:"#fff",border:"1px solid #E8EFF5",borderRadius:10,padding:14}}>
                <label style={FL}>{MONTH_NAMES[i]}</label>
                <input type="number" min="0" value={casualBudgetDraft[key]??0}
                  onChange={e=>setCasualBudgetDraft(p=>({...p,[key]:Number(e.target.value)||0}))}
                  style={{...IS,fontFamily:"DM Mono,monospace"}}/>
              </div>
            ))}
          </div>

          {/* Fixed save bar */}
          <div style={{position:"fixed",bottom:0,left:0,right:0,background:"var(--background)",borderTop:"1px solid var(--border)",padding:"12px 20px",display:"flex",justifyContent:"flex-end",alignItems:"center",gap:12,zIndex:100}}>
            <span style={{fontSize:12,color:"var(--muted-foreground)"}}>Changes only apply to this browser</span>
            <button onClick={saveSettings} style={{...SB,padding:"8px 24px",fontSize:13}}>Save changes</button>
          </div>
        </div>
      )}

      {/* ===== ABSENCE CHIP MODAL ===== */}
      {absenceModal&&(()=>{
        const ac=ABSENCE_CODE_MAP[absenceModal.code];
        const member=staff.find(s=>s.id===absenceModal.staffId);
        const [y,m]=absenceModal.dateKey.split("-").map(Number);
        return(
          <Backdrop onClose={()=>setAbsenceModal(null)}>
            <ModalHead title={member?.name} sub={absenceModal.dateKey} onClose={()=>setAbsenceModal(null)}/>
            <div style={{padding:16}}>
              <div style={{display:"flex",alignItems:"center",gap:10,background:ac.color+"18",border:`1.5px solid ${ac.color}`,borderRadius:9,padding:"10px 14px",marginBottom:16}}>
                <div style={{width:32,height:32,borderRadius:6,background:ac.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:700,color:"#fff",flexShrink:0}}>{ac.key}</div>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:ac.color}}>{ac.label}</div>
                  <div style={{fontSize:11,color:"var(--muted-foreground)"}}>Absence recorded for this day</div>
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <button onClick={()=>{
                  setAbsenceModal(null);
                  setActiveTab("staff");
                  setSelectedStaffId(absenceModal.staffId);
                  setProfileTab("absences");
                  setAbsenceViewYear(y);
                  setAbsenceViewMonth(m-1);
                }}
                  style={{width:"100%",background:"var(--primary)",color:"var(--primary-foreground)",border:"none",borderRadius:7,padding:"9px",fontSize:12,fontFamily:"inherit",cursor:"pointer",fontWeight:600,textAlign:"left",paddingLeft:14}}>
                  ✏ Edit in Absences tab →
                </button>
                <button onClick={()=>{
                  setAbsenceCode(absenceModal.staffId,absenceModal.dateKey,null);
                  setAbsenceModal(null);
                  showNotif("Absence cleared");
                }}
                  style={{width:"100%",border:"1.5px solid var(--destructive)",background:"#FFF5F5",color:"var(--destructive)",borderRadius:7,padding:"9px",fontSize:12,fontFamily:"inherit",cursor:"pointer",fontWeight:600,textAlign:"left",paddingLeft:14}}>
                  ✕ Clear absence — return cell to normal
                </button>
              </div>
            </div>
          </Backdrop>
        );
      })()}

      {/* ===== SHIFT MODAL ===== */}
      {showShiftModal&&selectedCell&&(()=>{
        const member=staff.find(s=>s.id===selectedCell.staffId);
        const dayDate=allDays.find(d=>d.weekIdx===selectedCell.weekIdx&&d.dayIdx===selectedCell.dayIdx)?.date;
        const dk=dayDate?fmtDateKey(dayDate):null;
        return(
          <Backdrop onClose={()=>setShowShiftModal(false)}>
            <ModalHead title={member?.name} sub={`${FULL_DAYS[selectedCell.dayIdx]}${dayDate?`, ${fmtDate(dayDate,{day:"numeric",month:"short"})}`:""}`} onClose={()=>setShowShiftModal(false)}/>
            <div style={{padding:16}}>
              {/* Shift / Absence toggle */}
              <div style={{display:"flex",gap:2,background:"var(--secondary)",borderRadius:8,padding:3,marginBottom:14}}>
                {[["shift","Shift"],["absence","Absence"]].map(([k,label])=>(
                  <button key={k} onClick={()=>{setShiftModalTab(k);setOverHoursWarning(null);}}
                    style={{flex:1,border:"none",padding:"5px",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",background:shiftModalTab===k?"var(--background)":"transparent",color:shiftModalTab===k?"var(--foreground)":"var(--muted-foreground)",boxShadow:shiftModalTab===k?"0 1px 3px rgba(0,0,0,.08)":"none",transition:"all .15s"}}>
                    {label}
                  </button>
                ))}
              </div>

              {shiftModalTab==="shift"?(
                <>
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
                      {locations.map(l=>(
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
                      {shiftTypes.map(t=>(
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
                  {overHoursWarning&&(
                    <div style={{background:"#FFF3CD",border:"1px solid var(--warning)",borderRadius:7,padding:"9px 11px",marginTop:9}}>
                      <div style={{fontSize:11,fontWeight:700,color:"#92400e",marginBottom:7}}>
                        ⚠ This puts {overHoursWarning.name} {overHoursWarning.overBy.toFixed(1)}h over contracted hours for this period.
                      </div>
                      <div style={{display:"flex",gap:7}}>
                        <button onClick={()=>setOverHoursWarning(null)}
                          style={{flex:1,border:"1.5px solid var(--border)",background:"var(--background)",borderRadius:7,padding:"6px",fontSize:11,fontFamily:"inherit",cursor:"pointer",fontWeight:600}}>
                          Cancel
                        </button>
                        <button onClick={saveShift}
                          style={{flex:1,background:"#d97706",color:"#fff",border:"none",borderRadius:7,padding:"6px",fontSize:11,fontFamily:"inherit",cursor:"pointer",fontWeight:700}}>
                          Save Anyway
                        </button>
                      </div>
                    </div>
                  )}
                  {casualBudgetWarning&&(
                    <div style={{background:"#FFF3CD",border:"1px solid var(--warning)",borderRadius:7,padding:"9px 11px",marginTop:9}}>
                      <div style={{fontSize:11,fontWeight:700,color:"#92400e",marginBottom:7}}>
                        ⚠ This puts casual hours {casualBudgetWarning.overBy.toFixed(1)}h over the monthly budget.
                      </div>
                      <div style={{display:"flex",gap:7}}>
                        <button onClick={()=>setCasualBudgetWarning(null)}
                          style={{flex:1,border:"1.5px solid var(--border)",background:"var(--background)",borderRadius:7,padding:"6px",fontSize:11,fontFamily:"inherit",cursor:"pointer",fontWeight:600}}>
                          Cancel
                        </button>
                        <button onClick={saveShift}
                          style={{flex:1,background:"#d97706",color:"#fff",border:"none",borderRadius:7,padding:"6px",fontSize:11,fontFamily:"inherit",cursor:"pointer",fontWeight:700}}>
                          Save Anyway
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ):(
                <>
                  <label style={{...FL,marginBottom:8}}>Select absence type</label>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:14}}>
                    {ABSENCE_CODES.map(c=>(
                      <button key={c.key} onClick={()=>setAbsencePickerCode(c.key)}
                        style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:7,border:`2px solid ${absencePickerCode===c.key?c.color:"var(--border)"}`,background:absencePickerCode===c.key?c.color+"18":"var(--background)",cursor:"pointer",fontFamily:"inherit",transition:"all .12s"}}>
                        <div style={{width:10,height:10,borderRadius:"50%",background:c.color,flexShrink:0}}/>
                        <div style={{textAlign:"left"}}>
                          <div style={{fontSize:11,fontWeight:700,color:absencePickerCode===c.key?c.color:"var(--foreground)"}}>{c.key}</div>
                          <div style={{fontSize:9,color:"var(--muted-foreground)",lineHeight:1.2}}>{c.label}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                  <button onClick={()=>{
                    if(!dk) return;
                    setAbsenceCode(selectedCell.staffId,dk,absencePickerCode);
                    setShowShiftModal(false);
                    showNotif("Absence recorded ✓");
                  }}
                    style={{width:"100%",background:ABSENCE_CODE_MAP[absencePickerCode]?.color||"var(--primary)",color:"#fff",border:"none",borderRadius:7,padding:"9px",fontSize:12,fontFamily:"inherit",cursor:"pointer",fontWeight:700}}>
                    Record {ABSENCE_CODE_MAP[absencePickerCode]?.label} for {dayDate?fmtDate(dayDate,{day:"numeric",month:"short"}):"this day"}
                  </button>
                </>
              )}
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
            <div style={{marginBottom:11}}>
              <label style={FL}>Role</label>
              <select value={newStaff.role} onChange={e=>setNewStaff(p=>({...p,role:e.target.value}))} style={IS}>
                {jobTitles.map(jt=><option key={jt.id} value={jt.label}>{jt.label}</option>)}
              </select>
            </div>
            <div style={{marginBottom:14}}>
              <label style={FL}>Department</label>
              <select value={newStaff.department||departments[0]?.id||""} onChange={e=>setNewStaff(p=>({...p,department:e.target.value}))} style={IS}>
                {departments.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}
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
                  {s.email?<span style={{fontSize:10,color:"var(--primary)",fontWeight:600}}>✓</span>:<span style={{fontSize:10,color:"var(--muted-foreground)"}}>Skip</span>}
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

function AutoGrowTextarea({ value, onChange }) {
  const ref = useRef(null);
  useEffect(()=>{
    if(ref.current){ ref.current.style.height="auto"; ref.current.style.height=ref.current.scrollHeight+"px"; }
  },[value]);
  return(
    <textarea ref={ref} rows={1} value={value} onChange={e=>onChange(e.target.value)}
      placeholder="—" className="agta"/>
  );
}

function Backdrop({ children, onClose }) {
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,animation:"fUp .15s ease"}}
      onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={{background:"var(--background)",borderRadius:13,width:410,maxWidth:"95vw",maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.25)"}}>
        {children}
      </div>
    </div>
  );
}

function ModalHead({ title, sub, onClose }) {
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

function PlannerSlotCard({ slot, editKey, locations, jobTitles, onUpdate, onRemove }) {
  return(
    <div style={{background:"var(--background)",border:"1px solid var(--border)",borderRadius:10,padding:14,position:"relative"}}>
      <button onClick={()=>onRemove(editKey,slot.id)}
        style={{position:"absolute",top:10,right:10,background:"none",border:"none",cursor:"pointer",fontSize:16,color:"var(--muted-foreground)",lineHeight:1,padding:0}}>×</button>

      <div style={{display:"grid",gridTemplateColumns:"1fr 80px",gap:9,marginBottom:9}}>
        <div>
          <label style={FL}>Location</label>
          <select value={slot.locationId} onChange={e=>onUpdate(editKey,slot.id,{locationId:e.target.value})} style={IS}>
            {locations.map(l=><option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </div>
        <div>
          <label style={FL}>Staff needed</label>
          <input type="number" min="1" value={slot.staffCount}
            onChange={e=>onUpdate(editKey,slot.id,{staffCount:Math.max(1,parseInt(e.target.value)||1)})}
            style={{...IS,fontFamily:"DM Mono,monospace"}}/>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:10}}>
        {[["Start time","startTime"],["End time","endTime"]].map(([lbl,f])=>(
          <div key={f}>
            <label style={FL}>{lbl}</label>
            <select value={slot[f]} onChange={e=>onUpdate(editKey,slot.id,{[f]:e.target.value})} style={IS}>
              {HALF_HOURS.map(h=><option key={h}>{h}</option>)}
            </select>
          </div>
        ))}
      </div>

      <div>
        <label style={FL}>Allowed job titles</label>
        <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:4}}>
          {jobTitles.length===0&&<span style={{fontSize:11,color:"var(--muted-foreground)"}}>No job titles defined yet</span>}
          {jobTitles.map(jt=>{
            const active=(slot.allowedJobTitles||[]).includes(jt.id);
            return(
              <button key={jt.id}
                onClick={()=>{
                  const cur=slot.allowedJobTitles||[];
                  onUpdate(editKey,slot.id,{allowedJobTitles:active?cur.filter(id=>id!==jt.id):[...cur,jt.id]});
                }}
                style={{padding:"3px 9px",borderRadius:6,border:`1.5px solid ${active?"hsl(160 84% 39%)":"var(--border)"}`,background:active?"hsl(160 84% 39% / 0.08)":"var(--background)",color:active?"hsl(160 84% 25%)":"var(--muted-foreground)",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:600,transition:"all .12s"}}>
                {jt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const NB={width:26,height:26,border:"1px solid var(--border)",borderRadius:6,background:"var(--background)",cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit"};
const SEL={border:"1px solid var(--border)",borderRadius:6,padding:"5px 8px",fontSize:11,fontFamily:"inherit",background:"var(--background)",cursor:"pointer"};
const OB={border:"1px solid var(--border)",borderRadius:6,background:"var(--background)",padding:"5px 10px",fontSize:11,fontFamily:"inherit",cursor:"pointer",fontWeight:500,color:"var(--muted-foreground)"};
const SB={background:"var(--primary)",color:"var(--primary-foreground)",border:"none",borderRadius:6,padding:"6px 13px",fontSize:11,fontFamily:"inherit",cursor:"pointer",fontWeight:600};
const FL={fontSize:10,fontWeight:600,color:"var(--muted-foreground)",display:"block",marginBottom:3};
const IS={width:"100%",border:"1.5px solid var(--border)",borderRadius:7,padding:"7px 9px",fontSize:12,fontFamily:"inherit",background:"var(--background)",boxSizing:"border-box"};
