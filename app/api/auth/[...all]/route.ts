import { getAuth, api } from "@/lib/server";
export const runtime = "nodejs";
const handler = api(async (req) => getAuth().handler(req));
export { handler as GET, handler as POST };
