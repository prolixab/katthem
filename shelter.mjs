export function resolveShelter(station,location,door){
 const normalized=String(station||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
 const recognized=!normalized||/(^|[^a-z])(huskvarna|jonkoping)(?=$|[^a-z])/.test(normalized);
 return recognized?{name:'Katthemmet i Huskvarna',location,door,configured:true}:{name:String(station).trim(),location:'',door:{code:'',revision:0,updated_at:null},configured:false};
}
