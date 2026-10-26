const escape=value=>String(value??'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
// Fold by UTF-8 bytes, without splitting a Unicode character (RFC 5545).
function fold(line){let result='',size=0;for(const char of line){const bytes=Buffer.byteLength(char);if(size+bytes>75){result+='\r\n ';size=1}result+=char;size+=bytes}return result}
export function calendarEvent(slot,{appUrl,location='',now=new Date()}={}){
 const tasks=['Storstäda köket och se över karantänen.','Storstäda rum 1 och 2.','Storstäda rum 4 och 5.','Storstäda entrén, tvättrum/toalett och städskrubbar.','Storstäda kontoret, valvet, gången genom katthemmet samt omklädningsrum.','Storstäda rum 6.','Storstäda rum 3 och 7.'];
 const cleaning=tasks[new Date(slot.date+'T12:00:00Z').getUTCDay()];
 const stamp=now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 const local=time=>slot.date.replaceAll('-','')+'T'+time.replace(':','')+'00';
 return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Katthemmet//Volontärportalen//SV','CALSCALE:GREGORIAN','BEGIN:VTIMEZONE','TZID:Europe/Stockholm','BEGIN:DAYLIGHT','DTSTART:19700329T020000','TZOFFSETFROM:+0100','TZOFFSETTO:+0200','RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU','END:DAYLIGHT','BEGIN:STANDARD','DTSTART:19701025T030000','TZOFFSETFROM:+0200','TZOFFSETTO:+0100','RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU','END:STANDARD','END:VTIMEZONE','BEGIN:VEVENT',`UID:katthem-slot-${slot.id}@${new URL(appUrl).hostname}`,`DTSTAMP:${stamp}`,`DTSTART;TZID=Europe/Stockholm:${local(slot.start)}`,`DTEND;TZID=Europe/Stockholm:${local(slot.end)}`,`SUMMARY:${escape('Katthemmet - '+slot.title)}`,`LOCATION:${escape(location)}`,`DESCRIPTION:${escape([slot.note,slot.extra_info,'Dagens städning: '+cleaning,'Alla dagar: Se över om något behöver städas. Töm återvinningen.','Aktuell bokning: '+appUrl].filter(Boolean).join('\n'))}`,`URL:${appUrl}`,'STATUS:CONFIRMED','BEGIN:VALARM','ACTION:DISPLAY','TRIGGER:-PT12H',`DESCRIPTION:${escape('Om 12 timmar är det dags för ditt pass på Katthemmet: '+slot.title)}`,'END:VALARM','END:VEVENT','END:VCALENDAR'].map(fold).join('\r\n')+'\r\n';
}

export function calendarEvents(slots,options){
 if(!slots.length){const empty=calendarEvent({id:0,date:'2000-01-01',start:'00:00',end:'00:01',title:''},options);return empty.slice(0,empty.indexOf('BEGIN:VEVENT'))+'END:VCALENDAR\r\n'}
 const calendars=slots.map(slot=>calendarEvent(slot,options));
 const header=calendars[0].slice(0,calendars[0].indexOf('BEGIN:VEVENT'));
 return header+calendars.map(ics=>ics.slice(ics.indexOf('BEGIN:VEVENT'),ics.indexOf('END:VCALENDAR'))).join('')+'END:VCALENDAR\r\n';
}
