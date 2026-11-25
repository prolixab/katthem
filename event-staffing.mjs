const invalid=message=>{throw Object.assign(new Error(message),{status:400})};
export function eventStaffing(input,existing={}){
 const required=Number(input.event_required??existing.event_required??2),raw=input.capacity??existing.capacity??0,capacity=raw===''?0:Number(raw);
 if(!Number.isInteger(required)||required<1||required>500)invalid('Ange 1–500 personer som behövs.');
 if(!Number.isInteger(capacity)||capacity<0||capacity>500||capacity>0&&capacity<required)invalid('Deltagartaket måste vara minst bemanningsbehovet och högst 500.');
 return {required,capacity};
}
export function assertEventCapacity(slot,booked){
 if(slot.kind==='event'&&slot.capacity>0&&booked>=slot.capacity)throw Object.assign(new Error('Händelsen är fullbokad.'),{status:409,code:'EVENT_FULL'});
}
