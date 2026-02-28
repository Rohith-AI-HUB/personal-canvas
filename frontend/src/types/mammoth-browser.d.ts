declare module 'mammoth/mammoth.browser' {
  export interface ConvertToHtmlResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }

  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<ConvertToHtmlResult>;
}
