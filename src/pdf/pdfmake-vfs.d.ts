/**
 * Ambient declaration dla wbudowanego VFS pdfmake (Roboto, base64).
 * @types/pdfmake typuje tylko `main` + `interfaces`, nie `build/vfs_fonts.js`.
 */
declare module 'pdfmake/build/vfs_fonts.js' {
  const vfs: Record<string, string>;
  export default vfs;
}
