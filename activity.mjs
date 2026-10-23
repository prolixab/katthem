export function monthAgo(now=new Date()){
 const date=new Date(now),day=date.getDate();date.setDate(1);date.setMonth(date.getMonth()-1);
 const lastDay=new Date(date.getFullYear(),date.getMonth()+1,0).getDate();date.setDate(Math.min(day,lastDay));return date.getTime();
}
export function isInactive(user,lastCompleted,now=new Date()){
 return user.role==='volunteer'&&Boolean(user.active)&&(lastCompleted??user.created_at)<=monthAgo(now);
}
