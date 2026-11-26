// Illustrative only: a deny-by-default policy layer. RBAC grants coarse permissions; per-resource policy
// functions add ownership / attribute rules (the ABAC extension point). A ReBAC engine can replace a policy fn.

export type Subject = { userId: string; permissions: ReadonlySet<string>; emailVerified: boolean };
type PolicyFn = (subject: Subject, resource: any) => boolean;

/** The single registry of permissions in code. A startup check compares it with the permissions table. */
export const PERMISSIONS = ['invoice:read', 'invoice:approve', 'user:manage'] as const;
export type Permission = (typeof PERMISSIONS)[number];

const policies: Partial<Record<string, PolicyFn>> = {
  // Holders of invoice:read may read invoices of their own account; approvers may read any.
  'invoice:read': (s, invoice) => invoice.ownerId === s.userId || s.permissions.has('invoice:approve'),
  'invoice:approve': (s, invoice) => invoice.ownerId !== s.userId && s.emailVerified, // no self-approval
};

export function can(subject: Subject | null, action: Permission, resource?: unknown): boolean {
  if (!subject) return false;                       // unauthenticated: deny
  if (!subject.permissions.has(action)) return false; // RBAC: role must grant the permission
  if (resource === undefined) return true;          // function-level check only
  const policy = policies[action];
  return policy ? policy(subject, resource) : false; // resource given but no policy: deny
}

export function authorize(subject: Subject | null, action: Permission, resource?: unknown): void {
  if (!can(subject, action, resource)) {
    audit.emit({ type: 'authz.denied', actorUserId: subject?.userId ?? null, action, outcome: 'failure' });
    throw subject ? new Forbidden() : new Unauthenticated();   // 403 vs 401
  }
}

// Called from the service layer, not just the route:
//   async approveInvoice(subject, id) { const inv = await repo.get(id); authorize(subject, 'invoice:approve', inv); ... }

declare const audit: { emit(e: Record<string, unknown>): void };
declare class Forbidden extends Error {}
declare class Unauthenticated extends Error {}
