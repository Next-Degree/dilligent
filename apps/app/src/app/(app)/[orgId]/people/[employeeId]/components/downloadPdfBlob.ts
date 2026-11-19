'use client';

/** Save a PDF in the browser under the given file name. */
export function downloadPdfBlob({ blob, fileName }: { blob: Blob; fileName: string }) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
