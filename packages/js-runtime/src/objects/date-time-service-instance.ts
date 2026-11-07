import { createDateTimeService } from "./date-time-service-factory.ts";
import type { DateTimeService } from "./date-time-service-contracts.ts";

let service: DateTimeService | undefined = undefined;
/** Ordinary source execution uses the shared implementation directly. Native
 * service composition replaces this module with its checked factory adapter. */
export function getDateTimeService(): DateTimeService {
  if (service === undefined) service = createDateTimeService();
  return service;
}
