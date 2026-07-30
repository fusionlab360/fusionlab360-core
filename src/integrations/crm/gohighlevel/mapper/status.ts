export type GHLOpportunityStatus =
  | "open"
  | "won"
  | "lost"
  | "abandoned";

export function mapOpportunityStatus(
  reservationStatus: string
): GHLOpportunityStatus {
  switch (reservationStatus) {
    case "checked_out":
      return "won";

    case "cancelled":
      return "lost";

    case "no_show":
      return "abandoned";

    default:
      return "open";
  }
}