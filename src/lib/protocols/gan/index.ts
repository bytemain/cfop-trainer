import { registerGanProtocol } from "./registry";
import { GanV4Protocol } from "./v4/adapter";

let registered = false;

export function registerBuiltInGanProtocols(): void {
  if (registered) return;
  registerGanProtocol(new GanV4Protocol());
  registered = true;
}

export { detectGanProtocol, ganProtocolAdapterFor, registeredGanProtocols } from "./registry";
