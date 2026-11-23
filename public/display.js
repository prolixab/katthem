const home=new URLSearchParams(location.search).get('shelter')||'',key=location.hash.slice(1),schedule=document.getElementById('schedule'),status=document.getElementById('status');
let pending=false,lastSuccess=0,checkinBusy=false,activePass='',activeChoices='',deviceApproved=false,registrationStarted=false,qrTimer=null,registrationVisible=false;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dayLabel=date=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',weekday:'long',day:'numeric',month:'short'}).format(new Date(date+'T12:00:00Z'));
function closeCheckin(){const dialog=document.getElementById('checkin-dialog');if(dialog?.open){dialog.close();dialog.replaceChildren()}activePass='';activeChoices=''}
function checkinControl(data,day,slot){
 if(!data.checkin||slot.cancelled)return '';
 if(day.date!==data.today)return '<button class="future-checkin" disabled>Bekräftas på dagen</button>';
 return `<button class="pass-checkin" data-checkin-pass="${esc(slot.key)}">Jag är här</button>`;
}
function checkinFormMarkup(options,slot){return `<h2 id="checkin-title">Jag är här</h2><p><strong>${esc(slot.title)}</strong> ${esc(slot.start)}–${esc(slot.end)}</p><p>Välj ditt namn. Frivillig bekräftelse, utan tidsmätning. Bara senaste bekräftelsedatumet sparas i din profil.</p>${options.length?`<form id="checkin-form"><label>Mitt namn<select id="checkin-choice" required><option value="">Välj…</option>${options.map(option=>`<option value="${esc(option.choice)}">${esc(option.label)}</option>`).join('')}</select></label><button type="submit">Bekräfta att jag är här</button></form>`:'<p>Inga bokningar går att välja på detta pass.</p>'}<p class="small">Spontan insats eller saknas ditt namn? Använd QR-koden.</p><button id="close-checkin" type="button">Stäng</button>`}
function checkinMessage(text){const message=document.getElementById('checkin-message');message.textContent=text;message.hidden=false;setTimeout(()=>{message.hidden=true},9000)}
function openCheckin(data,slot){
 const options=data.checkin.options.filter(option=>option.pass_key===slot.key),dialog=document.getElementById('checkin-dialog');activePass=slot.key;activeChoices=JSON.stringify(options);dialog.innerHTML=checkinFormMarkup(options,slot);dialog.showModal();document.getElementById('close-checkin').onclick=closeCheckin;
 const form=document.getElementById('checkin-form');if(!form)return;
 form.onsubmit=async event=>{event.preventDefault();if(checkinBusy)return;const choice=document.getElementById('checkin-choice').value;if(!choice)return;checkinBusy=true;const button=form.querySelector('button');button.disabled=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{const response=await fetch('/api/display/confirm?shelter='+encodeURIComponent(home),{method:'POST',headers:{'Content-Type':'application/json','X-Display-Key':key},credentials:'same-origin',cache:'no-store',body:JSON.stringify({choice}),signal:controller.signal});const result=await response.json();if(!response.ok)throw Error(result.error||'Bekräftelsen kunde inte sparas.');closeCheckin();checkinMessage('Tack! Din bekräftelse är sparad för idag.');}
  catch(error){checkinMessage(error.name==='AbortError'?'Svaret dröjer. Du kan försöka igen utan att skapa en dubbel bekräftelse.':error.message);closeCheckin();}
  finally{clearTimeout(timer);checkinBusy=false;if(button.isConnected)button.disabled=false;void refresh()}
 };
}
let scheduleSignature=null,latestSchedule=null;
function bindCheckin(){
 schedule.querySelectorAll('[data-checkin-pass]').forEach(button=>button.onclick=()=>{
  const data=latestSchedule;
  if(!data?.checkin)return;
  const slot=data.days[0].slots.find(s=>s.key===button.dataset.checkinPass);
  if(slot)openCheckin(data,slot);
 });
}
function clearSchedule(){
 schedule.replaceChildren();
 scheduleSignature=null;
 latestSchedule=null;
}
function clearPresence(){if(qrTimer)clearTimeout(qrTimer);qrTimer=null;const panel=document.getElementById('presence');panel.hidden=true;panel.replaceChildren();closeCheckin()}
let profileRevision=null;
function applyDisplayBranding(branding){
 const logo=document.getElementById('display-logo');
 const colors={'--primary':branding?.primary,'--background':branding?.background,'--ink':branding?.text,'--accent':branding?.accent,'--on-primary':branding?.on_primary};
 const style=document.documentElement.style;
 for(const [property,color] of Object.entries(colors)){
  if(color)style.setProperty(property,color);
  else style.removeProperty(property);
 }
 if(branding?.logo)logo.src=branding.logo;
 else logo.removeAttribute('src');
 logo.hidden=!branding?.logo;
 profileRevision=branding?.revision??null;
}
function render(data){
 if(checkinBusy)return;
 if(data.branding)applyDisplayBranding(data.branding);
 const dialog=document.getElementById('checkin-dialog');if(dialog?.open&&(!data.checkin||!data.days[0].slots.some(slot=>slot.key===activePass)||JSON.stringify(data.checkin.options.filter(option=>option.pass_key===activePass))!==activeChoices))closeCheckin();
 const panel=document.getElementById('presence');panel.hidden=!data.presence;if(qrTimer)clearTimeout(qrTimer);if(data.presence){qrTimer=setTimeout(()=>{panel.hidden=true;panel.replaceChildren();void refresh()},Math.max(1,data.presence.remaining_ms));panel.innerHTML=`<img src="${esc(data.presence.png)}" alt="QR-kod till frivillig närvarobekräftelse"><div><h2>Incheckning</h2><strong>Jag är här och hjälper till</strong><p>Skanna den aktuella koden och logga in på mobilen. Koden byts varje minut.</p><p>Frivilligt. Inga arbetstider eller frånvarolistor.</p><a href="${esc(data.presence.link)}" target="_blank" rel="noopener noreferrer">Öppna incheckning</a></div>`}else panel.replaceChildren();
 document.getElementById('shelter').textContent=data.shelter_name;document.getElementById('period').textContent=dayLabel(data.days[0].date)+' – '+dayLabel(data.days[6].date);
 const signature=JSON.stringify([data.today,data.show_names,Boolean(data.checkin),data.days]);
 latestSchedule=data;
 if(signature!==scheduleSignature){
  schedule.innerHTML=data.days.map((day,i)=>`<section class="day ${day.date===data.today?'today':''} ${i&&day.week&&(day.week.number!==data.days[i-1].week?.number||day.week.year!==data.days[i-1].week?.year)?'week-start':''}"><p class="week-number">${day.week?'Vecka '+esc(day.week.number):''}</p><h2>${esc(dayLabel(day.date))}${day.date===data.today?' <span>Idag</span>':''}</h2>${day.slots.length?day.slots.map(slot=>`<article class="slot ${slot.cancelled?'cancelled':slot.booked<2?'needs-more':''}"><p class="time">${esc(slot.start)}–${esc(slot.end)}</p><h3>${esc(slot.title).replace(/Eftermiddagspass/g,'Eftermiddags&shy;pass').replace(/Socialiseringsgruppen/g,'Socialiserings&shy;gruppen')}</h3><p>${slot.cancelled?'Inställt':esc(slot.booked)+' bokade'+(slot.booked<2?' · Behöver fler':'')}</p>${data.show_names&&!slot.cancelled?`<ul>${slot.names.map(name=>`<li>${esc(name)}</li>`).join('')}</ul>`:''}${checkinControl(data,day,slot)}</article>`).join(''):'<p>Inga pass</p>'}</section>`).join('');
  if(data.checkin)bindCheckin();
  scheduleSignature=signature;
 }
 document.getElementById('updated').textContent='Uppdaterat '+new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',hour:'2-digit',minute:'2-digit'}).format(new Date());
}
async function registerDevice(){
 const panel=document.getElementById('registration');registrationStarted=true;try{const response=await fetch('/api/display/enroll?shelter='+encodeURIComponent(home),{method:'POST',headers:{'Content-Type':'application/json','X-Display-Key':key},credentials:'same-origin',cache:'no-store',body:'{}'}),data=await response.json();if(!response.ok)throw Error(data.error||'Registreringen kunde inte startas.');deviceApproved=data.approved;panel.hidden=data.approved;if(!data.approved){panel.innerHTML=`<h2>Godkänn den här visningsdatorn</h2><p>Be superadmin öppna Administration → Visningsskärm för schemat och godkänna denna kod:</p><p class="pairing-code">${esc(data.pairing_code)}</p><p>Koden gäller i tio minuter. Kontrollera att koden är samma på den dator som ska stå på katthemmet. Ingen schemainformation visas före godkännandet.</p><button id="renew-pairing">Hämta ny registreringskod</button>`;document.getElementById('renew-pairing').onclick=async()=>{await registerDevice();void refresh()}}return true}catch(error){panel.hidden=false;panel.textContent=error.message;status.textContent=error.message;return false}
}
async function refresh(){if(pending||checkinBusy)return;if(!home||! /^[a-f0-9]{64}$/.test(key)){status.textContent='Öppna den fullständiga visningslänken från en admin.';return}pending=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{const response=await fetch('/api/display?shelter='+encodeURIComponent(home)+(profileRevision===null?'':'&profile='+profileRevision)+(latestSchedule?.schedule_revision?'&schedule_revision='+encodeURIComponent(latestSchedule.schedule_revision):''),{headers:{'X-Display-Key':key},credentials:'same-origin',cache:'no-store',signal:controller.signal});if([401,403,404].includes(response.status)){clearSchedule();clearPresence();if(profileRevision!==null)applyDisplayBranding(null);lastSuccess=0;const error=await response.json();if(error.code==='DEVICE_REQUIRED'){if(!registrationStarted||deviceApproved){deviceApproved=false;await registerDevice()}status.textContent='Väntar på att superadmin godkänner den här webbläsaren.';return}document.getElementById('registration').hidden=true;throw Error(error.error||'Visningslänken är ogiltig eller återkallad. Be en admin om en ny länk.')}if(!response.ok)throw Error('Schemat kan inte hämtas just nu.');const data=await response.json();if(!data.days){
  if(!latestSchedule||!data.schedule_revision||data.schedule_revision!==latestSchedule.schedule_revision)throw Error('Schemat kan inte hämtas just nu.');
  data.days=latestSchedule.days;
 }deviceApproved=Boolean(data.device_registered);document.getElementById('registration').hidden=deviceApproved||!data.security_enabled&&!registrationVisible;document.getElementById('register-device').hidden=deviceApproved||data.security_enabled;render(data);lastSuccess=Date.now();status.textContent=data.presence?'Uppdateras automatiskt. QR-koden byts varje minut.':'Uppdateras automatiskt.';status.className='';}
 catch(error){if(!lastSuccess||Date.now()-lastSuccess>=120000){clearSchedule();clearPresence();if(profileRevision!==null)applyDisplayBranding(null);document.getElementById('updated').textContent='';document.getElementById('shelter').textContent='Veckoschema';document.getElementById('period').textContent='';status.textContent=lastSuccess?'Schemat är dolt eftersom uppdateringen har uteblivit. Kontrollerar anslutningen automatiskt.':error.message}else status.textContent='Anslutningen är bruten. Visar senast hämtade schema och försöker igen.';status.className='error';}
 finally{clearTimeout(timer);pending=false}
}
document.getElementById('register-device').onclick=async()=>{registrationVisible=true;await registerDevice();void refresh()};
document.getElementById('fullscreen').onclick=()=>{if(document.fullscreenElement)void document.exitFullscreen();else void document.documentElement.requestFullscreen().catch(()=>{status.textContent='Helskärm stöds inte i den här webbläsaren.'})};
void refresh();setInterval(()=>void refresh(),5000);
