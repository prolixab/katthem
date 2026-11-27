export const isAdmin=user=>['admin','superadmin'].includes(user?.role);
export const isCoordinator=user=>user?.role==='coordinator';
export const canManageBookings=user=>isAdmin(user)||isCoordinator(user);
export const isSuperAdmin=user=>user?.role==='superadmin';
export const canManageAccount=(actor,target)=>isSuperAdmin(actor)||(isAdmin(actor)&&['volunteer','coordinator'].includes(target?.role));

export const isGreen=(user,completed=0,checklistComplete=false)=>isAdmin(user)||(checklistComplete&&['volunteer','coordinator'].includes(user?.role)&&(Boolean(user.green_manual)||completed>=10));

export function summarizeVolunteerStatus(rows){
 const counts={green:0,intro_pending:0,intro_completed:0,volunteers:0,administration:0,total:0};
 for(const row of rows){counts.total++;if(row.administrative){counts.administration++;continue;}counts.volunteers++;if(row.green)counts.green++;else if(row.introduction_completed)counts.intro_completed++;else counts.intro_pending++;}
 return counts;
}
