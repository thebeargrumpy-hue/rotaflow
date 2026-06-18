export function timeToMins(t){ if(!t)return 0; const[h,m]=t.split(":").map(Number); return h*60+m; }
export function calcHours(s,e,b=0){ let d=timeToMins(e)-timeToMins(s); if(d<0)d+=1440; return Math.max(0,(d-b)/60); }
export function getMondayOf(date){ const d=new Date(date),day=d.getDay(); d.setDate(d.getDate()-day+(day===0?-6:1)); d.setHours(0,0,0,0); return d; }
export function addDays(date,n){ const d=new Date(date); d.setDate(d.getDate()+n); return d; }
export function fmtDate(d,opts){ return d.toLocaleDateString("en-GB",opts); }
export function isWeekend(di){ return di===5||di===6; }
