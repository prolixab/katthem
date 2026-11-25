// Read the central booking once for the canonical identity; never count per participating home.
export function sharedEventStats(registry,home,userId,{now=Date.now(),introStartedAt=0}={}){
 const empty={completed:0,lastCompleted:null,introBookings:0};
 if(!registry?.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='shared_events'").get())return empty;
 const identity=registry.prepare('SELECT source,user_id FROM shadows WHERE target=? AND local_id=?').get(home,userId)||{source:home,user_id:userId};
 const rows=registry.prepare('SELECT e.date,e.start,e.end FROM shared_event_bookings b JOIN shared_events e ON e.id=b.event_id WHERE b.source=? AND b.user_id=? AND e.cancelled=0').all(identity.source,identity.user_id);
 for(const row of rows){const start=new Date(row.date+'T'+row.start+':00').getTime(),end=new Date(row.date+'T'+row.end+':00').getTime();if(end<=now){empty.completed++;empty.lastCompleted=Math.max(empty.lastCompleted||0,end);}if(start>=introStartedAt)empty.introBookings++;}
 return empty;
}
