export interface ReadFileResult {
  filename: string;
  rawContent: string;
  normalizedContent: string;
  lineCount: number;
  byteLength: number;
}

export function readRawTextInput(content: string, filename = 'uploaded_messages.txt'): ReadFileResult {
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('Uploaded message text is empty.');
  }

  const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return {
    filename,
    rawContent: content,
    normalizedContent,
    lineCount: normalizedContent.split('\n').length,
    byteLength: Buffer.byteLength(content, 'utf-8'),
  };
}
