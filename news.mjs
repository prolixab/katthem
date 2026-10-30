export function createNews(db){
 db.exec('CREATE TABLE IF NOT EXISTS news(id INTEGER PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,expires_at INTEGER,published INTEGER NOT NULL DEFAULT 1,revision INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS news_dismissals(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,news_id INTEGER NOT NULL REFERENCES news(id) ON DELETE CASCADE,revision INTEGER NOT NULL,PRIMARY KEY(user_id,news_id))');
 // Preserve legacy text as drafts; published news must have an expiry.
 db.prepare('UPDATE news SET published=0,revision=revision+1 WHERE published=1 AND expires_at IS NULL').run();
 const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
 const all=()=>db.prepare('SELECT * FROM news ORDER BY updated_at DESC,id DESC').all();
 const visible=(uid,now=Date.now())=>db.prepare('SELECT n.* FROM news n WHERE n.published=1 AND n.expires_at>? AND NOT EXISTS(SELECT 1 FROM news_dismissals d WHERE d.user_id=? AND d.news_id=n.id AND d.revision=n.revision) ORDER BY n.updated_at DESC,n.id DESC').all(now,uid);
 const board=(now=Date.now())=>db.prepare('SELECT * FROM news WHERE published=1 AND expires_at>? ORDER BY updated_at DESC,id DESC').all(now);
 function save(id,p,now=Date.now()){
  if(!p||typeof p.title!=='string'||!p.title.trim()||p.title.length>150||typeof p.body!=='string'||!p.body.trim()||p.body.length>4000||typeof p.published!=='boolean')fail('Ange rubrik, text och om nyheten ska publiceras.');
  if(p.published&&(!Number.isSafeInteger(p.expires_at)||p.expires_at<=now))fail('Välj visningstid och en sluttid i framtiden innan du publicerar.');
  if(p.expires_at!==null&&!Number.isSafeInteger(p.expires_at))fail('Ange en giltig sluttid.');
  if(id===null)return Number(db.prepare('INSERT INTO news(title,body,expires_at,published,updated_at) VALUES(?,?,?,?,?)').run(p.title.trim(),p.body.trim(),p.expires_at,Number(p.published),now).lastInsertRowid);
  if(!db.prepare('SELECT id FROM news WHERE id=?').get(id))fail('Nyheten finns inte.',404);
  if(!Number.isInteger(p.revision))fail('Öppna nyheten igen.');
  const result=db.prepare('UPDATE news SET title=?,body=?,expires_at=?,published=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?').run(p.title.trim(),p.body.trim(),p.expires_at,Number(p.published),now,id,p.revision);
  if(!result.changes)fail('Nyheten har ändrats. Öppna den igen innan du sparar.',409);return id;
 }
 function dismiss(uid,id,revision,now=Date.now()){
  const item=db.prepare('SELECT * FROM news WHERE id=? AND published=1 AND expires_at>?').get(id,now);if(!item)fail('Nyheten visas inte längre.',404);
  if(!Number.isInteger(revision)||revision!==item.revision)fail('Nyheten har uppdaterats. Läs den nya versionen.',409);
  db.prepare('INSERT INTO news_dismissals(user_id,news_id,revision) VALUES(?,?,?) ON CONFLICT(user_id,news_id) DO UPDATE SET revision=excluded.revision').run(uid,id,revision);
 }
 function remove(id,revision){
  if(!Number.isInteger(revision))fail('Öppna nyheten igen.');
  const item=db.prepare('SELECT revision FROM news WHERE id=?').get(id);
  if(!item)fail('Nyheten finns inte.',404);
  if(item.revision!==revision)fail('Nyheten har ändrats. Öppna den igen innan du raderar.',409);
  db.exec('BEGIN IMMEDIATE');
  try{const result=db.prepare('DELETE FROM news WHERE id=? AND revision=?').run(id,revision);if(!result.changes)fail('Nyheten har ändrats. Öppna den igen.',409);db.prepare('DELETE FROM news_dismissals WHERE news_id=?').run(id);db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}
 }
 return {all,visible,board,save,dismiss,remove};
}
