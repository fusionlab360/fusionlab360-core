export interface Attribute {
  /**
   * Platform attribute identifier.
   *
   * Usually mapped from the provider's custom field ID or key.
   */
  key: string;

  /**
   * Human readable name.
   *
   * Optional because some providers only expose keys.
   */
  name?: string;

  /**
   * Platform value.
   */
  value: string | number | boolean | null;

  /**
   * Optional provider data type.
   */
  type?: string;
}