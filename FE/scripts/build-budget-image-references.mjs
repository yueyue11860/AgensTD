export const publicImageReference = /(?:\/|\.\/)?(?:art|assets|sprites)\/[^'"`()\s?#]+\.(?:avif|gif|jpe?g|png|svg|webp)/gi

export function isDynamicImageReference(reference) {
  return reference.includes('${') || reference.includes('{{')
}

export function collectConcreteImageReferences(code) {
  return [...code.matchAll(publicImageReference)]
    .map(match => match[0])
    .filter(reference => !isDynamicImageReference(reference))
}
