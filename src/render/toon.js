import * as THREE from 'three';

let _gradient = null;
let _glowTex = null;

export function getGradientMap() {
  if (_gradient) return _gradient;
  const steps = 5;
  const data = new Uint8Array([18, 72, 130, 196, 255]);
  _gradient = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  _gradient.minFilter = THREE.NearestFilter;
  _gradient.magFilter = THREE.NearestFilter;
  _gradient.generateMipmaps = false;
  _gradient.needsUpdate = true;
  return _gradient;
}

export function getGlowTexture() {
  if (_glowTex) return _glowTex;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,.92)');
  grad.addColorStop(0.46, 'rgba(255,255,255,.32)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  _glowTex = new THREE.CanvasTexture(canvas);
  _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
}

export function createToonMaterial(color, opts = {}) {
  const {
    map = null,
    emissive = 0x000000,
    emissiveIntensity = 1,
    transparent = false,
    opacity = 1,
    side = THREE.FrontSide,
    rim = 0.14,
    rimColor = 0xffffff,
    gradient = null,
    toneMapped = true,
  } = opts;
  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: gradient || getGradientMap(),
    map,
    emissive,
    emissiveIntensity,
    transparent,
    opacity,
    side,
    toneMapped,
  });
  if (rim > 0) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uRimColor = { value: new THREE.Color(rimColor) };
      shader.uniforms.uRimStrength = { value: rim };
      shader.fragmentShader = shader.fragmentShader
        .replace(
          'void main() {',
          'uniform vec3 uRimColor;\nuniform float uRimStrength;\nvoid main() {'
        )
        .replace(
          '#include <opaque_fragment>',
          `
          vec3 rimV = normalize( vViewPosition );
          float rimF = 1.0 - clamp( dot( normal, rimV ), 0.0, 1.0 );
          rimF = smoothstep( 0.58, 0.98, rimF );
          outgoingLight += uRimColor * rimF * uRimStrength;
          #include <opaque_fragment>`
        );
    };
    mat.customProgramCacheKey = () => `toon-rim-${rim}-${rimColor}`;
  }
  return mat;
}

export function addOutline(mesh, opts = {}) {
  const { scale = 1.035, color = 0x09090e, opacity = 1 } = opts;
  if (!mesh.geometry) return null;
  const outline = new THREE.Mesh(
    mesh.geometry,
    new THREE.MeshBasicMaterial({
      color,
      side: THREE.BackSide,
      transparent: opacity < 1,
      opacity,
      depthWrite: true,
      toneMapped: false,
    })
  );
  outline.scale.setScalar(scale);
  outline.castShadow = false;
  outline.receiveShadow = false;
  outline.userData.isOutline = true;
  outline.renderOrder = (mesh.renderOrder || 0) - 1;
  mesh.add(outline);
  return outline;
}

/** 创建一个带描边的卡通网格 */
export function toonMesh(geometry, color, opts = {}) {
  const mat = createToonMaterial(color, opts);
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.castShadow = opts.castShadow !== false;
  mesh.receiveShadow = opts.receiveShadow !== false;
  if (opts.outline !== false && !opts.transparent) {
    addOutline(mesh, {
      scale: opts.outlineScale ?? 1.028,
      color: opts.outlineColor ?? 0x08080c,
      opacity: opts.outlineOpacity ?? 1,
    });
  }
  return mesh;
}

export function basicGlow(color, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

export function spriteGlow(color, scale = 1, opacity = 0.8) {
  const mat = new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(scale);
  return sprite;
}
