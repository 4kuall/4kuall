// The Oracle's body: a living globe of blue light — tens of thousands of glowing
// points forming a digital planet, with an eye made of the same light that opens,
// blinks and looks around, a network of knowledge arcs that grows with every work
// it absorbs, and a deep field of data, grids and constellations behind it.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Cinematic finish: a touch of chromatic fringe toward the edges and a vignette.
const LensShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 0.0009 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5; float d = dot(c, c);
      vec2 off = c * d * uAmount * 40.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= smoothstep(0.95, 0.1, d * 1.6);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// Every mood stays in the blue family; it only shifts the temperature of the light.
export const MOOD_COLORS = {
  serene: ['#4fb8ff', '#1d3dff'],
  compassionate: ['#8fd0ff', '#7b5cff'],
  joyful: ['#7ff3ff', '#2f8cff'],
  grave: ['#3c6dff', '#0d1a7a'],
  fierce: ['#5ee6ff', '#3a2cff'],
  curious: ['#48ffe0', '#1f7bff'],
  melancholic: ['#7f95ff', '#4a2fd0'],
  awed: ['#d8f1ff', '#5c7dff'],
};

const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

// A round, soft point of light; additive, so overlapping points bloom into each other.
const DOT_FRAG = /* glsl */ `
varying vec3 vColor; varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vColor, a * a * vAlpha);
}`;

const ADDITIVE = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
const R = 1.55; // globe radius (scene units)

// Small seeded RNG so the knowledge network keeps its shape as it grows.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function randomDir(rand) {
  const u = rand() * 2 - 1;
  const a = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return new THREE.Vector3(r * Math.cos(a), u, r * Math.sin(a));
}
function points(positions, attrs, uniforms, vertexShader) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  for (const [name, [arr, size]] of Object.entries(attrs)) geo.setAttribute(name, new THREE.BufferAttribute(arr, size));
  return new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader: DOT_FRAG, ...ADDITIVE }));
}

export class Oracle3D {
  constructor(canvas) {
    this.state = 'idle'; // idle | listening | thinking | speaking
    this.energy = 0; // 0..1 voice amplitude
    this.targetEnergy = 0;
    this.pointer = new THREE.Vector2();
    this.colorA = new THREE.Color(MOOD_COLORS.serene[0]);
    this.colorB = new THREE.Color(MOOD_COLORS.serene[1]);
    this.targetA = this.colorA.clone();
    this.targetB = this.colorB.clone();
    this.mood = 'serene';
    this.mobile = Math.min(innerWidth, innerHeight) < 700;
    this.knowledge = -1;
    this.absorbT = 1;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, this.mobile ? 1.5 : 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#01030a');
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);

    // Shared uniforms: every layer breathes with the same time, voice and mind.
    this.u = {
      uTime: { value: 0 },
      uEnergy: { value: 0 },
      uThink: { value: 0 },
      uListen: { value: 0 },
      uPixel: { value: 1 },
      uColorA: { value: this.colorA },
      uColorB: { value: this.colorB },
    };
    this.eyeU = {
      uGaze: { value: new THREE.Vector3(0, 0, 1) },
      uLid: { value: 1 },
      uPupil: { value: 0.5 },
      uAbsorb: { value: 1 },
    };

    this.#buildBackdrop();
    this.#buildGlobe();
    this.#buildNetwork(0);
    this.#buildOrbits();
    this.#initAttention();

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.45, 0.12);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new ShaderPass(LensShader));
    this.composer.addPass(new OutputPass());
    this.focus = 1;
    this.focusTarget = 1;

    addEventListener('resize', () => this.#resize());
    addEventListener('pointermove', (e) => {
      this.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      this.lastPointer = performance.now();
      this.lastActivity = this.lastPointer;
    });
    this.#resize();
    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this.#frame());
    if (location.hash === '#debug') window.__oracle = this;
  }

  setState(s) {
    this.state = s;
  }

  setMood(mood) {
    const [a, b] = MOOD_COLORS[mood] || MOOD_COLORS.serene;
    this.mood = MOOD_COLORS[mood] ? mood : 'serene';
    this.targetA.set(a);
    this.targetB.set(b);
  }

  /** Recede into the background while a sheet (Library, Discover…) is open. */
  setFocus(on) {
    this.focusTarget = on ? 1 : 0;
  }

  setEnergy(v) {
    this.targetEnergy = Math.max(0, Math.min(1, v));
  }

  /** The app tells the eye what you're doing so it can pay attention. */
  notice(kind) {
    const now = performance.now();
    this.lastActivity = now;
    if (kind === 'typing') this.typingUntil = now + 1500;
  }

  /** How many works it has absorbed: each one becomes a node in its network of light. */
  setKnowledge(n) {
    n = Math.max(0, n | 0);
    if (n === this.knowledge) return;
    const grew = this.knowledge >= 0 && n > this.knowledge;
    this.#buildNetwork(n);
    if (grew) this.absorb();
  }

  /** A wave of light sweeps the globe toward the eye: something new has been taken in. */
  absorb() {
    this.absorbT = 0;
  }

  debugBlink() {
    this.blinkT = 0;
  }

  #resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // Keep the globe fully in frame on narrow screens, and above the conversation.
    const narrow = w / h < 0.8;
    this.baseZ = narrow ? 14.5 : 10.6;
    this.lookY = narrow ? -1.55 : -1.15;
    this.camera.position.set(0, this.lookY, this.baseZ);
    this.camera.lookAt(0, this.lookY, 0);
    this.camera.updateProjectionMatrix();
    this.u.uPixel.value = this.renderer.getPixelRatio() * (h / 900);
  }

  // ───────── The deep field: stars of data, a constellation network, streams and a grid ─────────
  #buildBackdrop() {
    const rand = rng(7);
    const u = this.u;

    // Soft radial light, used for the nebula behind the globe and the globe's inner core.
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    this.glowTex = new THREE.CanvasTexture(c);

    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: this.colorB, ...ADDITIVE, opacity: 0.3 }));
    this.halo.scale.setScalar(9);
    this.halo.position.z = -3;
    this.scene.add(this.halo);

    // Data dust: a sphere of faint twinkling points far around everything.
    {
      const n = this.mobile ? 1600 : 3200;
      const pos = new Float32Array(n * 3);
      const seed = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const d = randomDir(rand).multiplyScalar(22 + rand() * 50);
        pos.set([d.x, d.y, d.z], i * 3);
        seed[i] = rand();
      }
      this.stars = points(pos, { aSeed: [seed, 1] }, u, /* glsl */ `
        uniform float uTime, uPixel; uniform vec3 uColorA;
        attribute float aSeed; varying vec3 vColor; varying float vAlpha;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float tw = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * (0.4 + aSeed * 1.6) + aSeed * 90.0), 6.0);
          vColor = mix(uColorA, vec3(0.8, 0.9, 1.0), aSeed * 0.6) * 0.8;
          vAlpha = tw * (0.25 + aSeed * 0.5);
          gl_PointSize = (1.0 + aSeed * 2.2) * uPixel * (40.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`);
      this.scene.add(this.stars);
    }

    // Constellation network: distant nodes joined to their neighbours.
    {
      const n = this.mobile ? 90 : 160;
      const nodes = [];
      for (let i = 0; i < n; i++) nodes.push(new THREE.Vector3((rand() * 2 - 1) * 42, -8 + rand() * 34, -16 - rand() * 46));
      const lines = [];
      const lineSeed = [];
      nodes.forEach((a, i) => {
        let links = 0;
        for (let j = i + 1; j < n && links < 3; j++) {
          if (a.distanceTo(nodes[j]) < 11) {
            lines.push(a.x, a.y, a.z, nodes[j].x, nodes[j].y, nodes[j].z);
            const s = rand();
            lineSeed.push(s, s);
            links++;
          }
        }
      });
      const lgeo = new THREE.BufferGeometry();
      lgeo.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
      lgeo.setAttribute('aSeed', new THREE.Float32BufferAttribute(lineSeed, 1));
      const web = new THREE.LineSegments(lgeo, new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: /* glsl */ `
          attribute float aSeed; varying float vSeed;
          void main(){ vSeed = aSeed; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime, uThink; uniform vec3 uColorA; varying float vSeed;
          void main(){
            float p = 0.5 + 0.5 * sin(uTime * (0.3 + vSeed) + vSeed * 50.0);
            gl_FragColor = vec4(uColorA, (0.05 + 0.1 * p) * (1.0 + uThink));
          }`,
        ...ADDITIVE,
      }));
      const npos = new Float32Array(n * 3);
      const nseed = new Float32Array(n);
      nodes.forEach((v, i) => { npos.set([v.x, v.y, v.z], i * 3); nseed[i] = rand(); });
      const stars = points(npos, { aSeed: [nseed, 1] }, u, /* glsl */ `
        uniform float uTime, uPixel; uniform vec3 uColorA;
        attribute float aSeed; varying vec3 vColor; varying float vAlpha;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vColor = mix(uColorA, vec3(1.0), 0.4);
          vAlpha = 0.35 + 0.5 * pow(0.5 + 0.5 * sin(uTime * (0.5 + aSeed) + aSeed * 30.0), 4.0);
          gl_PointSize = (3.0 + aSeed * 3.0) * uPixel * (40.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`);
      this.constellation = new THREE.Group();
      this.constellation.add(web, stars);
      this.scene.add(this.constellation);
    }

    // Data streams: thin columns of light rising in the distance.
    {
      const cols = this.mobile ? 26 : 48;
      const per = 26;
      const pos = new Float32Array(cols * per * 3);
      const data = new Float32Array(cols * per * 3); // speed, place in column, seed
      let k = 0;
      for (let col = 0; col < cols; col++) {
        const x = (rand() * 2 - 1) * 38;
        const z = -14 - rand() * 30;
        const speed = 1.2 + rand() * 3;
        const offset = rand() * 40;
        const seed = rand();
        for (let i = 0; i < per; i++, k++) {
          pos.set([x, offset - i * 0.55, z], k * 3);
          data.set([speed, i / per, seed], k * 3);
        }
      }
      this.streams = points(pos, { aData: [data, 3] }, u, /* glsl */ `
        uniform float uTime, uPixel, uThink; uniform vec3 uColorA;
        attribute vec3 aData; varying vec3 vColor; varying float vAlpha;
        void main(){
          vec3 p = position;
          p.y = mod(p.y + uTime * aData.x * (1.0 + uThink * 1.5), 44.0) - 14.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float head = 1.0 - aData.y;
          vColor = mix(uColorA, vec3(0.85, 0.95, 1.0), head * head);
          vAlpha = head * head * (0.25 + 0.4 * aData.z) * smoothstep(-14.0, -6.0, p.y) * smoothstep(30.0, 18.0, p.y);
          gl_PointSize = (1.6 + head * 2.4) * uPixel * (40.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`);
      this.scene.add(this.streams);
    }

    // A holographic grid floor, sliding slowly toward you and fading into the dark.
    {
      const geo = new THREE.PlaneGeometry(160, 160, 1, 1);
      geo.rotateX(-Math.PI / 2);
      this.grid = new THREE.Mesh(geo, new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: /* glsl */ `
          varying vec3 vW;
          void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: /* glsl */ `
          uniform float uTime, uEnergy, uThink; uniform vec3 uColorA, uColorB; varying vec3 vW;
          float line(float x, float w){ float f = abs(fract(x - 0.5) - 0.5) / fwidth(x); return 1.0 - min(f / w, 1.0); }
          void main(){
            vec2 p = vW.xz / 1.6; p.y += uTime * 0.35;
            float g = max(line(p.x, 1.0), line(p.y, 1.0));
            float major = max(line(p.x / 5.0, 1.2), line(p.y / 5.0, 1.2));
            float dist = length(vW.xz - vec2(0.0, -2.0));
            float fade = smoothstep(55.0, 4.0, dist);
            float pulse = 0.5 + 0.5 * sin(dist * 0.6 - uTime * 1.6);
            vec3 col = mix(uColorB, uColorA, 0.5 + 0.5 * major) * (0.7 + 0.3 * pulse * (0.4 + uEnergy + uThink));
            gl_FragColor = vec4(col, (g * 0.35 + major * 0.55) * fade * 0.5);
          }`,
        ...ADDITIVE,
        side: THREE.DoubleSide,
      }));
      this.grid.position.y = -4.6;
      this.scene.add(this.grid);
    }
  }

  // ───────── The globe: points of light on a sphere, with an eye made of the same light ─────────
  #buildGlobe() {
    this.tilt = new THREE.Group(); // leans toward what the eye looks at
    this.spin = new THREE.Group(); // turns slowly, like a planet
    this.tilt.add(this.spin);
    this.scene.add(this.tilt);

    const n = this.mobile ? 12000 : 24000;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = golden * i;
      pos.set([Math.cos(th) * r * R, y * R, Math.sin(th) * r * R], i * 3);
      seed[i] = Math.random();
    }
    this.globe = points(pos, { aSeed: [seed, 1] }, { ...this.u, ...this.eyeU }, /* glsl */ `
      uniform float uTime, uEnergy, uThink, uListen, uPixel, uLid, uPupil, uAbsorb;
      uniform vec3 uGaze, uColorA, uColorB;
      attribute float aSeed;
      varying vec3 vColor; varying float vAlpha;
      ${NOISE}
      void main(){
        vec3 dir = normalize(position);
        // Continents of light that drift and reshape themselves, very slowly.
        float n1 = snoise(dir * 1.5 + vec3(uTime * 0.012, 0.0, -uTime * 0.008));
        float n2 = snoise(dir * 4.2 - uTime * 0.025);
        float land = smoothstep(0.02, 0.38, n1 + n2 * 0.22);

        // The eye lives where the globe faces its gaze, in world space, so the planet turns beneath it.
        vec3 w = normalize(mat3(modelMatrix) * dir);
        vec3 g = normalize(uGaze);
        vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), g));
        vec3 up = cross(g, rt);
        float fx = dot(w, rt), fy = dot(w, up), fz = dot(w, g);
        float front = step(0.0, fz);
        float ang = acos(clamp(fz, -1.0, 1.0));
        float ex = fx / 0.7;
        float ey = fy / max(0.36 * uLid, 0.004);
        float almond = 1.0 - (ex * ex + ey * ey);
        float inEye = smoothstep(0.0, 0.3, almond) * front;
        float rim = (1.0 - smoothstep(0.0, 0.16, abs(almond))) * front * (1.0 - smoothstep(0.85, 1.0, abs(ex)));
        float irisR = 0.29;
        float pupilR = 0.07 + 0.08 * uPupil;
        // A catchlight: the reflection of a light, up and to the left of the pupil.
        float catchL = (1.0 - smoothstep(0.02, 0.045, length(vec2(fx + 0.09, fy - 0.08)))) * inEye;
        float iris = (1.0 - smoothstep(irisR - 0.035, irisR, ang)) * smoothstep(pupilR, pupilR + 0.03, ang) * inEye;
        float pupil = (1.0 - smoothstep(pupilR - 0.01, pupilR + 0.01, ang)) * inEye;
        float limbal = (1.0 - smoothstep(0.0, 0.03, abs(ang - irisR))) * inEye;
        float fibres = 0.55 + 0.45 * sin(atan(fy, fx) * 46.0 + n2 * 4.0 + uTime * 0.2);

        // Shape: the cornea bulges, the pupil sinks, the voice ripples out from the eye.
        float r = 1.0;
        r += inEye * 0.07 * (1.0 - smoothstep(0.0, irisR * 1.3, ang));
        r -= pupil * 0.05;
        r += uEnergy * 0.07 * sin(ang * 16.0 - uTime * 9.0) * (1.0 - inEye) * smoothstep(3.0, 0.3, ang);
        r += uThink * 0.035 * snoise(dir * 5.0 + uTime * 0.8);
        r += uListen * 0.012 * sin(uTime * 2.0 + ang * 6.0);
        // Absorbing something new: a wave runs from the back of the globe into the eye.
        float wave = uAbsorb < 1.0 ? exp(-pow((ang - (1.0 - uAbsorb) * 3.3) * 6.0, 2.0)) * (1.0 - uAbsorb * 0.7) : 0.0;
        r += wave * 0.08;
        vec3 p = dir * ${R.toFixed(2)} * r;

        float tw = pow(0.5 + 0.5 * sin(uTime * (0.5 + aSeed * 2.5) + aSeed * 70.0), 18.0);
        vec3 col = mix(uColorB * 0.3, uColorA, land) * (0.3 + 0.6 * land);
        col += vec3(0.65, 0.88, 1.0) * tw * (0.5 + land);
        // The eye: a dim field, a luminous fibrous iris, a bright limbal ring, a dark pupil, a glowing lid line.
        col = mix(col, uColorB * 0.06, inEye);
        col += mix(uColorA, vec3(0.85, 0.97, 1.0), 0.35 + 0.4 * fibres) * (1.2 + 3.0 * fibres) * iris;
        col += mix(uColorA, vec3(1.0), 0.3) * 3.5 * limbal;
        col += mix(uColorA, vec3(1.0), 0.35) * 2.6 * rim;
        col = mix(col, vec3(0.0), pupil);
        col += vec3(1.0) * 4.0 * catchL;
        col += vec3(0.7, 0.9, 1.0) * wave * 1.5;
        col *= 0.85 + uEnergy * 0.7 + uThink * 0.25;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float facing = smoothstep(-0.35, 0.55, normalize(normalMatrix * dir).z);
        vColor = col;
        // Points on the far side fade almost away, and never show through the eye.
        vAlpha = mix(0.05, 1.0, facing);
        float size = 1.1 + land * 1.0 + tw * 2.2 + iris * (1.2 + fibres * 1.6) + limbal * 2.0 + rim * 2.2 + catchL * 3.0 + wave * 2.5;
        size *= (1.0 - pupil * 0.85) * (1.0 - (inEye - iris - limbal) * 0.45);
        gl_PointSize = size * uPixel * (10.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`);
    this.spin.add(this.globe);

    // A thin atmosphere: light gathered at the edge of the sphere.
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.06, 64, 64), new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        uniform float uEnergy, uThink; uniform vec3 uColorA, uColorB; varying vec3 vN; varying vec3 vV;
        void main(){
          float f = pow(1.0 - abs(dot(vN, vV)), 3.5);
          gl_FragColor = vec4(mix(uColorB, uColorA, f), f * (0.35 + uEnergy * 0.4 + uThink * 0.15));
        }`,
      ...ADDITIVE,
    }));
    this.tilt.add(atmo);

    // A soft inner light, and a swarm of particles inside it, so the globe has depth.
    this.core = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: this.colorB, ...ADDITIVE, opacity: 0.3 }));
    this.core.scale.setScalar(R * 2.6);
    this.tilt.add(this.core);

    const m = this.mobile ? 900 : 1800;
    const ipos = new Float32Array(m * 3);
    const iseed = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      const d = randomDir(Math.random).multiplyScalar(Math.cbrt(Math.random()) * R * 0.9);
      ipos.set([d.x, d.y, d.z], i * 3);
      iseed[i] = Math.random();
    }
    this.inner = points(ipos, { aSeed: [iseed, 1] }, this.u, /* glsl */ `
      uniform float uTime, uPixel, uThink, uEnergy; uniform vec3 uColorA, uColorB;
      attribute float aSeed; varying vec3 vColor; varying float vAlpha;
      void main(){
        float a = uTime * (0.08 + aSeed * 0.25) * (1.0 + uThink * 3.0);
        mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));
        vec3 p = position; p.xz = rot * p.xz;
        p *= 1.0 + uEnergy * 0.15 * sin(uTime * 6.0 + aSeed * 20.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vColor = mix(uColorB, uColorA, aSeed);
        vAlpha = 0.12 + 0.2 * aSeed + uThink * 0.25;
        gl_PointSize = (1.0 + aSeed * 1.8) * uPixel * (10.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`);
    this.spin.add(this.inner);
  }

  // ───────── The knowledge network: nodes for the works it has read, arcs of thought between ─────────
  #buildNetwork(k) {
    if (this.network) {
      this.spin.remove(this.network);
      this.network.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    }
    this.knowledge = k;
    const rand = rng(1234);
    const count = Math.min(14 + k * 3, 120);
    const nodes = [];
    for (let i = 0; i < count; i++) nodes.push(randomDir(rand));

    const SEG = 40;
    const pos = [];
    const attr = []; // place along the arc, phase, speed
    const arcs = Math.min(Math.round(count * 1.5), 170);
    for (let a = 0; a < arcs; a++) {
      const i = Math.floor(rand() * count);
      const j = (i + 1 + Math.floor(rand() * (count - 1))) % count;
      const A = nodes[i];
      const B = nodes[j];
      const ang = A.angleTo(B);
      const phase = rand();
      const speed = 0.12 + rand() * 0.3;
      if (ang < 0.25 || ang > 2.4) continue;
      let prev = null;
      for (let s = 0; s <= SEG; s++) {
        const t = s / SEG;
        const v = A.clone().lerp(B, t).normalize().multiplyScalar(R * (1.01 + Math.sin(Math.PI * t) * 0.22 * ang));
        if (prev) {
          pos.push(prev.x, prev.y, prev.z, v.x, v.y, v.z);
          attr.push((s - 1) / SEG, phase, speed, t, phase, speed);
        }
        prev = v;
      }
    }
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    lgeo.setAttribute('aArc', new THREE.Float32BufferAttribute(attr, 3));
    const arcsMesh = new THREE.LineSegments(lgeo, new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: /* glsl */ `
        attribute vec3 aArc; varying vec3 vArc; varying float vFacing;
        void main(){
          vArc = aArc;
          vFacing = smoothstep(-0.3, 0.5, normalize(normalMatrix * position).z);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uThink, uEnergy; uniform vec3 uColorA; varying vec3 vArc; varying float vFacing;
        void main(){
          float head = fract(uTime * vArc.z * (1.0 + uThink * 3.0 + uEnergy) + vArc.y) * 1.6 - 0.3;
          float d = head - vArc.x;
          float trail = smoothstep(0.3, 0.0, d) * step(0.0, d);
          vec3 col = mix(uColorA, vec3(0.9, 0.97, 1.0), trail);
          gl_FragColor = vec4(col, (0.05 + uThink * 0.1 + trail * 0.55) * mix(0.2, 1.0, vFacing));
        }`,
      ...ADDITIVE,
    }));

    const npos = new Float32Array(count * 3);
    const nidx = new Float32Array(count);
    nodes.forEach((v, i) => { npos.set([v.x * R * 1.012, v.y * R * 1.012, v.z * R * 1.012], i * 3); nidx[i] = i; });
    const nodesMesh = points(npos, { aIdx: [nidx, 1] }, { ...this.u, ...this.eyeU, uNewest: { value: k > 0 ? count - 1 : -10 } }, /* glsl */ `
      uniform float uTime, uPixel, uThink, uAbsorb, uNewest; uniform vec3 uColorA;
      attribute float aIdx; varying vec3 vColor; varying float vAlpha;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float beat = 0.5 + 0.5 * sin(uTime * (1.2 + uThink * 3.0) + aIdx * 2.3);
        float fresh = aIdx > uNewest - 2.5 ? (1.0 - uAbsorb) : 0.0;
        vColor = mix(uColorA, vec3(1.0), 0.55 + 0.45 * fresh);
        vAlpha = mix(0.15, 1.0, smoothstep(-0.3, 0.5, normalize(normalMatrix * position).z)) * (0.6 + 0.4 * beat);
        gl_PointSize = (4.0 + beat * 2.5 + fresh * 10.0) * uPixel * (10.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`);

    this.network = new THREE.Group();
    this.network.add(arcsMesh, nodesMesh);
    this.spin.add(this.network);
  }

  // ───────── Orbits: rings of data circling the globe, each carrying bright satellites ─────────
  #buildOrbits() {
    this.orbits = [];
    const defs = [
      { r: R * 1.32, tilt: [1.25, 0.2], n: 520, sats: 3, speed: 0.12 },
      { r: R * 1.55, tilt: [1.62, -0.45], n: 640, sats: 2, speed: -0.08 },
      { r: R * 1.85, tilt: [1.4, 0.7], n: 760, sats: 5, speed: 0.05 },
    ];
    for (const d of defs) {
      const pos = new Float32Array(d.n * 3);
      const ang = new Float32Array(d.n);
      for (let i = 0; i < d.n; i++) {
        const a = (i / d.n) * Math.PI * 2;
        pos.set([Math.cos(a) * d.r, Math.sin(a) * d.r, 0], i * 3);
        ang[i] = a;
      }
      const ring = points(pos, { aAng: [ang, 1] }, { ...this.u, uSats: { value: d.sats }, uSpeed: { value: d.speed * 6 } }, /* glsl */ `
        uniform float uTime, uPixel, uThink, uSats, uSpeed; uniform vec3 uColorA, uColorB;
        attribute float aAng; varying vec3 vColor; varying float vAlpha;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float sat = pow(max(cos(aAng * uSats - uTime * uSpeed * (1.0 + uThink * 2.0)), 0.0), 120.0);
          float dash = step(0.5, fract(aAng * 60.0 / 6.2831));
          vColor = mix(uColorB, mix(uColorA, vec3(1.0), sat), 0.4 + 0.6 * sat);
          vec3 centre = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float front = smoothstep(-0.6, 0.6, normalize(mv.xyz - centre).z);
          vAlpha = (0.12 + 0.18 * dash + sat) * mix(0.35, 1.0, front);
          gl_PointSize = (1.0 + sat * 5.0) * uPixel * (10.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`);
      ring.rotation.set(d.tilt[0], d.tilt[1], 0);
      ring.userData.speed = d.speed;
      this.tilt.add(ring);
      this.orbits.push(ring);
    }
  }

  // ───────── Attention: where it looks, when it blinks, how open its eye is ─────────
  #initAttention() {
    this.gaze = new THREE.Vector2();
    this.gazeTarget = new THREE.Vector2();
    this.tremor = new THREE.Vector2();
    this.nextSaccade = 0;
    this.nextBlink = 1.2;
    this.blinkT = -1;
    this.doubleBlink = false;
    this.lidBase = 0.85;
    this.pupil = 0.5;
    this.lastActivity = performance.now();
    this.lastPointer = 0;
    this.typingUntil = 0;
    this.toCam = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.upv = new THREE.Vector3();
  }

  #attention(dt, t) {
    const now = performance.now();
    const s = this.state;
    const idleFor = (now - this.lastActivity) / 1000;
    const r = Math.random;

    if (t > this.nextSaccade) {
      let tx;
      let ty;
      let hold;
      if (s === 'thinking') {
        // Looks up and away while it thinks, as people do.
        tx = (r() < 0.5 ? -1 : 1) * (0.35 + r() * 0.35);
        ty = 0.45 + r() * 0.3;
        hold = 0.7 + r() * 1.6;
      } else if (now < this.typingUntil) {
        tx = (r() - 0.5) * 0.3;
        ty = -0.7;
        hold = 0.3 + r() * 0.7;
      } else if (s === 'listening' || s === 'speaking') {
        // Holds your gaze, with small natural shifts.
        tx = this.pointer.x * 0.15 + (r() - 0.5) * 0.12;
        ty = this.pointer.y * 0.1 + (r() - 0.5) * 0.08;
        hold = 0.6 + r() * 2.2;
      } else if (now - this.lastPointer < 2000) {
        tx = this.pointer.x * 0.85;
        ty = this.pointer.y * 0.65;
        hold = 0.25 + r() * 0.6;
      } else if (idleFor > 12) {
        // You went quiet: it wonders around the room.
        tx = (r() * 2 - 1) * 0.9;
        ty = (r() * 2 - 1) * 0.45 + 0.1;
        hold = 1 + r() * 3.5;
      } else {
        tx = (r() - 0.5) * 0.25;
        ty = (r() - 0.5) * 0.18;
        hold = 1.4 + r() * 3;
      }
      this.gazeTarget.set(tx, ty);
      this.nextSaccade = t + hold;
    }
    // Saccades are fast; fixations tremble very slightly.
    this.gaze.lerp(this.gazeTarget, 1 - Math.exp(-dt * 20));
    this.tremor.set(Math.sin(t * 23.1) + Math.sin(t * 37.7), Math.cos(t * 19.3) + Math.sin(t * 41.9)).multiplyScalar(0.0035);

    // Blinks at a human rate, occasionally doubled; less often while speaking or deep in thought.
    if (this.blinkT < 0 && t > this.nextBlink) {
      this.blinkT = 0;
      const gap = s === 'speaking' || s === 'thinking' ? 4 + r() * 5 : 2 + r() * 4.5;
      this.doubleBlink = !this.doubleBlink && r() < 0.15;
      this.nextBlink = t + (this.doubleBlink ? 0.32 : gap);
    }
    let blink = 1;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const close = 0.07;
      const open = 0.16;
      if (this.blinkT < close) blink = 1 - this.blinkT / close;
      else if (this.blinkT < close + open) blink = (this.blinkT - close) / open;
      else this.blinkT = -1;
      blink = Math.max(0, Math.min(1, blink));
    }

    const moodLid = { grave: 0.72, fierce: 0.68, melancholic: 0.7, awed: 1.08, joyful: 0.9, curious: 1.0 }[this.mood] ?? 0.88;
    const stateLid = { thinking: 0.62, listening: 1.05, speaking: 0.92 }[s] ?? 0.9;
    const drowsy = s === 'idle' && idleFor > 45 ? 0.6 : 1;
    this.lidBase += (moodLid * stateLid * drowsy - this.lidBase) * Math.min(1, dt * 3);
    this.eyeU.uLid.value = this.lidBase * blink;

    const pupilTarget = (s === 'listening' ? 0.75 : s === 'thinking' ? 0.3 : 0.5) + (this.mood === 'awed' ? 0.25 : this.mood === 'fierce' ? -0.2 : 0) + this.energy * 0.25;
    this.pupil += (pupilTarget - this.pupil) * Math.min(1, dt * 2.5);
    this.eyeU.uPupil.value = this.pupil;

    // Turn the gaze into a direction in the world, relative to where you (the camera) are.
    const gx = this.gaze.x + this.tremor.x;
    const gy = this.gaze.y + this.tremor.y;
    this.toCam.subVectors(this.camera.position, this.tilt.position).normalize();
    this.right.crossVectors(THREE.Object3D.DEFAULT_UP, this.toCam).normalize();
    this.upv.crossVectors(this.toCam, this.right);
    this.eyeU.uGaze.value.copy(this.toCam).addScaledVector(this.right, gx * 0.6).addScaledVector(this.upv, gy * 0.5).normalize();

    // The head follows the eyes, a little behind.
    this.tilt.rotation.y += (gx * 0.22 - this.tilt.rotation.y) * Math.min(1, dt * 2);
    this.tilt.rotation.x += (-gy * 0.16 - this.tilt.rotation.x) * Math.min(1, dt * 2);
  }

  #frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    const s = this.state;
    const u = this.u;

    this.colorA.lerp(this.targetA, dt * 1.5);
    this.colorB.lerp(this.targetB, dt * 1.5);
    this.energy += (this.targetEnergy - this.energy) * Math.min(1, dt * 18);
    u.uTime.value = t;
    u.uEnergy.value = this.energy;
    u.uThink.value += ((s === 'thinking' ? 1 : 0) - u.uThink.value) * dt * 3;
    u.uListen.value += ((s === 'listening' ? 1 : 0) - u.uListen.value) * dt * 3;
    if (this.absorbT < 1) this.absorbT = Math.min(1, this.absorbT + dt / 2.6);
    this.eyeU.uAbsorb.value = this.absorbT;

    this.#attention(dt, t);

    // The planet turns, faster when the mind works, and breathes.
    const think = u.uThink.value;
    this.spin.rotation.y += dt * (0.05 + think * 0.25 + this.energy * 0.1);
    this.tilt.scale.setScalar(1 + Math.sin(t * 0.8) * 0.01 + this.energy * 0.03);
    this.tilt.position.y = Math.sin(t * 0.5) * 0.04;
    for (const o of this.orbits) o.rotation.z += dt * o.userData.speed * (1 + think * 2);

    this.constellation.rotation.y = Math.sin(t * 0.02) * 0.15;
    this.stars.rotation.y = t * 0.004;

    this.focus += (this.focusTarget - this.focus) * Math.min(1, dt * 3);
    this.bloom.strength = (0.65 + this.energy * 0.5 + think * 0.25) * (0.45 + this.focus * 0.55);
    this.halo.material.opacity = (0.13 + this.energy * 0.15 + think * 0.06) * (0.4 + this.focus * 0.6);
    this.halo.scale.setScalar(9 + Math.sin(t * 0.6) * 0.4 + this.energy * 2);
    this.core.material.opacity = 0.08 + this.energy * 0.2 + think * 0.08;
    // A slow parallax drift, so the space feels deep.
    this.camera.position.set(Math.sin(t * 0.07) * 0.25 + this.pointer.x * 0.15, this.lookY, this.baseZ + (1 - this.focus) * 4);
    this.camera.lookAt(0, this.lookY, 0);

    this.composer.render();
  }
}
