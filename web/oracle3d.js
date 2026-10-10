// The Oracle's body: a crystal globe with living energy inside and a real,
// physically lit eye set into its face — eyeball, wet sclera, refracting cornea,
// 3D eyelids — driven by an attention system that moves it like a living thing.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Cinematic finish: a touch of chromatic fringe toward the edges and a vignette.
const LensShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 0.0007 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5; float d = dot(c, c);
      vec2 off = c * d * uAmount * 40.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= smoothstep(0.9, 0.12, d * 1.5);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export const MOOD_COLORS = {
  serene: ['#d4ff3a', '#3a6bff'],
  compassionate: ['#ff9ec7', '#ffcf8a'],
  joyful: ['#ffe066', '#ff8a3d'],
  grave: ['#5b6cff', '#1c2a6b'],
  fierce: ['#ff4d3d', '#ffb02e'],
  curious: ['#4dffc3', '#5ba8ff'],
  melancholic: ['#7d8cff', '#b48aff'],
  awed: ['#ffffff', '#c9a6ff'],
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

// Eye geometry (scene units). The eyeball sits in the globe's face, slightly proud of it.
const EYE_R = 0.4;          // eyeball radius
const HOLE = 0.5;           // angular radius of the iris opening in the sclera
const LID_R = 0.428;        // eyelids ride just outside the eyeball
const CLOSED = -0.06;       // lid edge elevation (radians) when shut — a hair below centre

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
    this.mobile = Math.min(innerWidth, innerHeight) < 700;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, this.mobile ? 1.5 : 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    // A soft studio for reflections: the glass and the wet eye mirror it like real surfaces.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);

    this.#buildLights();
    this.#buildCosmos();
    this.#buildGlobe();
    this.#buildEye();
    this.#buildRings();
    this.#buildDust();
    this.#initAttention();

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, this.camera));
    // Only genuinely bright things glow: specular highlights, the inner light, the lash line.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.6, 0.72);
    this.composer.addPass(this.bloom);
    this.lens = new ShaderPass(LensShader);
    this.composer.addPass(this.lens);
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

  #resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // Keep the globe fully in frame on narrow screens, and above the conversation.
    const narrow = w / h < 0.8;
    this.baseZ = narrow ? 13.5 : 9.6;
    this.camera.position.set(0, narrow ? -1.55 : -1.15, this.baseZ);
    this.camera.lookAt(0, narrow ? -1.55 : -1.15, 0);
    this.camera.updateProjectionMatrix();
  }

  #buildLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.08));
    // Key light: soft, warm, from above-left like a window.
    const key = new THREE.DirectionalLight(0xfff1e0, 2.2);
    key.position.set(-3, 4, 5);
    this.scene.add(key);
    // Rim light in the mood colour, from behind — separates the globe from space.
    this.rim = new THREE.PointLight(this.colorA, 18, 12, 2);
    this.rim.position.set(0.6, 0.9, -4.5);
    this.scene.add(this.rim);
  }

  #buildCosmos() {
    const mat = new THREE.ShaderMaterial({
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uA: { value: this.colorA }, uB: { value: this.colorB } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.999,1.0);} `,
      fragmentShader: `${NOISE}
        uniform float uTime; uniform vec3 uA; uniform vec3 uB; varying vec2 vUv;
        void main(){
          vec2 p=vUv-0.5;
          float n=snoise(vec3(p*1.8,uTime*0.02))*0.5+0.5;
          float n2=snoise(vec3(p*4.0+7.0,uTime*0.03))*0.5+0.5;
          float v=1.0-smoothstep(0.0,0.8,length(p));
          vec3 col=mix(vec3(0.012,0.013,0.016),mix(uA,uB,n2)*0.05,n*v*0.8);
          gl_FragColor=vec4(col,1.0);
        }`,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    quad.renderOrder = -1;
    this.cosmos = mat;
    this.scene.add(quad);
  }

  #buildGlobe() {
    // Everything that turns as one "head".
    this.head = new THREE.Group();
    this.scene.add(this.head);

    // Living energy inside the globe: slow currents that quicken when it thinks or speaks.
    // Opaque on purpose — the glass refracts only opaque things behind it.
    this.coreUniforms = {
      uTime: { value: 0 }, uEnergy: { value: 0 }, uThink: { value: 0 },
      uA: { value: this.colorA }, uB: { value: this.colorB },
    };
    this.inner = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.2, this.mobile ? 40 : 64),
      new THREE.ShaderMaterial({
        uniforms: this.coreUniforms,
        vertexShader: `${NOISE}
          uniform float uTime; uniform float uEnergy; uniform float uThink;
          varying vec3 vNormal; varying vec3 vView; varying vec3 vPos;
          void main(){
            float d = snoise(normal*1.6+uTime*0.18)*0.05 + snoise(normal*4.0+uTime*(0.6+uThink*1.5))*(0.015+uEnergy*0.09);
            vec3 pos = position + normal*d;
            vPos = position;
            vec4 mv = modelViewMatrix*vec4(pos,1.0);
            vNormal = normalize(normalMatrix*normal); vView = normalize(-mv.xyz);
            gl_Position = projectionMatrix*mv;
          }`,
        fragmentShader: `${NOISE}
          uniform float uTime; uniform vec3 uA; uniform vec3 uB; uniform float uEnergy; uniform float uThink;
          varying vec3 vNormal; varying vec3 vView; varying vec3 vPos;
          void main(){
            float facing = max(dot(vNormal, vView), 0.0);
            vec3 q = vPos*1.6 + vec3(0.0, uTime*0.05, 0.0);
            // Soft, deep mist…
            float mist = snoise(q*0.7 + uTime*0.03)*0.5 + 0.5;
            // …threaded with fine currents of light, like aurora seen from far away.
            float f = snoise(q*1.3 + snoise(q*2.1 + uTime*0.08)*0.8);
            float threads = pow(1.0 - abs(f), 14.0);
            float glow = 0.25 + uEnergy*0.9 + uThink*0.4;
            vec3 col = mix(vec3(0.006, 0.008, 0.016), uB*0.2, mist * (0.4 + 0.6*facing));
            col += mix(uB, uA, threads) * threads * glow * 1.1;
            col += mix(uB, uA, 0.3) * pow(1.0 - facing, 2.5) * 0.18;  // inner rim light
            col += uA * pow(facing, 8.0) * uEnergy * 0.2;       // brightens toward you when it speaks
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.head.add(this.inner);

    // The globe itself: clear glass with a thin-film sheen, reflecting the studio.
    this.globeUniforms = { uTime: { value: 0 }, uEnergy: { value: 0 } };
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.04,
      transmission: 1,
      thickness: 0.6,
      ior: 1.45,
      attenuationColor: this.colorB,
      attenuationDistance: 3.2,
      iridescence: 0.35,
      iridescenceIOR: 1.35,
      iridescenceThicknessRange: [180, 520],
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      specularIntensity: 1,
      envMapIntensity: 0.75,
    });
    // A barely-there ripple on the surface, so it reads as alive rather than blown glass.
    glass.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.globeUniforms.uTime;
      shader.uniforms.uEnergy = this.globeUniforms.uEnergy;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uTime; uniform float uEnergy;\n${NOISE}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          transformed += normal * snoise(normal*2.2 + uTime*0.25) * (0.008 + uEnergy*0.025);`);
    };
    this.glass = glass;
    this.globe = new THREE.Mesh(new THREE.SphereGeometry(1.35, this.mobile ? 96 : 128, this.mobile ? 64 : 96), glass);
    this.head.add(this.globe);

    // A soft halo in space behind it.
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,255,255,0.5)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.08)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    this.aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), color: this.colorB, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35 }));
    this.aura.scale.setScalar(6.5);
    this.aura.position.z = -1.5;
    this.scene.add(this.aura);
  }

  /** A painted sclera: warm white with fine vessels, darkening toward the back of the eye. */
  #scleraTexture() {
    const W = 1024;
    const H = 512;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    // Canvas top = front of the eye (around the iris), bottom = back.
    const base = g.createLinearGradient(0, 0, 0, H);
    base.addColorStop(0, '#e2d9cf');
    base.addColorStop(0.22, '#dcd1c5');
    base.addColorStop(0.5, '#c9b9ae');
    base.addColorStop(1, '#6b5a55');
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);
    // Faint blotchy tone variation.
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(${200 + Math.random() * 40},${150 + Math.random() * 40},${140 + Math.random() * 40},0.035)`;
      g.beginPath();
      g.arc(Math.random() * W, H * 0.15 + Math.random() * H * 0.85, 10 + Math.random() * 40, 0, Math.PI * 2);
      g.fill();
    }
    // Vessels: start toward the back and wander forward, branching and fading.
    const vessel = (x, y, w, life) => {
      let a = -Math.PI / 2 + (Math.random() - 0.5) * 0.8;
      g.lineCap = 'round';
      for (let s = 0; s < life; s++) {
        const nx = x + Math.cos(a) * 6;
        const ny = y + Math.sin(a) * 6;
        const alpha = Math.min(0.55, 0.15 + (y / H) * 0.6) * (1 - s / life);
        g.strokeStyle = `rgba(${150 + Math.random() * 40},${30 + Math.random() * 25},${40 + Math.random() * 20},${alpha})`;
        g.lineWidth = w * (1 - s / life) + 0.3;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(nx, ny);
        g.stroke();
        x = (nx + W) % W;
        y = ny;
        a += (Math.random() - 0.5) * 0.5;
        if (y < H * 0.16) break;
        if (Math.random() < 0.04 && w > 0.8) vessel(x, y, w * 0.6, life * 0.5);
      }
    };
    for (let i = 0; i < 26; i++) vessel(Math.random() * W, H * (0.55 + Math.random() * 0.4), 1.6 + Math.random() * 1.6, 40 + Math.random() * 50);
    // A soft shadowed ring around the iris (the limbal area).
    const limb = g.createLinearGradient(0, H * 0.14, 0, H * 0.24);
    limb.addColorStop(0, 'rgba(70,60,70,0.55)');
    limb.addColorStop(1, 'rgba(70,60,70,0)');
    g.fillStyle = limb;
    g.fillRect(0, H * 0.14, W, H * 0.1);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  #buildEye() {
    // The socket: where the eye sits in the globe's face. It turns with the head.
    this.socket = new THREE.Group();
    this.socket.position.set(0, 0.16, 0.98);
    this.head.add(this.socket);

    // The eyeball turns inside the socket (this is what "looking" is).
    this.eyeball = new THREE.Group();
    this.socket.add(this.eyeball);

    // Sclera: a sphere with an opening at the front where the iris shows through.
    const scleraGeo = new THREE.SphereGeometry(EYE_R, 96, 64, 0, Math.PI * 2, HOLE, Math.PI - HOLE);
    scleraGeo.rotateX(Math.PI / 2); // pole → +z (front)
    const sclera = new THREE.Mesh(scleraGeo, new THREE.MeshPhysicalMaterial({
      map: this.#scleraTexture(),
      roughness: 0.42,
      clearcoat: 1,
      clearcoatRoughness: 0.08, // the tear film: wet, glossy
      sheen: 0.2,
      sheenColor: new THREE.Color(0xffe8e0),
      envMapIntensity: 0.55,
    }));
    this.eyeball.add(sclera);

    // Iris: a disc just inside the opening, fibrous and alive; the pupil breathes.
    const irisR = EYE_R * Math.sin(HOLE);
    const irisZ = EYE_R * Math.cos(HOLE) - 0.012;
    this.irisUniforms = {
      uTime: { value: 0 }, uA: { value: this.colorA }, uB: { value: this.colorB },
      uPupil: { value: 0.36 }, uLid: { value: 0.5 },
    };
    const iris = new THREE.Mesh(
      new THREE.CircleGeometry(irisR, 128),
      new THREE.ShaderMaterial({
        uniforms: this.irisUniforms,
        vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
        fragmentShader: `
          uniform float uTime; uniform vec3 uA; uniform vec3 uB; uniform float uPupil; uniform float uLid;
          varying vec2 vUv;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
          float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
            return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
          float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*vnoise(p); p*=2.03; a*=0.5; } return v; }
          void main(){
            vec2 p = vUv - 0.5;
            float r = length(p) * 2.0;            // 0 centre → 1 edge
            float a = atan(p.y, p.x);
            // Natural iris base (amber-hazel) tinted by the Oracle's mood.
            vec3 natural = mix(vec3(0.28,0.18,0.08), vec3(0.55,0.42,0.18), r);
            vec3 base = mix(natural, mix(uB, uA, r*0.8+0.2), 0.62);
            // Radial stroma fibres, crypts and a lighter collarette.
            float fib = fbm(vec2(a*9.0, r*3.0)) * 0.6 + fbm(vec2(a*31.0, r*9.0)) * 0.4;
            float crypt = smoothstep(0.62, 0.8, fbm(vec2(a*5.0+2.0, r*4.0)));
            vec3 col = base * (0.55 + fib * 0.75);
            col *= 1.0 - crypt * 0.45;
            col += uA * 0.28 * smoothstep(0.1, 0.0, abs(r - (uPupil + 0.17)));
            col *= 1.0 - 0.8 * smoothstep(0.82, 1.0, r);          // dark limbal ring
            float pupil = 1.0 - smoothstep(uPupil - 0.025, uPupil + 0.015, r);
            col = mix(col, vec3(0.004), pupil);
            // The upper lid shades the top of the iris.
            col *= mix(1.0, 0.55, smoothstep(-0.1, 0.5, p.y * 2.0) * uLid);
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    iris.position.z = irisZ;
    this.eyeball.add(iris);

    // Cornea: a clear dome over the iris that bends light — the source of an eye's depth and wet highlights.
    const cornR = 0.245;
    const cornCap = Math.asin(Math.min(1, irisR / cornR));
    const corneaGeo = new THREE.SphereGeometry(cornR, 64, 32, 0, Math.PI * 2, 0, cornCap);
    corneaGeo.rotateX(Math.PI / 2);
    const cornea = new THREE.Mesh(corneaGeo, new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0,
      metalness: 0,
      transmission: 1,
      thickness: 0.06,
      ior: 1.376,
      specularIntensity: 1,
      clearcoat: 1,
      clearcoatRoughness: 0,
      envMapIntensity: 2.2,
      transparent: true,
    }));
    cornea.position.z = EYE_R * Math.cos(HOLE) - cornR * Math.cos(cornCap);
    this.eyeball.add(cornea);

    // Eyelids: two shells around the eyeball that rotate shut, made of the globe's own skin,
    // each with a softly glowing lash line along its edge.
    const lidMat = new THREE.MeshPhysicalMaterial({
      color: 0x0c0e14,
      roughness: 0.55,
      metalness: 0.05,
      clearcoat: 0.5,
      clearcoatRoughness: 0.3,
      sheen: 0.45,
      sheenColor: this.colorA,
      sheenRoughness: 0.45,
      side: THREE.DoubleSide,
      envMapIntensity: 0.7,
    });
    this.lashMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: this.colorA, emissiveIntensity: 1.6, roughness: 0.4 });
    const makeLid = (phiStart) => {
      const geo = new THREE.SphereGeometry(LID_R, 96, 48, phiStart, Math.PI, 0, Math.PI);
      geo.rotateZ(Math.PI / 2); // wedge hinges around the x-axis
      const lid = new THREE.Mesh(geo, lidMat);
      const lash = new THREE.Mesh(new THREE.TorusGeometry(LID_R + 0.002, 0.007, 8, 96, Math.PI), this.lashMat);
      lash.rotation.x = Math.PI / 2; // the lid's front edge: a half-circle in the horizontal plane
      lid.add(lash);
      this.socket.add(lid);
      return lid;
    };
    this.upperLid = makeLid(Math.PI / 2);     // front → over the top → back
    this.lowerLid = makeLid(Math.PI * 1.5);   // back → under the bottom → front
  }

  #buildRings() {
    // Fine orbits of light — thinner and quieter than before, more like dust lanes than wire.
    this.rings = [];
    const specs = [
      [2.1, 0.0035, [1.25, 0.2, 0]],
      [2.45, 0.003, [0.3, 1.1, 0.4]],
      [2.85, 0.0025, [-0.6, 0.4, 1.0]],
    ];
    for (const [r, t, rot] of specs) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r, t, 6, 360),
        new THREE.MeshBasicMaterial({ color: this.colorB, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      ring.rotation.set(...rot);
      const beads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.014, 8, 8), new THREE.MeshBasicMaterial({ color: this.colorA, transparent: true, opacity: 0.55 }), 9);
      const m = new THREE.Matrix4();
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + Math.random() * 0.3;
        m.makeTranslation(Math.cos(a) * r, Math.sin(a) * r, 0);
        beads.setMatrixAt(i, m);
      }
      ring.add(beads);
      this.scene.add(ring);
      this.rings.push(ring);
    }
  }

  #buildDust() {
    const n = this.mobile ? 1600 : 2600;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = 2.3 + Math.random() * 5;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th) * 0.6, r * Math.cos(ph)], i * 3);
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.dustUniforms = { uTime: { value: 0 }, uPull: { value: 0 }, uA: { value: this.colorA }, uB: { value: this.colorB } };
    this.dust = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: this.dustUniforms,
        vertexShader: `
          uniform float uTime; uniform float uPull; attribute float aSeed; varying float vSeed;
          void main(){
            vSeed=aSeed; vec3 p=position;
            float a=uTime*(0.03+aSeed*0.05)*(1.0+uPull*3.0);
            p.xz=mat2(cos(a),-sin(a),sin(a),cos(a))*p.xz;
            p*=1.0-uPull*0.2*aSeed;
            vec4 mv=modelViewMatrix*vec4(p,1.0);
            gl_PointSize=(0.8+aSeed*1.8)*(8.0/-mv.z)*(0.8+0.4*sin(uTime*1.5+aSeed*40.0));
            gl_Position=projectionMatrix*mv;
          }`,
        fragmentShader: `
          uniform vec3 uA; uniform vec3 uB; varying float vSeed;
          void main(){ float d=length(gl_PointCoord-0.5); if(d>0.5) discard;
            gl_FragColor=vec4(mix(vec3(1.0),mix(uA,uB,vSeed),0.6),(0.5-d)*0.9); }`,
      }),
    );
    this.scene.add(this.dust);
  }

  // ───────────────────────────── Attention ─────────────────────────────

  #initAttention() {
    this.gaze = new THREE.Vector2();
    this.gazeTarget = new THREE.Vector2();
    this.gazeFrom = new THREE.Vector2();
    this.saccadeT = 1;
    this.nextGlance = 1.5;
    this.nextMicro = 0.4;
    this.blinkT = -1;
    this.nextBlink = 2.5;
    this.doubleBlink = false;
    this.lastActivity = performance.now();
    this.lastPointer = 0;
    this.typingUntil = 0;
    this.mood = 'serene';
    this.headTilt = 0;
    this.lidUpper = 1;
    this.lidLower = 1;
    this.pupil = 0.36;
  }

  /** Debug helpers (open the app with #debug). */
  debugBlink() { this.blinkT = 0; }

  #lookAt(x, y) {
    this.gazeFrom.copy(this.gaze);
    this.gazeTarget.set(THREE.MathUtils.clamp(x, -1, 1), THREE.MathUtils.clamp(y, -1, 1));
    this.saccadeT = 0;
    // Big eye movements often come with a blink, as in people.
    if (this.gazeFrom.distanceTo(this.gazeTarget) > 0.7 && Math.random() < 0.3 && this.blinkT < 0) this.blinkT = 0;
  }

  #attention(dt, t) {
    const s = this.state;
    const now = performance.now();
    const idleFor = (now - this.lastActivity) / 1000;
    const pointerFresh = now - this.lastPointer < 2500;
    this.nextGlance -= dt;

    if (now < this.typingUntil) {
      // Watching you type: eyes drop toward the composer, reading along.
      if (this.nextGlance < 0) { this.#lookAt(-0.25 + Math.random() * 0.5, -0.85); this.nextGlance = 0.35 + Math.random() * 0.4; }
    } else if (this.nextGlance < 0) {
      let x = 0, y = 0, hold = 2;
      if (s === 'thinking') {
        // Recall: up and to one side, flicking between thoughts.
        x = (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.4); y = 0.45 + Math.random() * 0.4; hold = 0.6 + Math.random() * 1.1;
      } else if (s === 'listening') {
        // Holding your gaze, with the small eye-to-eye shifts people make.
        x = (Math.random() - 0.5) * 0.18; y = -0.05 + (Math.random() - 0.5) * 0.12; hold = 0.8 + Math.random() * 1.6;
      } else if (s === 'speaking') {
        // Mostly on you; glancing away now and then while forming the next thought.
        if (Math.random() < 0.25) { x = (Math.random() - 0.5) * 1.3; y = 0.1 + Math.random() * 0.5; hold = 0.4 + Math.random() * 0.6; }
        else { x = (Math.random() - 0.5) * 0.2; y = (Math.random() - 0.5) * 0.12; hold = 1 + Math.random() * 2; }
      } else if (pointerFresh && Math.random() < 0.7) {
        // Something moved: look at it.
        x = this.pointer.x * 0.9; y = this.pointer.y * 0.8; hold = 0.6 + Math.random() * 1.2;
      } else if (idleFor > 25) {
        // You've gone quiet: it wonders, looks around, checks back on you.
        const r = Math.random();
        if (r < 0.35) { x = 0; y = -0.1; hold = 1.5 + Math.random() * 2; }
        else if (r < 0.55) { x = (Math.random() - 0.5) * 0.6; y = -0.8; hold = 1 + Math.random(); }
        else { x = (Math.random() - 0.5) * 1.8; y = (Math.random() - 0.3) * 1.2; hold = 0.8 + Math.random() * 2.2; }
      } else {
        const r = Math.random();
        if (r < 0.6) { x = (Math.random() - 0.5) * 0.25; y = (Math.random() - 0.5) * 0.15; hold = 1.5 + Math.random() * 2.5; }
        else { x = (Math.random() - 0.5) * 1.4; y = (Math.random() - 0.4) * 0.9; hold = 0.5 + Math.random() * 1.5; }
      }
      this.#lookAt(x, y);
      this.nextGlance = hold;
    }

    // Saccade: a fast, eased jump (~75 ms), then fixation with micro-saccades and drift.
    if (this.saccadeT < 1) {
      this.saccadeT = Math.min(1, this.saccadeT + dt / 0.075);
      const k = 1 - Math.pow(1 - this.saccadeT, 3);
      this.gaze.lerpVectors(this.gazeFrom, this.gazeTarget, k);
    } else {
      this.nextMicro -= dt;
      if (this.nextMicro < 0) {
        this.gaze.x += (Math.random() - 0.5) * 0.03;
        this.gaze.y += (Math.random() - 0.5) * 0.02;
        this.nextMicro = 0.25 + Math.random() * 0.7;
      }
      this.gaze.x += (this.gazeTarget.x - this.gaze.x) * dt * 1.5 + Math.sin(t * 1.7) * 0.0005;
      this.gaze.y += (this.gazeTarget.y - this.gaze.y) * dt * 1.5;
    }
    // The eyeball truly rotates in its socket.
    this.eyeball.rotation.y = this.gaze.x * 0.55;
    this.eyeball.rotation.x = -this.gaze.y * 0.38;

    // Head follows the eyes, slower and less far; a curious tilt when it's waiting on you.
    const tilt = idleFor > 25 && s === 'idle' ? Math.sin(t * 0.25) * 0.08 : s === 'listening' ? 0.04 : 0;
    this.headTilt += (tilt - this.headTilt) * dt * 1.2;
    this.head.rotation.y += (this.gaze.x * 0.22 - this.head.rotation.y) * dt * 1.4;
    this.head.rotation.x += (-this.gaze.y * 0.14 - this.head.rotation.x) * dt * 1.4;
    this.head.rotation.z += (this.headTilt - this.head.rotation.z) * dt * 1.4;

    // Blinks: ~12–20 a minute, quick to close, slower to open, sometimes double.
    this.nextBlink -= dt;
    if (this.nextBlink < 0 && this.blinkT < 0) {
      this.blinkT = 0;
      this.doubleBlink = Math.random() < 0.15;
      const base = s === 'listening' ? 4.5 : s === 'speaking' ? 2.6 : s === 'thinking' ? 5 : 3.6;
      this.nextBlink = base * (0.4 + Math.random() * 1.2);
    }
    let closed = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const dur = idleFor > 25 ? 0.42 : 0.26;
      const u = this.blinkT / dur;
      closed = u < 0.35 ? u / 0.35 : Math.max(0, 1 - (u - 0.35) / 0.65);
      if (u >= 1) {
        if (this.doubleBlink) { this.doubleBlink = false; this.blinkT = -0.12; this.nextBlink = Math.min(this.nextBlink, 0.001); }
        else this.blinkT = -1;
      }
    }

    // Lid aperture from state and mood; lids follow vertical gaze like real eyelids.
    const m = this.mood;
    let up = s === 'thinking' ? 0.62 : s === 'listening' ? 1.06 : 0.94;
    let low = 1;
    if (m === 'awed' || m === 'curious') up += 0.1;
    if (m === 'grave' || m === 'melancholic') up -= 0.18;
    if (m === 'fierce') { up -= 0.22; low -= 0.15; }
    if (m === 'joyful' || m === 'compassionate') low -= 0.25;
    if (idleFor > 60 && s === 'idle') up -= 0.12;
    up += this.gaze.y * 0.14;
    low -= this.gaze.y * 0.1;
    up *= 1 - closed;
    low *= 1 - closed * 0.4;
    this.lidUpper += (up - this.lidUpper) * Math.min(1, dt * (closed > 0 ? 40 : 10));
    this.lidLower += (low - this.lidLower) * Math.min(1, dt * 10);
    // Edge elevation in radians: shut ≈ just below centre; open, the upper lid rests on the top of the iris.
    const eU = THREE.MathUtils.lerp(CLOSED, 0.43, this.lidUpper);
    const eL = THREE.MathUtils.lerp(CLOSED, -0.47, this.lidLower);
    this.upperLid.rotation.x = -eU;
    this.lowerLid.rotation.x = -eL;
    this.irisUniforms.uLid.value = THREE.MathUtils.clamp(1.2 - this.lidUpper, 0.3, 1);

    // Pupil: dilates while listening or in awe, narrows in thought or fierceness; never perfectly still.
    let pupil = s === 'listening' ? 0.44 : s === 'thinking' ? 0.26 : 0.34 + this.energy * 0.06;
    if (m === 'awed') pupil += 0.06;
    if (m === 'fierce') pupil -= 0.07;
    pupil += Math.sin(t * 0.9) * 0.012 + Math.sin(t * 2.3) * 0.006; // hippus
    this.pupil += (pupil - this.pupil) * dt * 3;
    this.irisUniforms.uPupil.value = this.pupil;
    this.lashMat.emissiveIntensity = 1.1 + this.energy * 1.5 + (s === 'thinking' ? 0.6 : 0);
  }

  #frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    const s = this.state;

    this.colorA.lerp(this.targetA, dt * 1.5);
    this.colorB.lerp(this.targetB, dt * 1.5);
    this.energy += (this.targetEnergy - this.energy) * Math.min(1, dt * 18);
    const think = s === 'thinking' ? 1 : 0;
    this.coreUniforms.uThink.value += (think - this.coreUniforms.uThink.value) * dt * 3;

    for (const u of [this.cosmos.uniforms, this.coreUniforms, this.irisUniforms, this.dustUniforms, this.globeUniforms]) u.uTime.value = t;
    this.coreUniforms.uEnergy.value = this.energy;
    this.globeUniforms.uEnergy.value = this.energy;

    // Breathing: the whole globe rises and falls very slightly.
    const breath = 1 + Math.sin(t * 0.8) * 0.008 + this.energy * 0.02;
    this.head.scale.setScalar(breath);
    this.head.position.y = Math.sin(t * 0.5) * 0.03;

    this.#attention(dt, t);

    // Sacred rings drift; faster when the mind works.
    const spin = 0.05 + think * 0.6 + this.energy * 0.3 + (s === 'listening' ? 0.12 : 0);
    this.rings.forEach((r, i) => {
      r.rotation.z += dt * spin * (i % 2 ? -1 : 1) * (1 + i * 0.3);
      r.rotation.x += dt * spin * 0.12;
      r.material.opacity = 0.22 + think * 0.25 + this.energy * 0.2;
    });

    const pull = s === 'thinking' ? 1 : s === 'speaking' ? 0.3 + this.energy : 0;
    this.dustUniforms.uPull.value += (pull - this.dustUniforms.uPull.value) * dt * 2;
    this.rim.intensity = 14 + this.energy * 20 + think * 8;

    this.focus += (this.focusTarget - this.focus) * Math.min(1, dt * 3);
    this.bloom.strength = (0.5 + this.energy * 0.35 + think * 0.2) * (0.4 + this.focus * 0.6);
    this.aura.material.opacity = (0.22 + this.energy * 0.2 + think * 0.12) * (0.3 + this.focus * 0.7);
    this.aura.scale.setScalar(6.2 + Math.sin(t * 0.6) * 0.25 + this.energy * 1.2);
    this.camera.position.z = this.baseZ + (1 - this.focus) * 4;

    this.composer.render();
  }
}
