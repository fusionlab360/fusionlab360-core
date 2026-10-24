export type MetaWhatsAppConnectionStatus =
  | "pending"
  | "active"
  | "disabled"
  | "reauthorization_required";

export interface MetaWhatsAppConnectionRecord {
  id: string;
  tenantId: string;
  integrationId: string;
  wabaId: string;
  phoneNumberId: string;
  status: MetaWhatsAppConnectionStatus;
  createdAt: string;
  updatedAt: string;
}
