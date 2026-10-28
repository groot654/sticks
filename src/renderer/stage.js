import * as THREE from './lib/three.js';
import { NOTE_SIZE, drawFront, drawBack } from './paper.js';

const FOV = 22;
// Light from the upper left, slightly in front of the screen.
const SUN_DIR = new THREE.Vector3(-0.35, 0.45, 1).normalize();

/**
 * One transparent WebGL layer over the whole work area. World units are CSS pixels:
 * screen (x, y) is world (x, -y, 0), and the camera sits so that the z = 0 plane maps 1:1
 * onto the screen. Anything lifted toward the viewer (z > 0) gets real perspective.
 */
export class Stage {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 10, 20000);

    // Lambert shading is albedo * irradiance / PI, so ambient + sun on a sheet facing the
    // camera sums to PI: a flat 3D note renders exactly the colour of its DOM twin.
    this.scene.add(new THREE.AmbientLight(0xffffff, Math.PI * 0.55));
    this.sun = new THREE.DirectionalLight(0xffffff, (Math.PI * 0.45) / SUN_DIR.z);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 6;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    // Invisible wall that only shows the shadows cast on the desktop.
    this.shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.26 }));
    this.shadowPlane.receiveShadow = true;
    this.scene.add(this.shadowPlane);

    this.maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.envMap = this.buildEnvironment();
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.dist = h / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    this.camera.aspect = w / h;
    this.camera.position.set(w / 2, -h / 2, this.dist);
    this.camera.lookAt(w / 2, -h / 2, 0);
    this.camera.updateProjectionMatrix();

    this.sun.target.position.set(w / 2, -h / 2, 0);
    this.sun.position.copy(SUN_DIR).multiplyScalar(3000).add(this.sun.target.position);
    const ext = Math.max(w, h) * 0.75;
    Object.assign(this.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 100, far: 6000 });
    this.sun.shadow.camera.updateProjectionMatrix();

    this.shadowPlane.position.set(w / 2, -h / 2, 0);
    this.shadowPlane.scale.set(w * 2, h * 2, 1);
  }

  /** The world point at depth z that appears exactly at screen pixel (sx, sy). */
  atDepth(sx, sy, z, out = new THREE.Vector3()) {
    const k = (this.dist - z) / this.dist;
    return out.set(this.w / 2 + (sx - this.w / 2) * k, -this.h / 2 + (this.h / 2 - sy) * k, z);
  }

  depthScale(z) {
    return (this.dist - z) / this.dist;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  // A soft studio environment so the metal bin has something to reflect.
  buildEnvironment() {
    const env = new THREE.Scene();
    const sky = new THREE.SphereGeometry(100, 32, 16);
    const colors = [];
    const p = sky.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) / 100 + 1) / 2;
      const c = new THREE.Color().lerpColors(new THREE.Color(0x2a2c30), new THREE.Color(0xe8ecf2), t);
      colors.push(c.r, c.g, c.b);
    }
    sky.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    env.add(new THREE.Mesh(sky, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 4) }));
    panel.position.set(-40, 50, 60);
    panel.lookAt(0, 0, 0);
    env.add(panel);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const tex = pmrem.fromScene(env, 0.03).texture;
    pmrem.dispose();
    return tex;
  }
}

/** The 3D twin of a note: a finely subdivided sheet with its face and back textured. */
export class Sheet {
  constructor(stage, note, scrollTop = 0) {
    this.stage = stage;
    this.geo = new THREE.PlaneGeometry(NOTE_SIZE, NOTE_SIZE, 30, 30);
    this.geo.attributes.position.setUsage(THREE.DynamicDrawUsage);
    this.base = Float32Array.from(this.geo.attributes.position.array);
    this.pos = this.geo.attributes.position.array;

    const scale = Math.min(3, Math.max(2, window.devicePixelRatio * 1.5));
    this.frontTex = this.texture(drawFront(document.createElement('canvas'), note, scale, scrollTop));
    this.backTex = this.texture(drawBack(document.createElement('canvas'), note, scale));
    this.frontMat = new THREE.MeshLambertMaterial({ map: this.frontTex, side: THREE.FrontSide });
    this.backMat = new THREE.MeshLambertMaterial({ map: this.backTex, side: THREE.BackSide });

    this.group = new THREE.Group();
    for (const mat of [this.frontMat, this.backMat]) {
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.castShadow = true;
      this.group.add(mesh);
    }
    stage.scene.add(this.group);
  }

  texture(canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.stage.maxAnisotropy;
    return tex;
  }

  /** Faceted shading reads as creased paper once crumpling starts. */
  setFaceted(faceted) {
    for (const mat of [this.frontMat, this.backMat]) {
      if (mat.flatShading !== faceted) {
        mat.flatShading = faceted;
        mat.emissiveMap = faceted ? mat.map : null;
        mat.needsUpdate = true;
      }
    }
  }

  /**
   * Light scattered between the folds of a crumpled ball. Without it, facets turned away
   * from the sun go muddy brown; a flat sheet keeps 0 so it matches its DOM twin exactly.
   */
  setGlow(amount) {
    for (const mat of [this.frontMat, this.backMat]) mat.emissive.setScalar(amount);
  }

  flatten(z = 0) {
    for (let i = 0; i < this.pos.length; i += 3) {
      this.pos[i] = this.base[i];
      this.pos[i + 1] = this.base[i + 1];
      this.pos[i + 2] = z;
    }
    this.commit();
  }

  commit() {
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }

  dispose() {
    this.group.removeFromParent();
    this.geo.dispose();
    this.frontMat.dispose();
    this.backMat.dispose();
    this.frontTex.dispose();
    this.backTex.dispose();
  }
}

/** Perforated-metal office bin. Physics treats it as a 2D trapezoid; this is its 3D look. */
export function createBin(stage, dims) {
  const { topHalf, botHalf, height } = dims;
  const holes = document.createElement('canvas');
  holes.width = holes.height = 64;
  const hx = holes.getContext('2d');
  hx.fillStyle = '#fff';
  hx.fillRect(0, 0, 64, 64);
  hx.fillStyle = '#000';
  for (const [x, y] of [[16, 16], [48, 48]]) {
    hx.beginPath();
    hx.arc(x, y, 10.5, 0, Math.PI * 2);
    hx.fill();
  }
  const alphaMap = new THREE.CanvasTexture(holes);
  alphaMap.wrapS = alphaMap.wrapT = THREE.RepeatWrapping;
  alphaMap.repeat.set(30, 7);
  alphaMap.anisotropy = stage.maxAnisotropy;

  const metal = (color, extra = {}) => new THREE.MeshStandardMaterial({
    color, metalness: 0.65, roughness: 0.38, envMap: stage.envMap, envMapIntensity: 1.1, ...extra,
  });

  const group = new THREE.Group();
  const body = new THREE.Group();
  // the perforations stop short of the top and bottom bands, like a real mesh bin
  const bandH = 12;
  const meshH = height - bandH * 2;
  const rAt = (y) => botHalf + (topHalf - botHalf) * ((y + height / 2) / height);

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(rAt(height / 2 - bandH), rAt(-height / 2 + bandH), meshH, 72, 1, true),
    metal(0x34383e, { alphaMap, alphaTest: 0.5, side: THREE.DoubleSide }),
  );
  const topBand = new THREE.Mesh(
    new THREE.CylinderGeometry(topHalf, rAt(height / 2 - bandH), bandH, 72, 1, true),
    metal(0x3d4249, { side: THREE.DoubleSide }),
  );
  topBand.position.y = height / 2 - bandH / 2;
  const botBand = new THREE.Mesh(
    new THREE.CylinderGeometry(rAt(-height / 2 + bandH), botHalf, bandH, 72, 1, true),
    metal(0x3d4249, { side: THREE.DoubleSide }),
  );
  botBand.position.y = -height / 2 + bandH / 2;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(topHalf, 3.4, 14, 96), metal(0x5a6069, { roughness: 0.28 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = height / 2;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(botHalf, 48), metal(0x24272b));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -height / 2 + 1;

  for (const m of [wall, topBand, botBand, rim, floor]) {
    m.castShadow = true;
    m.receiveShadow = m !== rim;
    body.add(m);
  }
  group.add(body);
  stage.scene.add(group);

  return {
    group,
    // Sits on the floor, its back touching the wall; scaled so its silhouette lines up with
    // the 2D physics outline despite the perspective camera.
    place(x, floorY) {
      const z = topHalf;
      stage.atDepth(x, floorY - height / 2, z, group.position);
      group.scale.setScalar(stage.depthScale(z));
    },
  };
}
