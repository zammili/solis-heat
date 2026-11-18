// ProceduralCityTextures — every surface in Puerto Solis is painted on 2D canvases at boot:
// the whole street map (asphalt, lane paint, crosswalks, promenade, sand), building facades
// with lit windows, neon signs, water sparkle, palm fronds and soft glow sprites. No image
// files are loaded, so the game stays fully offline and identical on every visit.
import * as THREE from 'three';

/** Deterministic PRNG (mulberry32) so the city paints the same way on every load. */
export function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return [canvas, canvas.getContext('2d')];
}

function toTexture(canvas, repeatX = 1, repeatY = 1) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class ProceduralCityTextures {
  constructor(seed = 20261117) {
    this.random = createSeededRandom(seed);
    this.groundMap = this.paintGroundMap();
    this.waterMap = this.paintWater();
    this.sandMap = this.paintSand();
    this.woodMap = this.paintWood();
    this.glassFacades = [0, 1, 2].map((i) => this.paintGlassFacade(i));
    this.decoFacades = [0, 1].map((i) => this.paintDecoFacade(i));
    this.warehouseFacade = this.paintWarehouseFacade();
    this.palmFrond = this.paintPalmFrond();
    this.glowSprite = this.paintGlowSprite();
    this.smokeSprite = this.paintSmokeSprite();
    this.signTextures = {
      mariposa: this.paintNeonSign('CLUB MARIPOSA', '#ff5fd2'),
      miramar: this.paintNeonSign('HOTEL MIRAMAR', '#37e0ff'),
      customs: this.paintNeonSign('SOLIS CUSTOMS', '#52ff9a'),
      cola: this.paintBillboard('SOLIS COLA', 'Taste the sunset', '#ff7847', '#ffd166'),
      banco: this.paintBillboard('BANCO CORAL', 'Your money, on the water', '#7ad0ff', '#ffffff'),
      cine: this.paintNeonSign('CINE CORAL', '#ffb347'),
    };
  }

  /**
   * The whole city floor painted top-down on one 2048px canvas: base pavement, the harbour
   * apron, every road with lane paint and zebra crossings, sidewalks, the beach promenade
   * and the golden sand running into the sea. `layout` carries the road coordinates.
   */
  paintGroundMap() {
    const SIZE = 2048;
    const [canvas, g] = makeCanvas(SIZE, SIZE);
    const world = 640; // the ground plane spans -320..320 on both axes
    const px = (v) => ((v + world / 2) / world) * SIZE;
    const len = (v) => (v / world) * SIZE;
    const rng = this.random;

    g.fillStyle = '#3f3b47';
    g.fillRect(0, 0, SIZE, SIZE);
    // faint city-block tone variation
    for (let i = 0; i < 2600; i += 1) {
      g.fillStyle = `rgba(${20 + rng() * 40},${18 + rng() * 30},${26 + rng() * 30},0.08)`;
      g.fillRect(rng() * SIZE, rng() * SIZE, 8 + rng() * 40, 8 + rng() * 40);
    }
    // harbour apron (north strip)
    g.fillStyle = '#596270';
    g.fillRect(px(-320), px(-320), len(470), len(152));
    g.strokeStyle = 'rgba(255,255,255,0.13)';
    for (let x = -300; x < 140; x += 26) {
      g.beginPath(); g.moveTo(px(x), px(-320)); g.lineTo(px(x), px(-168)); g.stroke();
    }
    // central plaza tiles around Corona Plaza
    g.fillStyle = '#6e6258';
    g.fillRect(px(-13), px(-13), len(46), len(46));
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i <= 6; i += 1) {
      g.beginPath(); g.moveTo(px(-13 + i * 7.6), px(-13)); g.lineTo(px(-13 + i * 7.6), px(33)); g.stroke();
      g.beginPath(); g.moveTo(px(-13), px(-13 + i * 7.6)); g.lineTo(px(33), px(-13 + i * 7.6)); g.stroke();
    }

    const layout = ProceduralCityTextures.LAYOUT;
    // sidewalks first (under roads at crossings, reads as pavement bands)
    g.fillStyle = '#8d8794';
    for (const x of layout.roadXs) {
      const half = (x === layout.boulevardX ? layout.boulevardHalf : layout.roadHalf) + layout.sidewalk;
      g.fillRect(px(x - half), px(-320), len(half * 2), len(640));
    }
    for (const z of layout.roadZs) {
      const half = layout.roadHalf + layout.sidewalk;
      g.fillRect(px(-320), px(z - half), len(640), len(half * 2));
    }
    // asphalt
    const drawRoad = (vertical, at, half) => {
      g.fillStyle = '#22222b';
      if (vertical) g.fillRect(px(at - half), px(-320), len(half * 2), len(640));
      else g.fillRect(px(-320), px(at - half), len(640), len(half * 2));
      // edge lines
      g.fillStyle = '#e8e4da';
      if (vertical) {
        g.fillRect(px(at - half + 0.5), px(-320), len(0.35), len(640));
        g.fillRect(px(at + half - 0.85), px(-320), len(0.35), len(640));
      } else {
        g.fillRect(px(-320), px(at - half + 0.5), len(640), len(0.35));
        g.fillRect(px(-320), px(at + half - 0.85), len(640), len(0.35));
      }
      // centre paint: double yellow on the boulevard, dashed white elsewhere
      if (vertical && at === layout.boulevardX) {
        g.fillStyle = '#f7b731';
        g.fillRect(px(at - 0.7), px(-320), len(0.4), len(640));
        g.fillRect(px(at + 0.3), px(-320), len(0.4), len(640));
      } else {
        g.fillStyle = 'rgba(240,240,235,0.85)';
        const dash = 4; const gap = 4;
        for (let t = -320; t < 320; t += dash + gap) {
          if (vertical) g.fillRect(px(at - 0.18), px(t), len(0.36), len(dash));
          else g.fillRect(px(t), px(at - 0.18), len(dash), len(0.36));
        }
      }
    };
    for (const x of layout.roadXs) drawRoad(true, x, x === layout.boulevardX ? layout.boulevardHalf : layout.roadHalf);
    for (const z of layout.roadZs) drawRoad(false, z, layout.roadHalf);
    // zebra crossings at every intersection
    g.fillStyle = 'rgba(245,245,240,0.9)';
    for (const x of layout.roadXs) {
      for (const z of layout.roadZs) {
        const half = x === layout.boulevardX ? layout.boulevardHalf : layout.roadHalf;
        for (let s = -half + 1.2; s < half - 1.2; s += 2.2) {
          g.fillRect(px(x + s), px(z - layout.roadHalf - 2.6), len(1.2), len(1.8));
          g.fillRect(px(x + s), px(z + layout.roadHalf + 0.8), len(1.2), len(1.8));
          g.fillRect(px(x - half - 2.6), px(z + s), len(1.8), len(1.2));
          g.fillRect(px(x + half + 0.8), px(z + s), len(1.8), len(1.2));
        }
      }
    }
    // promenade paving between boulevard and sand
    g.fillStyle = '#b39b78';
    g.fillRect(px(113), px(-320), len(7), len(640));
    g.strokeStyle = 'rgba(90,70,50,0.35)';
    for (let z = -320; z < 320; z += 5) {
      g.beginPath(); g.moveTo(px(113), px(z)); g.lineTo(px(120), px(z)); g.stroke();
    }
    // beach sand strip, then the sea floor under the water plane
    const sandGrad = g.createLinearGradient(px(120), 0, px(154), 0);
    sandGrad.addColorStop(0, '#eec887');
    sandGrad.addColorStop(1, '#f7e3ac');
    g.fillStyle = sandGrad;
    g.fillRect(px(120), px(-320), len(34), len(640));
    for (let i = 0; i < 1500; i += 1) {
      g.fillStyle = `rgba(160,120,60,${0.05 + rng() * 0.1})`;
      g.fillRect(px(120) + rng() * len(34), rng() * SIZE, 2, 2);
    }
    g.fillStyle = '#17456b';
    g.fillRect(px(154), px(-320), len(640 - 154 - 320 + 320), len(640));
    return toTexture(canvas);
  }

  paintWater() {
    const [canvas, g] = makeCanvas(256, 256);
    const rng = this.random;
    const grad = g.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, '#1b5f8a');
    grad.addColorStop(0.5, '#166b96');
    grad.addColorStop(1, '#0f4d73');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 420; i += 1) {
      const y = rng() * 256;
      g.fillStyle = `rgba(255,${190 + rng() * 60},${120 + rng() * 80},${0.05 + rng() * 0.16})`;
      g.fillRect(rng() * 256, y, 6 + rng() * 26, 1.4);
    }
    for (let i = 0; i < 300; i += 1) {
      g.fillStyle = `rgba(255,255,255,${0.04 + rng() * 0.1})`;
      g.fillRect(rng() * 256, rng() * 256, 3 + rng() * 12, 1);
    }
    return toTexture(canvas, 10, 10);
  }

  paintSand() {
    const [canvas, g] = makeCanvas(128, 128);
    const rng = this.random;
    g.fillStyle = '#f0d18c';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 500; i += 1) {
      g.fillStyle = `rgba(170,130,70,${0.06 + rng() * 0.12})`;
      g.fillRect(rng() * 128, rng() * 128, 1.6, 1.6);
    }
    return toTexture(canvas, 6, 6);
  }

  paintWood() {
    const [canvas, g] = makeCanvas(256, 256);
    const rng = this.random;
    g.fillStyle = '#8a6844';
    g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 32) {
      g.fillStyle = `rgba(60,40,20,${0.12 + rng() * 0.1})`;
      g.fillRect(x, 0, 3, 256);
      for (let i = 0; i < 22; i += 1) {
        g.fillStyle = `rgba(50,32,14,${0.05 + rng() * 0.09})`;
        g.fillRect(x + 3 + rng() * 26, rng() * 256, 1.4, 8 + rng() * 30);
      }
    }
    return toTexture(canvas, 4, 1);
  }

  /** A glass tower facade: colour canvas plus a matching emissive canvas of lit windows. */
  paintGlassFacade(variant) {
    const [canvas, g] = makeCanvas(256, 512);
    const [glowCanvas, e] = makeCanvas(256, 512);
    const rng = createSeededRandom(4100 + variant * 37);
    const bases = ['#2c3e55', '#3a3350', '#274b5c'];
    g.fillStyle = bases[variant % bases.length];
    g.fillRect(0, 0, 256, 512);
    e.fillStyle = '#000000';
    e.fillRect(0, 0, 256, 512);
    const cols = 8; const rows = 22;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const x = 10 + c * 30; const y = 12 + r * 22;
        const lit = rng() < 0.52;
        const warm = rng();
        g.fillStyle = lit ? `rgba(255,${205 + warm * 40},${140 + warm * 60},0.95)` : 'rgba(140,180,215,0.35)';
        g.fillRect(x, y, 20, 13);
        if (lit) {
          e.fillStyle = `rgba(255,${190 + warm * 50},${110 + warm * 60},${0.75 + warm * 0.25})`;
          e.fillRect(x, y, 20, 13);
        }
      }
    }
    g.fillStyle = 'rgba(255,120,80,0.16)';
    g.fillRect(0, 0, 256, 60);
    return { map: toTexture(canvas), emissive: toTexture(glowCanvas) };
  }

  /** A pastel Art-Deco hotel facade with a neon roof trim, for the beach boulevard. */
  paintDecoFacade(variant) {
    const [canvas, g] = makeCanvas(256, 512);
    const [glowCanvas, e] = makeCanvas(256, 512);
    const rng = createSeededRandom(8200 + variant * 91);
    const pastels = ['#f2b8c6', '#a8d8d0'];
    const trims = ['#ff5fd2', '#37e0ff'];
    g.fillStyle = pastels[variant % pastels.length];
    g.fillRect(0, 0, 256, 512);
    e.fillStyle = '#000000';
    e.fillRect(0, 0, 256, 512);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let y = 42; y < 512; y += 56) g.fillRect(0, y, 256, 5);
    for (let r = 0; r < 9; r += 1) {
      for (let c = 0; c < 5; c += 1) {
        const x = 18 + c * 47; const y = 16 + r * 56;
        const lit = rng() < 0.6;
        g.fillStyle = lit ? '#ffe9a8' : '#5d6d7d';
        g.beginPath();
        g.roundRect(x, y, 30, 34, 12);
        g.fill();
        if (lit) { e.fillStyle = 'rgba(255,215,130,0.9)'; e.beginPath(); e.roundRect(x, y, 30, 34, 12); e.fill(); }
      }
    }
    g.fillStyle = trims[variant % trims.length];
    g.fillRect(0, 0, 256, 8);
    e.fillStyle = trims[variant % trims.length];
    e.fillRect(0, 0, 256, 8);
    return { map: toTexture(canvas), emissive: toTexture(glowCanvas) };
  }

  paintWarehouseFacade() {
    const [canvas, g] = makeCanvas(256, 256);
    const rng = createSeededRandom(9911);
    g.fillStyle = '#707a86';
    g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 16) {
      g.fillStyle = `rgba(30,36,44,${0.1 + rng() * 0.08})`;
      g.fillRect(x, 0, 3, 256);
    }
    g.fillStyle = '#39424e';
    g.fillRect(28, 120, 88, 120);
    g.fillRect(140, 120, 88, 120);
    g.fillStyle = 'rgba(255,220,150,0.85)';
    g.fillRect(20, 30, 26, 18);
    g.fillRect(210, 30, 26, 18);
    return { map: toTexture(canvas), emissive: null };
  }

  paintPalmFrond() {
    const [canvas, g] = makeCanvas(128, 256);
    g.clearRect(0, 0, 128, 256);
    g.strokeStyle = '#2f9e4f';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(64, 256);
    g.quadraticCurveTo(58, 130, 64, 6);
    g.stroke();
    g.lineWidth = 3;
    for (let i = 0; i < 26; i += 1) {
      const t = i / 26;
      const y = 250 - t * 235;
      const spread = 16 + t * 44;
      g.strokeStyle = `rgba(${40 + t * 30},${150 + t * 40},70,0.95)`;
      g.beginPath(); g.moveTo(64, y); g.quadraticCurveTo(64 - spread * 0.6, y - 12, 64 - spread, y + 8 + t * 22); g.stroke();
      g.beginPath(); g.moveTo(64, y); g.quadraticCurveTo(64 + spread * 0.6, y - 12, 64 + spread, y + 8 + t * 22); g.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  paintGlowSprite() {
    const [canvas, g] = makeCanvas(128, 128);
    const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.42)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
  }

  paintSmokeSprite() {
    const [canvas, g] = makeCanvas(128, 128);
    const rng = this.random;
    for (let i = 0; i < 26; i += 1) {
      const x = 24 + rng() * 80; const y = 24 + rng() * 80; const r = 12 + rng() * 26;
      const grad = g.createRadialGradient(x, y, 1, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.16)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    return new THREE.CanvasTexture(canvas);
  }

  paintNeonSign(text, colour) {
    const [canvas, g] = makeCanvas(1024, 160);
    g.clearRect(0, 0, 1024, 160);
    g.font = '900 104px "Arial Black", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = colour;
    g.shadowBlur = 34;
    g.strokeStyle = colour;
    g.lineWidth = 3;
    g.strokeText(text, 512, 84);
    g.shadowBlur = 16;
    g.fillStyle = '#ffffff';
    g.fillText(text, 512, 84);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }

  paintBillboard(title, line, colour, accent) {
    const [canvas, g] = makeCanvas(1024, 512);
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#2b1055');
    grad.addColorStop(1, '#7597de');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 512);
    g.fillStyle = colour;
    g.beginPath(); g.arc(850, 400, 130, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(0, 428, 1024, 10);
    g.font = '900 128px "Arial Black", Arial, sans-serif';
    g.textAlign = 'center';
    g.fillStyle = '#ffffff';
    g.shadowColor = colour;
    g.shadowBlur = 26;
    g.fillText(title, 512, 205);
    g.shadowBlur = 0;
    g.font = '700 62px Arial, sans-serif';
    g.fillStyle = accent;
    g.fillText(line, 512, 330);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }
}

/** The street plan every system agrees on: road centre-lines, widths and the shore. */
ProceduralCityTextures.LAYOUT = {
  roadXs: [-200, -140, -80, -20, 40, 100],
  roadZs: [-200, -140, -80, -20, 40, 100, 160, 220],
  boulevardX: 100,
  roadHalf: 7,
  boulevardHalf: 10,
  sidewalk: 3.5,
  shoreX: 152,
  sandFrom: 120,
  worldHalf: 320,
};
