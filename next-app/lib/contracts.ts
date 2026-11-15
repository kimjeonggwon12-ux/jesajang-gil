export type MemberAccess = {
  isAdmin:boolean; name:string; position:string; dept:string; roster?:{dept:string;tier?:string}|null;
  permissions:{canViewBackupStatus?:boolean;canManagePilot?:boolean;canManageBackup?:boolean;canManageRoster:boolean;canExportTeachers:boolean;canChangeTier:boolean};
};
export type TierStatus = {
  memberId:string;name:string;dept:string;region:string;tier:string;tierChangedAt:string;
  monthlyCount:number;monthlyGoal:number;recentRecords:number;activeGoal:number;ruleStart:string;
  otherPending:boolean;otherAttend:number|null;otherGoal:number;monthStart:string;monthEnd:string;monthDaysLeft:number;
  leadCount:number;leadGoal:number|null;nextTier:string|null;lastActivityDate:string;daysSinceLastActivity:number|null;
  suggestion:{suggestedTier:string;reason:string}|null;
};
