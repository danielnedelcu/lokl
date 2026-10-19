import type { AdminRole } from "@repo/types";

// The signed-in person's role, as the route middleware last read it from
// the database (admin_role()). For the menu and page wording only: the
// database checks the role on every read and write.
export const useAdminRole = () => useState<AdminRole | null>("admin-role", () => null);
