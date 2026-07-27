export interface ProviderFieldMapping {
  providerFieldId: string;
  providerFieldName: string;
  providerFieldType?: string;
}

export type FieldMappingCollection =
  Record<string, ProviderFieldMapping>;