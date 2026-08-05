const IMAGE_UPLOAD_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

// Everything the image endpoint would refuse goes to attachments rather than
// failing: SVG and AVIF because it sniffs for four formats, anything past 10 MB
// because attachments carry a far larger cap. An SVG landing here is also the
// safer outcome — attachments are served as opaque downloads, images are not.
export function uploadsAsImage(file: File): boolean {
  return IMAGE_UPLOAD_TYPES.has(file.type) && file.size <= IMAGE_UPLOAD_MAX_BYTES;
}
