export function createBookingSettings(db){
 db.exec('CREATE TABLE IF NOT EXISTS booking_settings(id INTEGER PRIMARY KEY CHECK(id=1),recommended_limit INTEGER NOT NULL DEFAULT 5 CHECK(recommended_limit BETWEEN 2 AND 100),revision INTEGER NOT NULL DEFAULT 0);INSERT OR IGNORE INTO booking_settings(id) VALUES(1)');
 const get=()=>db.prepare('SELECT recommended_limit,revision FROM booking_settings WHERE id=1').get();
 function save(p){
  if(!p||!Number.isInteger(p.recommended_limit)||p.recommended_limit<2||p.recommended_limit>100||!Number.isInteger(p.revision))throw Object.assign(Error('Ange ett heltal mellan 2 och 100 och öppna inställningen igen vid behov.'),{status:400});
  const result=db.prepare('UPDATE booking_settings SET recommended_limit=?,revision=revision+1 WHERE id=1 AND revision=?').run(p.recommended_limit,p.revision);
  if(!result.changes)throw Object.assign(Error('Rekommendationen har ändrats av någon annan. Uppdatera sidan innan du sparar.'),{status:409});return get();
 }
 return {get,save};
}
