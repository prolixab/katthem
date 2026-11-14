export function createAudit(db,{now=()=>Date.now()}={}){
 db.exec('CREATE TABLE IF NOT EXISTS admin_audit(id INTEGER PRIMARY KEY,created_at INTEGER NOT NULL,home TEXT NOT NULL,actor_home TEXT NOT NULL,actor_id INTEGER NOT NULL,action TEXT NOT NULL,subject_id INTEGER,details TEXT NOT NULL);CREATE INDEX IF NOT EXISTS admin_audit_home_time ON admin_audit(home,created_at)');
 function record({home,actor,action,subject_id=null,details={}}){db.prepare('INSERT INTO admin_audit(created_at,home,actor_home,actor_id,action,subject_id,details) VALUES(?,?,?,?,?,?,?)').run(now(),home,actor.source,actor.user_id,action,subject_id,JSON.stringify(details))}
 const list=home=>db.prepare('SELECT * FROM admin_audit WHERE home=? ORDER BY id DESC LIMIT 100').all(home).map(r=>({...r,details:JSON.parse(r.details)}));
 function fromRequest(route,method,p={}){
  if(route==='/api/checklist/template'&&method==='PUT')return {action:'checklist.updated',details:{applies_to:p.applies_to}};
  if(route==='/api/presence/settings'&&method==='PUT')return {action:p.enabled?'module.presence.enabled':'module.presence.disabled',details:{}};
  if(route==='/api/booking-settings'&&method==='PUT')return {action:'booking.recommendation',details:{recommended_limit:p.recommended_limit}};
  const profileIntro=route.match(/^\/api\/engagements\/(\d+)\/introduction-status$/);if(profileIntro&&method==='PATCH')return {action:p.completed?'introduction.approved':'introduction.review',subject_id:Number(profileIntro[1]),details:{}};
  const intro=route.match(/^\/api\/engagements\/(\d+)\/introduction$/);if(intro&&method==='PATCH')return {action:p.independent_approved?'introduction.approved':'introduction.updated',subject_id:Number(intro[1]),details:{practical_completed:Boolean(p.practical_completed),independent_approved:Boolean(p.independent_approved)}};
  const slot=route.match(/^\/api\/slots\/(\d+)$/);if(slot&&['PATCH','DELETE'].includes(method))return {action:method==='DELETE'||p.cancelled===true?'slot.cancelled':'slot.updated',subject_id:Number(slot[1]),details:{}};
  if(route==='/api/shift-routines'&&method==='PUT')return {action:'shift_routines.updated',details:{}};
  if(route==='/api/routines'&&method==='PUT')return {action:'routines.published',details:{}};
  return null;
 }
 function prune(){db.prepare('DELETE FROM admin_audit WHERE created_at<?').run(now()-90*86400000)}
 return {record,list,fromRequest,prune};
}
