export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const FULL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const HALF_HOURS = [];
for (let h = 0; h < 24; h++) {
  HALF_HOURS.push(`${String(h).padStart(2,"0")}:00`);
  HALF_HOURS.push(`${String(h).padStart(2,"0")}:30`);
}

export const LOCATIONS = [
  { id:"restaurant", label:"Restaurant",     short:"REST", bg:"#EEF2FF", border:"#6366f1", text:"#3730a3", dot:"#6366f1" },
  { id:"cafe",       label:"Visitor Café",   short:"CAFÉ", bg:"#F0FDF4", border:"#16a34a", text:"#14532d", dot:"#16a34a" },
  { id:"events",     label:"Events / Hire",  short:"EVNT", bg:"#FFF7ED", border:"#ea580c", text:"#7c2d12", dot:"#ea580c" },
  { id:"memorial",   label:"Memorial Gdn",   short:"MEMO", bg:"#F0F9FF", border:"#0284c7", text:"#0c4a6e", dot:"#0284c7" },
];

export const SHIFT_TYPES = [
  { idx:0, bg:"#ECFDF5", border:"#10b981", text:"#065f46", label:"Morning"   },
  { idx:1, bg:"#EFF6FF", border:"#3b82f6", text:"#1e3a8a", label:"Afternoon" },
  { idx:2, bg:"#FFF7ED", border:"#f97316", text:"#7c2d12", label:"Evening"   },
  { idx:3, bg:"#F5F3FF", border:"#8b5cf6", text:"#3b0764", label:"Night"     },
  { idx:4, bg:"#FFF1F2", border:"#f43f5e", text:"#881337", label:"Split"     },
];

export const ROLES = ["Chef","Sous Chef","Front of House","Bar Staff","Supervisor","Kitchen Porter","Manager"];
export const VIEW_MODES = [{ key:"1", label:"1 Week" },{ key:"2", label:"2 Weeks" },{ key:"4", label:"4 Weeks" }];
export const STAFF_COLORS = ["#6366f1","#0ea5e9","#10b981","#f59e0b","#ec4899","#8b5cf6","#14b8a6","#ef4444","#f97316","#06b6d4"];

export const WAGE_RATE = 12;

export const INITIAL_STAFF = [
  { id:1, name:"Sarah Mitchell", role:"Manager",        email:"sarah@nma.org.uk", avatar:"SM", contracted:40,   color:"#6366f1", weekendsWorked:3 },
  { id:2, name:"James Carter",   role:"Chef",           email:"james@nma.org.uk", avatar:"JC", contracted:37.5, color:"#0ea5e9", weekendsWorked:1 },
  { id:3, name:"Priya Sharma",   role:"Sous Chef",      email:"priya@nma.org.uk", avatar:"PS", contracted:37.5, color:"#10b981", weekendsWorked:4 },
  { id:4, name:"Tom Hughes",     role:"Front of House", email:"tom@nma.org.uk",   avatar:"TH", contracted:20,   color:"#f59e0b", weekendsWorked:2 },
  { id:5, name:"Lily Park",      role:"Bar Staff",      email:"lily@nma.org.uk",  avatar:"LP", contracted:25,   color:"#ec4899", weekendsWorked:5 },
  { id:6, name:"Dan Foster",     role:"Kitchen Porter", email:"dan@nma.org.uk",   avatar:"DF", contracted:30,   color:"#8b5cf6", weekendsWorked:2 },
  { id:7, name:"Emma Walsh",     role:"Supervisor",     email:"emma@nma.org.uk",  avatar:"EW", contracted:35,   color:"#14b8a6", weekendsWorked:3 },
];

export const INITIAL_SHIFTS = {
  "1-w0-d0":{ start:"08:00", end:"16:00", typeIdx:0, locationId:"restaurant", brk:30 },
  "1-w0-d1":{ start:"08:00", end:"16:00", typeIdx:0, locationId:"restaurant", brk:30 },
  "1-w0-d2":{ start:"08:00", end:"16:00", typeIdx:0, locationId:"events",     brk:30 },
  "2-w0-d0":{ start:"09:00", end:"17:00", typeIdx:1, locationId:"cafe",       brk:30 },
  "2-w0-d1":{ start:"09:00", end:"17:00", typeIdx:1, locationId:"cafe",       brk:30 },
  "2-w0-d5":{ start:"10:00", end:"18:00", typeIdx:0, locationId:"restaurant", brk:30 },
  "3-w0-d3":{ start:"12:00", end:"20:00", typeIdx:2, locationId:"events",     brk:30 },
  "4-w0-d5":{ start:"10:00", end:"22:00", typeIdx:4, locationId:"memorial",   brk:60 },
  "5-w0-d4":{ start:"14:00", end:"22:00", typeIdx:2, locationId:"cafe",       brk:30 },
  "6-w0-d6":{ start:"11:00", end:"19:00", typeIdx:1, locationId:"restaurant", brk:30 },
};

export function loadLocations() {
  const saved = localStorage.getItem("rf_locations");
  return saved ? JSON.parse(saved) : JSON.parse(JSON.stringify(LOCATIONS));
}

export function loadShiftTypes() {
  const saved = localStorage.getItem("rf_shiftTypes");
  return saved ? JSON.parse(saved) : JSON.parse(JSON.stringify(SHIFT_TYPES));
}
