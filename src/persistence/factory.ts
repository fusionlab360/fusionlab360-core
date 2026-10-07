import { TenantRepository } from "./repositories/tenant-repository";
import { IntegrationRepository } from "./repositories/integration-repository";
import { CredentialRepository } from "./repositories/credential-repository";
import { ConfigurationRepository } from "./repositories/configuration-repository";
import { ClientRepository } from "./repositories/client-repository";
import { ReservationLinkRepository } from "./repositories/reservation-link-repository";
import { IntegrationEventRepository } from "./repositories/integration-event-repository";
import {
  IntegrationEventDeadLetterRepository,
} from "./repositories/integration-event-dead-letter-repository";
import {
  ReservationRecordRepository,
} from "./repositories/reservation-record-repository";

export function createRepositories(db: D1Database) {
  return {
    
    clientRepository: new ClientRepository(db),
    
    reservationRecordRepository: new ReservationRecordRepository(db),

    tenantRepository: new TenantRepository(db),
    
    integrationRepository: new IntegrationRepository(db),
    
    credentialRepository: new CredentialRepository(db),

    configurationRepository: new ConfigurationRepository(db),
    
    reservationLinkRepository: new ReservationLinkRepository(db),
    
    integrationEventRepository: new IntegrationEventRepository(db),
    
    integrationEventDeadLetterRepository: new IntegrationEventDeadLetterRepository(db),
  
  };
}