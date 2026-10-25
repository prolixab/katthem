const escape=value=>String(value??'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
// Fold by UTF-8 bytes, without splitting a Unicode character (RFC 5545).
function fold(line){let result='',size=0;for(const char of line){const bytes=Buffer.byteLength(char);if(size+bytes>75){result+='\r\n ';size=1}result+=char;size+=bytes}return result}
export function calendarEvent(slot,{appUrl,now=new Date()}={}){
 const stamp=now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 const local=time=>slot.date.replaceAll('-','')+'T'+time.replace(':','')+'00';
 return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Katthemmet//Volontärportalen//SV','CALSCALE:GREGORIAN','BEGIN:VTIMEZONE','TZID:Europe/Stockholm','BEGIN:DAYLIGHT','DTSTART:19700329T020000','TZOFFSETFROM:+0100','TZOFFSETTO:+0200','RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU','END:DAYLIGHT','BEGIN:STANDARD','DTSTART:19701025T030000','TZOFFSETFROM:+0200','TZOFFSETTO:+0100','RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU','END:STANDARD','END:VTIMEZONE','BEGIN:VEVENT',`UID:katthem-slot-${slot.id}@${new URL(appUrl).hostname}`,`DTSTAMP:${stamp}`,`DTSTART;TZID=Europe/Stockholm:${local(slot.start)}`,`DTEND;TZID=Europe/Stockholm:${local(slot.end)}`,`SUMMARY:${escape(slot.title)}`,`DESCRIPTION:${escape([slot.note,slot.extra_info,'Aktuell bokning: '+appUrl].filter(Boolean).join('\n'))}`,`URL:${appUrl}`,'STATUS:CONFIRMED','END:VEVENT','END:VCALENDAR'].map(fold).join('\r\n')+'\r\n';
}
