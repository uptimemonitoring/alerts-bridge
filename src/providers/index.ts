import type { Provider } from "../types.js";
import { pushover } from "./pushover.js";

export const providers: Record<string, Provider> = { pushover };

export function lookupProvider(name: string): Provider | undefined {
  return providers[name.toLowerCase()];
}
