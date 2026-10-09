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
    this.lidOpen = 1;
    this.nextBlink = 2;
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
    eye.position.set(0, 0.18, 1.52);

    // Almond-shaped sclera glow.
    const almond = new THREE.Shape();
    almond.moveTo(-0.62, 0);
    almond.quadraticCurveTo(0, 0.5, 0.62, 0);
    almond.quadraticCurveTo(0, -0.5, -0.62, 0);
    this.sclera = new THREE.Mesh(
      new THREE.ShapeGeometry(almond, 48),
      new THREE.MeshBasicMaterial({ color: 0xfff1d6, transparent: true, opacity: 0.6 }),
    );
    eye.add(this.sclera);

    // Iris with radial filaments.
    this.irisUniforms = { uTime: { value: 0 }, uA: { value: this.colorA }, uB: { value: this.colorB }, uPupil: { value: 0.35 } };
    this.iris = new THREE.Mesh(
      new THREE.CircleGeometry(0.22, 64),
      new THREE.ShaderMaterial({
        transparent: true,
        uniforms: this.irisUniforms,
        vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
        fragmentShader: `
          uniform float uTime; uniform vec3 uA; uniform vec3 uB; uniform float uPupil; varying vec2 vUv;
          void main(){
            vec2 p=vUv-0.5; float r=length(p)*2.0; float a=atan(p.y,p.x);
            float fil=0.5+0.5*sin(a*48.0+sin(a*7.0+uTime)*2.0);
            vec3 col=mix(uA,uB,r)*(0.7+fil*0.6);
            col+=vec3(1.0,0.9,0.7)*smoothstep(0.92,1.0,r)*0.8;
            col=mix(vec3(0.0),col,smoothstep(uPupil,uPupil+0.06,r));
            col+=vec3(1.0)*smoothstep(0.08,0.0,length(p-vec2(-0.12,0.12)))*0.9;
            gl_FragColor=vec4(col,1.0-smoothstep(0.97,1.0,r));
          }`,
      }),
    );
    this.iris.position.z = 0.01;
    eye.add(this.iris);

    // Eyelid aura: the whole eye scales vertically for blinks.
    this.eye = eye;
    this.core.add(eye);

    // Rays radiating from the third eye.
    const rayGeo = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      pts.push(Math.cos(a) * 0.75, Math.sin(a) * 0.5, 0, Math.cos(a) * 1.25, Math.sin(a) * 0.85, 0);
    }
    rayGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.rays = new THREE.LineSegments(rayGeo, new THREE.LineBasicMaterial({ color: this.colorA, transparent: true, opacity: 0.25 }));
    eye.add(this.rays);
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

    for (const u of [this.cosmos.uniforms, this.coreUniforms, this.irisUniforms, this.dustUniforms]) u.uTime.value = t;
    this.coreUniforms.uEnergy.value = this.energy;

    // Breathing.
    const breath = 1 + Math.sin(t * 0.9) * 0.02 + this.energy * 0.06;
    this.core.scale.setScalar(breath);
    this.seed.scale.setScalar(1 + Math.sin(t * 2.2) * 0.1 + this.energy * 0.8);
    this.seed.material.opacity = 0.25 + this.energy * 0.25 + think * 0.2;

    // Gaze follows you, drifts while thinking.
    const gx = s === 'thinking' ? Math.sin(t * 0.7) * 0.25 : this.pointer.x * 0.35;
    const gy = s === 'thinking' ? 0.2 + Math.sin(t * 0.5) * 0.08 : this.pointer.y * 0.25;
    this.core.rotation.y += (gx - this.core.rotation.y) * dt * 2;
    this.core.rotation.x += (-gy - this.core.rotation.x) * dt * 2;
    this.iris.position.x += (this.pointer.x * 0.12 - this.iris.position.x) * dt * 5;
    this.iris.position.y += (this.pointer.y * 0.06 - this.iris.position.y) * dt * 5;

    // Pupil: dilates when listening, narrows when thinking.
    const pupil = s === 'listening' ? 0.5 : s === 'thinking' ? 0.18 : 0.32 + this.energy * 0.12;
    this.irisUniforms.uPupil.value += (pupil - this.irisUniforms.uPupil.value) * dt * 4;

    // Blinking and lid aperture.
    this.nextBlink -= dt;
    let lidTarget = s === 'thinking' ? 0.35 : s === 'listening' ? 1.15 : 1;
    if (this.nextBlink < 0) {
      lidTarget = 0.04;
      if (this.nextBlink < -0.12) this.nextBlink = 2 + Math.random() * 5;
    }
    this.lidOpen += (lidTarget - this.lidOpen) * Math.min(1, dt * 22);
    this.eye.scale.set(1, this.lidOpen, 1);
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
