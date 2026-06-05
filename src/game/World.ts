import * as THREE from 'three'

// A calm sky blue and a grassy green. Defined once so the sky, the fog, and the
// hemisphere light can all share the same palette (keeps everything cohesive).
const SKY_COLOR = 0x8ec9ff
const GROUND_COLOR = 0x88bb55

/**
 * World builds the static environment: the ground, the sky/background, fog,
 * and the lights. It doesn't animate anything, so it has no update() — it just
 * adds its objects to the Scene it's handed in the constructor.
 */
export class World {
  constructor(scene: THREE.Scene) {
    this.addSky(scene)
    this.addLights(scene)
    this.addGround(scene)
  }

  private addSky(scene: THREE.Scene): void {
    // The background is the flat colour behind everything.
    scene.background = new THREE.Color(SKY_COLOR)

    // Fog fades distant objects toward a colour. Using the SKY colour makes the
    // ground melt into the horizon instead of ending at a hard edge — cozy, and
    // it hides the far edge of our finite ground plane. Fog(color, near, far):
    // fully clear before `near`, fully fogged past `far`.
    scene.fog = new THREE.Fog(SKY_COLOR, 30, 140)
  }

  private addLights(scene: THREE.Scene): void {
    // HemisphereLight = soft, directionless ambient light: sky colour from
    // above, ground colour bounced from below. It fills shadows so nothing is
    // pure black, but it's too flat on its own to show an object's shape.
    const hemi = new THREE.HemisphereLight(SKY_COLOR, GROUND_COLOR, 1.0)
    scene.add(hemi)

    // DirectionalLight = parallel rays from one direction, like the sun. This
    // is what gives boxes a bright side and a dim side so they read as 3D.
    // Its `position` only sets the *direction* the light comes from.
    const sun = new THREE.DirectionalLight(0xffffff, 2.0)
    sun.position.set(8, 15, 6)
    scene.add(sun)
  }

  private addGround(scene: THREE.Scene): void {
    // A plane is created lying in the X/Y plane (facing the camera). We rotate
    // it -90° around X so it lies flat in X/Z with "up" (+Y) as its normal —
    // i.e. a floor. Math.PI/2 radians = 90°.
    const geometry = new THREE.PlaneGeometry(300, 300)
    // MeshStandardMaterial is a physically-based material: it RESPONDS to light
    // (unlike the cube's old MeshNormalMaterial). With no lights it'd be black —
    // that's the classic "why is everything black?" beginner footgun, which is
    // exactly why we added lights above first.
    const material = new THREE.MeshStandardMaterial({ color: GROUND_COLOR })
    const ground = new THREE.Mesh(geometry, material)
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)
  }
}
