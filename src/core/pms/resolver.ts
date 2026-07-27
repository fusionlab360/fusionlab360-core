import type { RequestContext } from "../../context";
import type { PMSAdapter } from "./contracts";

export function resolvePMSAdapter(
    _context: RequestContext
): PMSAdapter {

    throw new Error("PMS adapter resolver not implemented.");

}