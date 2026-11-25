export const isAdmin=user=>['admin','superadmin'].includes(user?.role);
export const isCoordinator=user=>user?.role==='coordinator';
export const canManageBookings=user=>isAdmin(user)||isCoordinator(user);
export const isSuperAdmin=user=>user?.role==='superadmin';
export const canManageAccount=(actor,target)=>isSuperAdmin(actor)||(isAdmin(actor)&&['volunteer','coordinator'].includes(target?.role));

export const isGreen=(user,completed=0,checklistComplete=false)=>isAdmin(user)||(checklistComplete&&['volunteer','coordinator'].includes(user?.role)&&(Boolean(user.green_manual)||completed>=10));
