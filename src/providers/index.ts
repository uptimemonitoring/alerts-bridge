import type { Provider } from "../types.js";
import { ntfy } from "./ntfy.js";
import { pushover } from "./pushover.js";
import { slack } from "./slack.js";

export const providers: Record<string, Provider> = { pushover, ntfy, slack };

export function lookupProvider(name: string): Provider | undefined {
  return providers[name.toLowerCase()];
}
