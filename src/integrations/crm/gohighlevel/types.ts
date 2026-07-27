/**
 * GoHighLevel Contact
 */
export interface GHLContact {
  /**
   * GHL Contact ID
   * Present when reading/updating an existing contact.
   */
  id?: string;

  /**
   * Contact First Name
   */
  firstName: string;

  /**
   * Contact Last Name
   */
  lastName?: string;

  /**
   * Contact Email
   */
  email?: string;

  /**
   * Contact Phone Number
   */
  phone?: string;

  /**
   * Passport/IC Number
   */
  passportNoIC?: string;

  /**
   * Nationality
   */
  nationality?: string;

  /**
   * Date of Birth
   */
  dob?: string;
}

/**
 * GoHighLevel Opportunity Custom Field
 */
export interface GHLOpportunityCustomField {
  /**
   * GHL Custom Field ID
   */
  id: string;

  /**
   * Value stored in the custom field
   */
  field_value: string;
}

/**
 * GoHighLevel Opportunity
 */
export interface GHLOpportunity {
  /**
   * GHL Opportunity ID
   * Present when reading/updating an existing opportunity.
   */
  id?: string;

  /**
   * Opportunity Name
   */
  name: string;

  /**
   * GHL Pipeline ID
   */
  pipelineId: string;

  /**
   * GHL Pipeline Stage ID
   */
  pipelineStageId: string;

  /**
   * open | won | lost | abandoned
   */
  status: string;

  /**
   * Associated Contact ID
   */
  contactId: string;

  /**
   * Opportunity Value
   */
  monetaryValue?: number;

  /**
   * GHL Custom Fields
   */
  customFields?: GHLOpportunityCustomField[];
}

/**
 * GoHighLevel Pipeline
 */
export interface GHLPipeline {
  /**
   * Pipeline ID
   */
  id: string;

  /**
   * Pipeline Name
   */
  name: string;
}

/**
 * GoHighLevel Pipeline Stage
 */
export interface GHLStage {
  /**
   * Stage ID
   */
  id: string;

  /**
   * Stage Name
   */
  name: string;
}

/**
 * GoHighLevel Custom Field
 */
export interface GHLCustomField {
  /**
   * Custom Field ID
   */
  id: string;

  /**
   * Display Name
   */
  name: string;

  /**
   * Internal Key (if returned by API)
   */
  key?: string;

  /**
   * Field Data Type
   */
  dataType?: string;

  /**
   * Placeholder
   */
  placeholder?: string;

  /**
   * Whether the field is required
   */
  required?: boolean;


}