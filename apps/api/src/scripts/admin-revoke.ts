/** Remove instance authority through the audited console policy without demoting the last usable administrator. */
import { runAdminRole } from "./admin-role.js";

await runAdminRole("user");
