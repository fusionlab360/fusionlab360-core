import type { Attribute } from "./attribute";
import type { ContactEvent } from "../../../domain/contact/event";

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
   * Identity Number
   * (Passport, NRIC, National ID, etc.)
   */
  identityNumber?: string;

  /**
   * Identity Type
   * Example: Passport, NRIC, National ID
   */
  identityType?: string;

  /**
   * Nationality
   */
  nationality?: string;

   /**
   * Last Visited Date
   */
  lastVisitedDate?: string;

  

  /**
   * Date of Birth
   */
  dob?: string;

  /**
 * Contact Notes
 */
  notes?: string;

    /**
   * Structured Contact Event Information
   */
  events?: ContactEvent[];

    /**
   * Passport Number
   */
  passport?: string;

  /**
   * Address Line
   */
  address?: string;

  /**
   * City
   */
  city?: string;

  /**
   * State / Province
   */
  state?: string;

  /**
   * Country
   */
  country?: string;

  /**
   * Postal Code
   */
  postalCode?: string;

  /**
 * Hotel Name
 */
  hotelName?: string;

  /**
 * Branch Name
 */
  
  branch?: string;

  /**
   * Platform Attributes
   *
   * Provider-specific custom fields
   * are translated into this model.
   */
  attributes?: Attribute[];
}