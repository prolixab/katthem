import {isAdmin} from './roles.mjs';
export function scheduleRange(params){
 const start=params.get('start'),end=params.get('end');
 const valid=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
 if(!valid(start)||!valid(end)||end<start||(Date.parse(end)-Date.parse(start))/86400000>30)throw Object.assign(Error('Välj ett giltigt datumintervall på högst 31 dagar.'),{status:400});
 return {start,end};
}
// Include own bookings outside the visible range so reminders and My bookings stay complete.
export function scheduleData(db,user,greenIds,range=null){
 const condition=range?'WHERE (s.date BETWEEN ? AND ? OR EXISTS(SELECT 1 FROM bookings own WHERE own.slot_id=s.id AND own.user_id=?))':'',args=range?[range.start,range.end,user.id]:[];
 const slots=db.prepare('SELECT s.*,EXISTS(SELECT 1 FROM volunteer_meeting_origins v WHERE v.slot_id=s.id) volunteer_meeting,2 minimum_staff,(SELECT COUNT(*) FROM bookings b WHERE b.slot_id=s.id) booked,(SELECT COUNT(*) FROM bookings b WHERE b.slot_id=s.id AND user_id=?) mine FROM slots s '+condition+' ORDER BY s.date,s.start,s.id').all(user.id,...args);
 const bookings=isAdmin(user)?db.prepare('SELECT b.*,u.name,u.email FROM bookings b JOIN users u ON u.id=b.user_id JOIN slots s ON s.id=b.slot_id '+condition).all(...args):db.prepare('SELECT * FROM bookings WHERE user_id=?').all(user.id);
 const greenCounts=new Map();
 for(const b of db.prepare('SELECT b.user_id,b.slot_id FROM bookings b JOIN slots s ON s.id=b.slot_id '+condition).all(...args))if(greenIds.has(b.user_id))greenCounts.set(b.slot_id,(greenCounts.get(b.slot_id)||0)+1);
 return {slots:slots.map(s=>({...s,green_booked:greenCounts.get(s.id)||0})),bookings};
}
