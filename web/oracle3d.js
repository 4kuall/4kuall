// The Oracle's body: a living orb with a third eye, sacred rings and a star-dust halo.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Cinematic finish: chromatic fringe toward the edges, vignette, and lift.
const LensShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 0.0009 }, uTime: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uTime; varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5; float d = dot(c, c);
      vec2 off = c * d * uAmount * 40.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= smoothstep(0.85, 0.15, d * 1.6);
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

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(0, 0, 7.2);

    this.#buildCosmos();
    this.#buildCore();
    this.#buildEye();
    this.#buildRings();
    this.#buildDust();

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.1, 0.7, 0.12);
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

  #resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // Keep the being fully in frame on narrow screens.
    this.baseZ = w / h < 0.8 ? 11.8 : 8.4;
    this.camera.position.z = this.baseZ;
    // Lift the being above the subtitles.
    this.camera.position.y = w / h < 0.8 ? -2.0 : -1.05;
    this.camera.updateProjectionMatrix();
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
          float n=snoise(vec3(p*2.2,uTime*0.03))*0.5+0.5;
          float n2=snoise(vec3(p*5.0+7.0,uTime*0.05))*0.5+0.5;
          float v=1.0-smoothstep(0.0,0.85,length(p));
          vec3 col=mix(vec3(0.043,0.047,0.055)*0.6,mix(uA,uB,n2)*0.07,n*v*0.8);
          gl_FragColor=vec4(col,1.0);
        }`,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    quad.renderOrder = -1;
    this.cosmos = mat;
    this.scene.add(quad);
  }

  #buildCore() {
    this.coreUniforms = {
      uTime: { value: 0 },
      uEnergy: { value: 0 },
      uThink: { value: 0 },
      uA: { value: this.colorA },
      uB: { value: this.colorB },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.coreUniforms,
      transparent: true,
      vertexShader: `${NOISE}
        uniform float uTime; uniform float uEnergy; uniform float uThink;
        varying vec3 vNormal; varying vec3 vView; varying float vDisp;
        void main(){
          float slow=snoise(normal*1.4+uTime*0.25);
          float fast=snoise(normal*4.0+uTime*(1.2+uThink*2.0));
          float d=slow*0.07+fast*(0.02+uEnergy*0.22+uThink*0.05);
          vDisp=d;
          vec3 pos=position+normal*d;
          vec4 mv=modelViewMatrix*vec4(pos,1.0);
          vNormal=normalize(normalMatrix*normal); vView=normalize(-mv.xyz);
          gl_Position=projectionMatrix*mv;
        }`,
      fragmentShader: `
        uniform vec3 uA; uniform vec3 uB; uniform float uEnergy;
        varying vec3 vNormal; varying vec3 vView; varying float vDisp;
        void main(){
          float fres=pow(1.0-max(dot(vNormal,vView),0.0),2.4);
          vec3 base=mix(uB,uA,clamp(vDisp*6.0+0.5,0.0,1.0));
          vec3 col=base*(0.08+fres*1.1+uEnergy*0.5)+vec3(fres*fres*0.35);
          gl_FragColor=vec4(col,0.55+fres*0.45);
        }`,
    });
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.35, 96), mat);
    this.scene.add(this.core);

    // Soft outer aura.
    const auraTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      grd.addColorStop(0, 'rgba(255,255,255,0.55)');
      grd.addColorStop(0.35, 'rgba(255,255,255,0.12)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 256, 256);
      return new THREE.CanvasTexture(c);
    })();
    this.aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: auraTex, color: this.colorB, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 }));
    this.aura.scale.setScalar(6.5);
    this.scene.add(this.aura);

    // Inner luminous seed.
    this.seed = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 48, 48),
      new THREE.MeshBasicMaterial({ color: this.colorA, transparent: true, opacity: 0.35 }),
    );
    this.scene.add(this.seed);
  }

  #buildEye() {
    const eye = new THREE.Group();
    eye.position.set(0, 0.18, 1.5);

    // A single procedural eye: almond opening with real upper/lower lids, a shaded
    // sclera, a fibrous iris that moves inside the socket, a breathing pupil and a
    // corneal highlight that stays put while the iris moves — the cue that makes
    // eyes read as wet and alive.
    this.eyeUniforms = {
      uTime: { value: 0 },
      uA: { value: this.colorA },
      uB: { value: this.colorB },
      uGaze: { value: new THREE.Vector2() },
      uUpper: { value: 1 },
      uLower: { value: 1 },
      uPupil: { value: 0.38 },
      uGlow: { value: 0.4 },
    };
    this.eyeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.1),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: this.eyeUniforms,
        vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
        fragmentShader: `
          uniform float uTime; uniform vec3 uA; uniform vec3 uB; uniform vec2 uGaze;
          uniform float uUpper; uniform float uLower; uniform float uPupil; uniform float uGlow;
          varying vec2 vUv;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
          float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
            return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
          float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<4;i++){ v+=a*vnoise(p); p*=2.03; a*=0.5; } return v; }
          void main(){
            vec2 p = (vUv - 0.5) * vec2(1.6, 1.1);
            const float W = 0.68;
            float t = clamp(p.x / W, -1.0, 1.0);
            float shape = pow(max(1.0 - t*t, 0.0), 0.75);
            float upper = 0.36 * shape * uUpper - 0.015;
            float lower = -0.29 * shape * uLower + 0.015;
            float dU = upper - p.y, dL = p.y - lower;
            float inside = smoothstep(0.0, 0.012, dU) * smoothstep(0.0, 0.012, dL) * step(abs(p.x), W);

            // Sclera: warm off-white, darker toward the corners and under the upper lid.
            vec3 sclera = vec3(0.42, 0.40, 0.38) * (1.0 - 0.5 * pow(abs(t), 2.2));
            sclera += (fbm(p * 18.0) - 0.5) * 0.03;
            sclera = mix(sclera, uA, 0.08);

            // Iris & pupil, moving with the gaze.
            vec2 c = uGaze * vec2(0.34, 0.15);
            vec2 q = p - c;
            float R = 0.19;
            float d = length(q) / R;
            float a = atan(q.y, q.x);
            float fib = fbm(vec2(a * 7.0, d * 2.5 - uTime * 0.03)) * 0.7 + fbm(vec2(a * 23.0, d * 6.0)) * 0.4;
            vec3 iris = mix(uB * 0.35, uA * 0.7, smoothstep(0.15, 0.95, d * 0.6 + fib * 0.6));
            iris *= 0.6 + 0.6 * fib;
            iris += uA * 0.22 * smoothstep(0.12, 0.0, abs(d - (uPupil + 0.12)));   // collarette
            iris *= 1.0 - 0.85 * smoothstep(0.78, 1.0, d);                            // limbal ring
            float pupil = 1.0 - smoothstep(uPupil - 0.04, uPupil + 0.02, d);
            iris = mix(iris, vec3(0.0), pupil);
            float irisMask = 1.0 - smoothstep(0.97, 1.03, d);
            vec3 col = mix(sclera, iris, irisMask);

            // Shadow cast by the upper lid; slight occlusion near the lower lid.
            col *= mix(0.45, 1.0, smoothstep(0.0, 0.11, dU));
            col *= mix(0.75, 1.0, smoothstep(0.0, 0.05, dL));

            // Corneal highlights: fixed light source, nudged a little by the eyeball turning.
            vec2 hl = c * 0.35 + vec2(-0.07, 0.07);
            col += vec3(1.0) * smoothstep(0.035, 0.0, length(p - hl)) * 0.95;
            col += vec3(1.0) * smoothstep(0.018, 0.0, length(p - hl - vec2(0.11, -0.05))) * 0.5;

            // Luminous lid line and outer aura in the Oracle's colour.
            float edge = 1.0 - smoothstep(0.0, 0.03, min(dU, dL));
            col += uA * edge * inside * 0.35;
            float outside = 1.0 - inside;
            float distOut = max(max(-dU, -dL), abs(p.x) - W);
            float halo = smoothstep(0.09, 0.0, distOut) * outside * uGlow;
            gl_FragColor = vec4(col * inside + uA * halo, max(inside, halo * 0.8));
          }`,
      }),
    );
    eye.add(this.eyeMesh);
    this.eye = eye;
    this.core.add(eye);

    // Rays radiating from the third eye.
    const rayGeo = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      pts.push(Math.cos(a) * 0.78, Math.sin(a) * 0.52, 0, Math.cos(a) * 1.25, Math.sin(a) * 0.85, 0);
    }
    rayGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.rays = new THREE.LineSegments(rayGeo, new THREE.LineBasicMaterial({ color: this.colorA, transparent: true, opacity: 0.25 }));
    this.rays.position.z = -0.01;
    eye.add(this.rays);

    // Attention system state.
    this.gaze = new THREE.Vector2();        // where the eye points now (-1..1)
    this.gazeTarget = new THREE.Vector2();  // where it wants to look
    this.gazeFrom = new THREE.Vector2();
    this.saccadeT = 1;                      // 0..1 progress of the current saccade
    this.nextGlance = 1.5;
    this.nextMicro = 0.4;
    this.blinkT = -1;                       // >=0 while blinking
    this.nextBlink = 2.5;
    this.doubleBlink = false;
    this.lastActivity = performance.now();
    this.lastPointer = 0;
    this.typingUntil = 0;
    this.mood = 'serene';
    this.headTilt = 0;
  }

  /** The app tells the eye what you're doing so it can pay attention. */
  notice(kind) {
    const now = performance.now();
    this.lastActivity = now;
    if (kind === 'typing') this.typingUntil = now + 1500;
  }

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
        if (r < 0.35) { x = 0; y = -0.1; hold = 1.5 + Math.random() * 2; }                 // back to you
        else if (r < 0.55) { x = (Math.random() - 0.5) * 0.6; y = -0.8; hold = 1 + Math.random(); } // the input, waiting
        else { x = (Math.random() - 0.5) * 1.8; y = (Math.random() - 0.3) * 1.2; hold = 0.8 + Math.random() * 2.2; }
      } else {
        const r = Math.random();
        if (r < 0.6) { x = (Math.random() - 0.5) * 0.25; y = (Math.random() - 0.5) * 0.15; hold = 1.5 + Math.random() * 2.5; }
        else { x = (Math.random() - 0.5) * 1.4; y = (Math.random() - 0.4) * 0.9; hold = 0.5 + Math.random() * 1.5; }
      }
      this.#lookAt(x, y);
      this.nextGlance = hold;
    }

    // Saccade: a fast, eased jump (~60–90 ms), then fixation with micro-saccades and drift.
    if (this.saccadeT < 1) {
      this.saccadeT = Math.min(1, this.saccadeT + dt / 0.075);
      const k = 1 - Math.pow(1 - this.saccadeT, 3);
      this.gaze.lerpVectors(this.gazeFrom, this.gazeTarget, k);
    } else {
      this.nextMicro -= dt;
      if (this.nextMicro < 0) {
        this.gaze.x += (Math.random() - 0.5) * 0.035;
        this.gaze.y += (Math.random() - 0.5) * 0.025;
        this.nextMicro = 0.25 + Math.random() * 0.7;
      }
      this.gaze.x += (this.gazeTarget.x - this.gaze.x) * dt * 1.5 + Math.sin(t * 1.7) * 0.0006;
      this.gaze.y += (this.gazeTarget.y - this.gaze.y) * dt * 1.5;
    }
    this.eyeUniforms.uGaze.value.copy(this.gaze);

    // Head follows the eyes, slower and less far; a curious tilt when it's waiting on you.
    const tilt = idleFor > 25 && s === 'idle' ? Math.sin(t * 0.25) * 0.08 : s === 'listening' ? 0.04 : 0;
    this.headTilt += (tilt - this.headTilt) * dt * 1.2;
    this.core.rotation.y += (this.gaze.x * 0.28 - this.core.rotation.y) * dt * 1.6;
    this.core.rotation.x += (-this.gaze.y * 0.18 - this.core.rotation.x) * dt * 1.6;
    this.core.rotation.z += (this.headTilt - this.core.rotation.z) * dt * 1.6;

    // Blinks: ~12–20 a minute, quick to close, slower to open, sometimes double;
    // slower and rarer while focused, more often when speaking.
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
      const dur = idleFor > 25 ? 0.42 : 0.26; // slow, sleepy blinks when nothing is happening
      const u = this.blinkT / dur;
      closed = u < 0.35 ? u / 0.35 : Math.max(0, 1 - (u - 0.35) / 0.65);
      if (u >= 1) {
        if (this.doubleBlink) { this.doubleBlink = false; this.blinkT = -0.12; this.nextBlink = Math.min(this.nextBlink, 0.001); }
        else this.blinkT = -1;
      }
    }

    // Lid shape: mood and attention, plus lids following vertical gaze like real eyelids.
    const m = this.mood;
    let up = s === 'thinking' ? 0.62 : s === 'listening' ? 1.08 : 0.95;
    let low = 1;
    if (m === 'awed' || m === 'curious') up += 0.1;
    if (m === 'grave' || m === 'melancholic') up -= 0.18;
    if (m === 'fierce') { up -= 0.22; low -= 0.15; }
    if (m === 'joyful' || m === 'compassionate') low -= 0.25; // the smile in the eyes
    if (idleFor > 60 && s === 'idle') up -= 0.12;             // drowsy when left alone
    up += this.gaze.y * 0.12;
    low -= this.gaze.y * 0.08;
    up *= 1 - closed;
    low *= 1 - closed * 0.35;
    const U = this.eyeUniforms;
    U.uUpper.value += (up - U.uUpper.value) * Math.min(1, dt * (closed > 0 ? 40 : 10));
    U.uLower.value += (low - U.uLower.value) * Math.min(1, dt * 10);

    // Pupil: dilates while listening or in awe, narrows in thought or fierceness, and never sits perfectly still.
    let pupil = s === 'listening' ? 0.46 : s === 'thinking' ? 0.27 : 0.36 + this.energy * 0.06;
    if (m === 'awed') pupil += 0.06;
    if (m === 'fierce') pupil -= 0.07;
    pupil += Math.sin(t * 0.9) * 0.012 + Math.sin(t * 2.3) * 0.006; // hippus
    U.uPupil.value += (pupil - U.uPupil.value) * dt * 3;
    U.uGlow.value = 0.35 + this.energy * 0.4 + (s === 'thinking' ? 0.2 : 0);
  }

  #buildRings() {
    this.rings = [];
    const specs = [
      [2.05, 0.008, [1.2, 0.2, 0]],
      [2.35, 0.006, [0.3, 1.1, 0.4]],
      [2.7, 0.005, [-0.6, 0.4, 1.0]],
    ];
    for (const [r, t, rot] of specs) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r, t, 8, 256),
        new THREE.MeshBasicMaterial({ color: this.colorB, transparent: true, opacity: 0.6 }),
      );
      ring.rotation.set(...rot);
      // Glyph beads riding each ring.
      const beads = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.035), new THREE.MeshBasicMaterial({ color: this.colorA }), 12);
      const m = new THREE.Matrix4();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        m.makeTranslation(Math.cos(a) * r, Math.sin(a) * r, 0);
        beads.setMatrixAt(i, m);
      }
      ring.add(beads);
      this.scene.add(ring);
      this.rings.push(ring);
    }
  }

  #buildDust() {
    const n = 2600;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = 2.2 + Math.random() * 4.5;
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
            float a=uTime*(0.05+aSeed*0.08)*(1.0+uPull*3.0);
            p.xz=mat2(cos(a),-sin(a),sin(a),cos(a))*p.xz;
            p*=1.0-uPull*0.25*aSeed;
            vec4 mv=modelViewMatrix*vec4(p,1.0);
            gl_PointSize=(1.5+aSeed*2.5)*(8.0/-mv.z)*(1.0+0.5*sin(uTime*2.0+aSeed*40.0));
            gl_Position=projectionMatrix*mv;
          }`,
        fragmentShader: `
          uniform vec3 uA; uniform vec3 uB; varying float vSeed;
          void main(){ float d=length(gl_PointCoord-0.5); if(d>0.5) discard;
            gl_FragColor=vec4(mix(uA,uB,vSeed),(0.5-d)*1.4); }`,
      }),
    );
    this.scene.add(this.dust);
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

    for (const u of [this.cosmos.uniforms, this.coreUniforms, this.eyeUniforms, this.dustUniforms]) u.uTime.value = t;
    this.coreUniforms.uEnergy.value = this.energy;

    // Breathing.
    const breath = 1 + Math.sin(t * 0.9) * 0.02 + this.energy * 0.06;
    this.core.scale.setScalar(breath);
    this.seed.scale.setScalar(1 + Math.sin(t * 2.2) * 0.1 + this.energy * 0.8);
    this.seed.material.opacity = 0.25 + this.energy * 0.25 + think * 0.2;

    this.#attention(dt, t);
    this.rays.material.opacity = 0.12 + this.energy * 0.6 + think * 0.25;
    this.rays.rotation.z = t * 0.1;

    // Sacred rings spin faster when the mind works.
    const spin = 0.08 + think * 0.9 + this.energy * 0.4 + (s === 'listening' ? 0.2 : 0);
    this.rings.forEach((r, i) => {
      r.rotation.z += dt * spin * (i % 2 ? -1 : 1) * (1 + i * 0.3);
      r.rotation.x += dt * spin * 0.15;
      r.material.opacity = 0.35 + think * 0.4 + this.energy * 0.3;
    });

    const pull = s === 'thinking' ? 1 : s === 'speaking' ? 0.3 + this.energy : 0;
    this.dustUniforms.uPull.value += (pull - this.dustUniforms.uPull.value) * dt * 2;
    this.focus += (this.focusTarget - this.focus) * Math.min(1, dt * 3);
    this.bloom.strength = (0.7 + this.energy * 0.45 + think * 0.4) * (0.35 + this.focus * 0.65);
    this.aura.material.opacity = (0.35 + this.energy * 0.2 + think * 0.2) * (0.3 + this.focus * 0.7);
    this.aura.scale.setScalar(6 + Math.sin(t * 0.6) * 0.3 + this.energy * 1.5);
    this.lens.uniforms.uTime.value = t;
    this.camera.position.z = this.baseZ + (1 - this.focus) * 4;

    this.composer.render();
  }
}
