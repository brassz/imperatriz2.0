export type DocumentAnalysisSeverity = "low" | "medium" | "high";

export type DocumentExtractedField = {
  key: string;
  label: string;
  value: string;
};

export type DocumentAnalysisRiskFlag = {
  title: string;
  details: string;
  severity: DocumentAnalysisSeverity;
};

export type DocumentAnalysisResult = {
  success: true;
  fileName: string;
  mimeType: string;
  source: "fallback" | "llm";
  documentType: string;
  summary: string;
  keyPoints: string[];
  extractedFields: DocumentExtractedField[];
  riskFlags: DocumentAnalysisRiskFlag[];
  consistencyNotes: string[];
  confidence: number;
  extractedTextPreview: string;
};

export type DocumentAnalysisError = {
  success: false;
  error: string;
};

export type DocumentAnalysisResponse = DocumentAnalysisResult | DocumentAnalysisError;
