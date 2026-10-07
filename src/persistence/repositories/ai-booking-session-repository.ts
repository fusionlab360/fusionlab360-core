import {
  BaseRepository,
} from "./base-repository";


export type AIBookingSessionStatus =
  | "collecting"
  | "awaiting_slot_selection"
  | "awaiting_confirmation"
  | "confirmed"
  | "cancelled";


export type AIBookingType =
  | "appointment"
  | "accommodation";


export interface AIBookingSession {

  tenantId:
    string;

  provider:
    string;

  conversationId:
    string;

  status:
    AIBookingSessionStatus;

  bookingType:
    AIBookingType;

  offeringId:
    string |
    null;

  resourceId:
    string |
    null;

  startAt:
    string |
    null;

  endAt:
    string |
    null;

  adults:
    number |
    null;

  children:
    number |
    null;

  quantity:
    number |
    null;

  pendingSlotsJson:
    string |
    null;

  dataJson:
    string |
    null;

  createdAt:
    string;

  updatedAt:
    string;
}


export class AIBookingSessionRepository
  extends BaseRepository {


  async find(
    tenantId:
      string,

    provider:
      string,

    conversationId:
      string,
  ):
    Promise<
      AIBookingSession |
      null
    > {

    const result =
      await this.db
        .prepare(
          `
          SELECT *
          FROM ai_booking_sessions

          WHERE tenant_id = ?
            AND provider = ?
            AND conversation_id = ?

          LIMIT 1
          `,
        )
        .bind(
          tenantId,
          provider,
          conversationId,
        )
        .first();


    if (
      !result
    ) {

      return null;
    }


    return {

      tenantId:
        result.tenant_id as string,

      provider:
        result.provider as string,

      conversationId:
        result.conversation_id as string,

      status:
        result.status as
          AIBookingSessionStatus,

      bookingType:
        result.booking_type as
          AIBookingType,

      offeringId:
        result.offering_id as
          string |
          null,

      resourceId:
        result.resource_id as
          string |
          null,

      startAt:
        result.start_at as
          string |
          null,

      endAt:
        result.end_at as
          string |
          null,

      adults:
        result.adults === null
          ? null
          : Number(
              result.adults,
            ),

      children:
        result.children === null
          ? null
          : Number(
              result.children,
            ),

      quantity:
        result.quantity === null
          ? null
          : Number(
              result.quantity,
            ),

      pendingSlotsJson:
        result.pending_slots_json as
          string |
          null,

      dataJson:
        result.data_json as
          string |
          null,

      createdAt:
        result.created_at as string,

      updatedAt:
        result.updated_at as string,
    };
  }


  async upsert(
    session:
      AIBookingSession,
  ):
    Promise<void> {

    await this.db
      .prepare(
        `
        INSERT INTO ai_booking_sessions (

          tenant_id,
          provider,
          conversation_id,

          status,
          booking_type,

          offering_id,
          resource_id,

          start_at,
          end_at,

          adults,
          children,
          quantity,

          pending_slots_json,
          data_json,

          created_at,
          updated_at
        )

        VALUES (

          ?,
          ?,
          ?,

          ?,
          ?,

          ?,
          ?,

          ?,
          ?,

          ?,
          ?,
          ?,

          ?,
          ?,

          ?,
          ?
        )

        ON CONFLICT (
          tenant_id,
          provider,
          conversation_id
        )

        DO UPDATE SET

          status =
            excluded.status,

          booking_type =
            excluded.booking_type,

          offering_id =
            excluded.offering_id,

          resource_id =
            excluded.resource_id,

          start_at =
            excluded.start_at,

          end_at =
            excluded.end_at,

          adults =
            excluded.adults,

          children =
            excluded.children,

          quantity =
            excluded.quantity,

          pending_slots_json =
            excluded.pending_slots_json,

          data_json =
            excluded.data_json,

          updated_at =
            excluded.updated_at
        `,
      )
      .bind(

        session.tenantId,

        session.provider,

        session.conversationId,

        session.status,

        session.bookingType,

        session.offeringId,

        session.resourceId,

        session.startAt,

        session.endAt,

        session.adults,

        session.children,

        session.quantity,

        session.pendingSlotsJson,

        session.dataJson,

        session.createdAt,

        session.updatedAt,
      )
      .run();
  }


  /*
   * --------------------------------------------------
   * Atomic booking execution claim
   * --------------------------------------------------
   *
   * Prevents two concurrent webhook requests from
   * both reaching createBooking().
   *
   * Only a session currently waiting for confirmation
   * can receive an execution claim.
   *
   * Returns true when this request successfully claims
   * execution, otherwise false.
   * --------------------------------------------------
   */

 async claimBookingExecution(
  tenantId:
    string,

  provider:
    string,

  conversationId:
    string,

  claimId:
    string,

  claimType:
    "booking" |
    "reschedule" =
    "booking",
):
  Promise<boolean> {

  const claimIdField =
    claimType ===
      "reschedule"
      ? "rescheduleExecutionClaimId"
      : "executionClaimId";


  const claimTimeField =
    claimType ===
      "reschedule"
      ? "rescheduleExecutionClaimedAt"
      : "executionClaimedAt";

  const updatedAt =
    new Date().toISOString();

  const result =
    await this.db
      .prepare(
        `
        UPDATE ai_booking_sessions

        SET

          data_json =
            json_set(
              json_set(
                COALESCE(
                  data_json,
                  '{}'
                ),

                '$.${claimIdField}',

                ?
              ),

              '$.${claimTimeField}',

              ?
            ),

          updated_at =
            ?

        WHERE tenant_id = ?
          AND provider = ?
          AND conversation_id = ?

          AND (
            status =
              'awaiting_confirmation'

            OR

            (
              status =
                'confirmed'

              AND

              json_extract(
                COALESCE(
                  data_json,
                  '{}'
                ),
                '$.pendingRescheduleConfirmation'
              ) = 1
            )
          )

          AND (
            json_extract(
              COALESCE(
                data_json,
                '{}'
              ),
              '$.${claimIdField}'
            ) IS NULL

            OR

            json_extract(
              COALESCE(
                data_json,
                '{}'
              ),
              '$.${claimIdField}'
            ) = ?

            OR

            (
              json_extract(
                COALESCE(
                  data_json,
                  '{}'
                ),
                '$.${claimTimeField}'
              ) IS NOT NULL

              AND

              datetime(
                json_extract(
                  data_json,
                  '$.${claimTimeField}'
                )
              ) <=
              datetime(
                'now',
                '-10 minutes'
              )
            )
          )
        `,
      )
      .bind(
        claimId,

        updatedAt,

        updatedAt,

        tenantId,

        provider,

        conversationId,

        claimId,
      )
      .run();

  return (
    result.meta.changes ===
    1
  );
}

  async delete(
    tenantId:
      string,

    provider:
      string,

    conversationId:
      string,
  ):
    Promise<void> {

    await this.db
      .prepare(
        `
        DELETE FROM ai_booking_sessions

        WHERE tenant_id = ?
          AND provider = ?
          AND conversation_id = ?
        `,
      )
      .bind(
        tenantId,
        provider,
        conversationId,
      )
      .run();
  }
}