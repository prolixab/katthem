export function updateShelterSettings(registry,targets,update){
 const attached=[];
 try{
  for(const [index,target] of targets.entries()){
   const schema='settings_home_'+index;
   registry.prepare('ATTACH DATABASE ? AS '+schema).run(target.path);
   attached.push({...target,schema});
  }
  if(['main',...attached.map(target=>target.schema)].some(schema=>registry.prepare('PRAGMA '+schema+'.journal_mode').get().journal_mode!=='delete')){
   throw Object.assign(Error('Gemensam sparning kräver standardläget för databasjournalerna.'),{status:409});
  }
  registry.exec('BEGIN IMMEDIATE');
  try{
   for(const target of attached)update(target);
   registry.exec('COMMIT');
  }catch(error){
   registry.exec('ROLLBACK');
   throw error;
  }
 }finally{
  for(const {schema} of attached)registry.exec('DETACH DATABASE '+schema);
 }
}
