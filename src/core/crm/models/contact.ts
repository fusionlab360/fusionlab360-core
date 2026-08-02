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
   * Date of Birth
   */
  dob?: string;

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
  branchName?: string;

  /**
   * Platform Attributes
   *
   * Provider-specific custom fields
   * are translated into this model.
   */
  attributes?: Attribute[];
}