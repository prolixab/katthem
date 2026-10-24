export const isAdmin=user=>['admin','superadmin'].includes(user?.role);
export const isSuperAdmin=user=>user?.role==='superadmin';
export const canManageAccount=(actor,target)=>isSuperAdmin(actor)||(isAdmin(actor)&&target?.role==='volunteer');

export const isGreen=(user,completed=0)=>isAdmin(user)||(user?.role==='volunteer'&&(Boolean(user.green_manual)||completed>15));
