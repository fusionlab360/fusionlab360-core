import type { Attribute } from "./attribute";

export interface Contact {
  /**
   * Platform Contact ID
   */
  id?: string;

  /**
   * First Name
   */
  firstName: string;

  /**
   * Last Name
   */
  lastName?: string;

  /**
   * Email Address
   */
  email?: string;

  /**
   * Phone Number
   */
  phone?: string;

  /**
   * Contact Tags
   */
  tags?: string[];

  
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

  /**
   * Platform Attributes
   *
   * Provider-specific custom fields
   * are translated into this model.
   */
  attributes?: Attribute[];
}