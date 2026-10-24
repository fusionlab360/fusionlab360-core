import type { APIClient } from "../../clients/types";
import type { IntegrationRuntime } from "../../core/integration/runtime";
import type { PatientIdentity, PatientIdentityGateway } from "../../core/booking";
import type { RequestContext } from "../../context/types";
import type { Tenant } from "../../tenants/types";
import type { Contact } from "../../core/crm/models/contact";
import { resolveCRMAdapter } from "../../core/crm";
import { normalizePhoneNumber } from "../../core/crm";

function toIdentity(contact: Contact): PatientIdentity {
  const fullName = `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim();
  const rawIdentity = contact.identityNumber?.trim() || contact.passport?.trim() || "";
  const identityNumber = /^(?:guest|unknown|none|n\/a|null|contact|customer)$/i.test(rawIdentity) || rawIdentity.length < 5
    ? null
    : rawIdentity;
  return {
    fullName: /^(?:guest|unknown|contact|customer)$/i.test(fullName) || !fullName ? null : fullName,
    identityNumber,
    phone: normalizePhoneNumber(contact.phone),
    identityType: contact.identityType?.trim() || null,
  };
}

export function createPatientIdentityGateway(context: RequestContext): PatientIdentityGateway {
  const crm = resolveCRMAdapter(context.tenant);
  return {
    async load(customerId) {
      if (!customerId.trim()) throw new Error("Patient contact is required.");
      const contact = await crm.getContact(context, customerId);
      if (contact.id !== customerId) {
        throw new Error("Patient contact readback did not match the linked customer.");
      }
      return toIdentity(contact);
    },
    async update(customerId, identity) {
      const current = await crm.getContact(context, customerId);
      const fullName = identity.fullName?.trim() || null;
      const phone = normalizePhoneNumber(identity.phone);
      const parts = fullName?.split(/\s+/) ?? [];
      await crm.updateContact(context, customerId, {
        ...(fullName && (!current.firstName || /^(?:guest|unknown|contact|customer)$/i.test(current.firstName.trim()))
          ? { firstName: parts[0] ?? fullName, lastName: parts.slice(1).join(" ") || undefined }
          : {}),
        ...(identity.identityNumber?.trim() && !current.identityNumber?.trim() && !current.passport?.trim()
          ? { identityNumber: identity.identityNumber.trim(), identityType: identity.identityType?.trim() || undefined }
          : {}),
        ...(phone && !normalizePhoneNumber(current.phone)
          ? { phone }
          : {}),
      });
      const refreshed = await crm.getContact(context, customerId);
      if (refreshed.id !== customerId) {
        throw new Error("Patient contact readback did not match the linked customer.");
      }
      const result = toIdentity(refreshed);
      if ((identity.fullName && result.fullName !== identity.fullName.trim()) ||
          (identity.identityNumber && result.identityNumber !== identity.identityNumber.trim()) ||
          (phone && result.phone !== phone)) {
        throw new Error("Patient identity could not be verified after contact update.");
      }
      return result;
    },
  };
}

export function createInternalPatientIdentityContext(tenant: Tenant, integrationRuntime: IntegrationRuntime): RequestContext {
  const client: APIClient = {
    id: "internal-booking",
    name: "Internal booking",
    tenantId: tenant.id,
    apiKey: "",
    status: "active",
    permissions: ["contacts:read", "contacts:update"],
  };
  return { client, tenant, integrationRuntime, requestId: crypto.randomUUID(), receivedAt: new Date() };
}
