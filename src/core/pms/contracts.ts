import type { RequestContext } from "../../context";
import type { PMSCommand } from "./models/command";
import type { PMSResult } from "./models/result";
import type { PMSEvent } from "./models/reservation-event";


export interface PMSAdapter {

  execute<TResult = unknown>(
    context: RequestContext,
    command: PMSCommand,
  ): Promise<PMSResult<TResult>>;

}


export interface PMSReservationEventAdapter
  extends PMSAdapter {

  toReservationEvent(
    context: RequestContext,
    payload: unknown,
  ): Promise<PMSResult<PMSEvent>>;

}