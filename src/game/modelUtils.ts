import * as THREE from 'three'

// Module-level caches: one geometry per unique dimension triple, one material per colour.
// All model builders share these so identical shapes/colours reuse a single GPU resource
// instead of each spawned creature allocating its own set.
const geoCache = new Map<string, THREE.BoxGeometry>()
const matCache = new Map<number, THREE.MeshStandardMaterial>()

function getGeo(w: number, h: number, d: number): THREE.BoxGeometry {
  const key = `${w}:${h}:${d}`
  let geo = geoCache.get(key)
  if (!geo) {
    geo = new THREE.BoxGeometry(w, h, d)
    geoCache.set(key, geo)
  }
  return geo
}

function getMat(color: number): THREE.MeshStandardMaterial {
  let mat = matCache.get(color)
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color })
    matCache.set(color, mat)
  }
  return mat
}

/**
 * Create a box mesh using shared (cached) geometry and material. Shadow flags are
 * always set — every visible box in the game should cast and receive shadows.
 */
export function box(
  w: number,
  h: number,
  d: number,
  color: number,
  position: [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(getGeo(w, h, d), getMat(color))
  mesh.position.set(...position)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/**
 * Free a removed object's GPU resources. Skips anything that lives in the shared
 * cache — those must not be freed while other meshes still reference them.
 */
export function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry && !isSharedGeo(mesh.geometry)) mesh.geometry.dispose()
    const mat = mesh.material
    if (Array.isArray(mat)) mat.forEach((m) => { if (!isSharedMat(m)) m.dispose() })
    else if (mat && !isSharedMat(mat)) (mat as THREE.Material).dispose()
  })
}

function isSharedGeo(geo: THREE.BufferGeometry): boolean {
  for (const cached of geoCache.values()) if (cached === geo) return true
  return false
}

function isSharedMat(mat: THREE.Material): boolean {
  for (const cached of matCache.values()) if (cached === mat) return true
  return false
}
