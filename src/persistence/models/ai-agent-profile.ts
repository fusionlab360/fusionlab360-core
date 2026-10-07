export interface AIAgentProfile {
  tenantId: string;

  agentName: string;

  businessName: string;

  businessType: string;

  greetingTemplate: string;

  handoffTemplate: string;

  systemInstructions: string;

  aiInstructionsKnowledgeBaseId?: string;

  createdAt: string;

  updatedAt: string;
}