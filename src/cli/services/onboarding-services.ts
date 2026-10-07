import { apiRequest } from "../utils/api";

export interface PreviewResponse {
  success: boolean;
  data: {
    provider: string;
    locationId: string;
    pipelines: Array<{
      id: string;
      name: string;
    }>;
    stages: number;
    customFields: number;
  };
}

export async function previewIntegration(
  apiKey: string,
): Promise<PreviewResponse> {

  return apiRequest<PreviewResponse>(
    "/integration/preview",
    "POST",
    apiKey,
  );

}