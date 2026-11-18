// SunsetCoastalCity — builds Puerto Solis: a GLSL sunset sky dome with a low sun over the
// water, a glittering sea, the Playa Coral promenade and pier, neon Art-Deco hotels along
// the beach boulevard, the Corona downtown towers, the Muelle Norte container harbour and
// the Solis Customs paint garage. It also owns the collision data (building AABBs) and the
// ground-height field (pier deck, stunt ramp) every mover samples.
import * as THREE from 'three';
import { ProceduralCityTextures, createSeededRandom } from './ProceduralCityTextures.js';

export const CITY_LAYOUT = ProceduralCityTextures.LAYOUT;

const SUN_DIRECTION = new THREE.Vector3(1, 0.14, 0.22).normalize();

export class SunsetCoastalCity {
  constructor(scene, textures) {
    this.scene = scene;
    this.textures = textures;
    this.random = createSeededRandom(777001);
    this.colliders = [];
    this.group = new THREE.Group();
    this.group.name = 'PuertoSolis';
    scene.add(this.group);

    this.buildLightsAndSky();
    this.buildGroundAndSea();
    this.buildBuildings();
    this.buildPalmsAndLights();
    this.buildPierAndYacht();
    this.buildHarbour();
    this.buildCustomsGarage();
  }

  buildLightsAndSky() {
    const scene = this.scene;
    scene.fog = new THREE.FogExp2(0x2b1638, 0.0016);

    const hemi = new THREE.HemisphereLight(0xff9a5c, 0x2a1638, 1.02);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffb37a, 1.75);
    sun.position.copy(SUN_DIRECTION).multiplyScalar(420);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -240;
    sun.shadow.camera.right = 240;
    sun.shadow.camera.top = 240;
    sun.shadow.camera.bottom = -240;
    sun.shadow.camera.far = 1000;
    sun.shadow.bias = -0.0006;
    scene.add(sun);
    scene.add(sun.target);
    this.sunLight = sun;

    const skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x140b29) },
        midColor: { value: new THREE.Color(0x9d2b6b) },
        horizonColor: { value: new THREE.Color(0xff8c42) },
        sunColor: { value: new THREE.Color(0xffd166) },
        sunDirection: { value: SUN_DIRECTION },
      },
      vertexShader: `
        varying vec3 vWorldDirection;
        void main() {
          vWorldDirection = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vWorldDirection;
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 horizonColor;
        uniform vec3 sunColor;
        uniform vec3 sunDirection;
        void main() {
          vec3 dir = normalize(vWorldDirection);
          float h = clamp(dir.y, -0.08, 1.0);
          vec3 sky = mix(horizonColor, midColor, smoothstep(0.0, 0.24, h));
          sky = mix(sky, topColor, smoothstep(0.18, 0.62, h));
          float sunAmount = max(dot(dir, normalize(sunDirection)), 0.0);
          sky += sunColor * pow(sunAmount, 220.0) * 1.6;
          sky += sunColor * pow(sunAmount, 10.0) * 0.34;
          sky += vec3(1.0, 0.45, 0.2) * pow(sunAmount, 3.0) * 0.16 * (1.0 - smoothstep(0.0, 0.4, h));
          gl_FragColor = vec4(sky, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 28, 18), skyMaterial);
    sky.name = 'SunsetSkyDome';
    this.group.add(sky);

    // A soft glare sprite sitting on the sun so the horizon blooms over the water.
    const glare = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.textures.glowSprite, color: 0xffc46b, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glare.position.copy(SUN_DIRECTION).multiplyScalar(1350);
    glare.scale.setScalar(620);
    this.group.add(glare);
  }

  buildGroundAndSea() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(640, 640),
      new THREE.MeshLambertMaterial({ map: this.textures.groundMap }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = 'CityGround';
    this.group.add(ground);

    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(820, 1300),
      new THREE.MeshPhongMaterial({
        map: this.textures.waterMap, shininess: 220, specular: 0xffc98a,
      }),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(CITY_LAYOUT.shoreX + 408, -0.35, 0);
    sea.name = 'SunsetSea';
    this.group.add(sea);
    this.sea = sea;
  }

  addCollider(x, z, halfW, halfD) {
    this.colliders.push({ minX: x - halfW, maxX: x + halfW, minZ: z - halfD, maxZ: z + halfD });
  }

  buildingMaterial(facade, tint) {
    const material = new THREE.MeshLambertMaterial({ map: facade.map, color: tint });
    if (facade.emissive) {
      material.emissive = new THREE.Color(0xffc98a);
      material.emissiveMap = facade.emissive;
      material.emissiveIntensity = 0.85;
    }
    return material;
  }

  addBuilding(x, z, w, d, h, facade, tint) {
    const side = this.buildingMaterial(facade, tint);
    const roof = new THREE.MeshLambertMaterial({ color: 0x2e2a38 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, roof, roof, side, side]);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.addCollider(x, z, w / 2, d / 2);
    return mesh;
  }

  buildBuildings() {
    const rng = this.random;
    const L = CITY_LAYOUT;
    const xEdges = [-320, ...L.roadXs.flatMap((x) => [x - (x === L.boulevardX ? L.boulevardHalf : L.roadHalf) - L.sidewalk, x + (x === L.boulevardX ? L.boulevardHalf : L.roadHalf) + L.sidewalk]), 118];
    const zEdges = [-320, ...L.roadZs.flatMap((z) => [z - L.roadHalf - L.sidewalk, z + L.roadHalf + L.sidewalk]), 320];
    const glass = this.textures.glassFacades;
    const deco = this.textures.decoFacades;

    for (let xi = 0; xi < xEdges.length - 1; xi += 2) {
      for (let zi = 0; zi < zEdges.length - 1; zi += 2) {
        const x0 = xEdges[xi]; const x1 = xEdges[xi + 1];
        const z0 = zEdges[zi]; const z1 = zEdges[zi + 1];
        const cx = (x0 + x1) / 2; const cz = (z0 + z1) / 2;
        const cellW = x1 - x0; const cellD = z1 - z0;
        if (cellW < 12 || cellD < 12) continue;
        if (cz < -168) continue; // harbour apron: containers instead of buildings
        if (Math.abs(cx - 10) < 24 && Math.abs(cz - 10) < 24) continue; // Corona Plaza stays open
        const downtown = Math.abs(cx) < 82 && Math.abs(cz) < 82;
        const boulevardRow = x1 >= 96; // the row facing the beach across the boulevard
        if (downtown) {
          const w = Math.min(cellW - 8, 22 + rng() * 12);
          const d = Math.min(cellD - 8, 22 + rng() * 12);
          const h = 40 + rng() * 48;
          this.addBuilding(cx + (rng() - 0.5) * 4, cz + (rng() - 0.5) * 4, w, d, h, glass[Math.floor(rng() * 3)], 0xffffff);
        } else if (boulevardRow) {
          const count = 2;
          for (let i = 0; i < count; i += 1) {
            const w = 15 + rng() * 5;
            const d = (cellD / count) - 7;
            const h = 17 + rng() * 13;
            const z = z0 + (cellD / count) * (i + 0.5);
            const hotel = this.addBuilding(cx, z, w, d, h, deco[i % 2], 0xffffff);
            this.addNeonSign(hotel, w, h);
          }
        } else {
          const count = 2 + Math.floor(rng() * 2);
          for (let i = 0; i < count; i += 1) {
            const w = 11 + rng() * 8;
            const d = 11 + rng() * 8;
            const h = 10 + rng() * 22;
            const bx = x0 + 8 + rng() * Math.max(4, cellW - 16);
            const bz = z0 + 8 + rng() * Math.max(4, cellD - 16);
            const facade = rng() < 0.55 ? glass[Math.floor(rng() * 3)] : this.textures.warehouseFacade;
            this.addBuilding(bx, bz, w, d, h, facade, 0xf2e8da);
          }
        }
      }
    }
    // Rooftop billboards with original Solis brands.
    this.addBillboard(-52, 66, 30, this.textures.signTextures.cola);
    this.addBillboard(58, -64, 34, this.textures.signTextures.banco);
  }

  addNeonSign(building, w, h) {
    const signs = [this.textures.signTextures.mariposa, this.textures.signTextures.miramar, this.textures.signTextures.cine];
    const texture = signs[Math.floor(this.random() * signs.length)];
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.min(20, w + 3), 3.1),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide }),
    );
    sign.position.set(building.position.x + w / 2 + 0.15, Math.min(h - 2.2, 13), building.position.z);
    sign.rotation.y = Math.PI / 2;
    this.group.add(sign);
  }

  addBillboard(x, z, y, texture) {
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(17, 8.5),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
    );
    board.position.set(x, y, z);
    board.rotation.y = Math.PI / 5;
    this.group.add(board);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, y - 4, 8),
      new THREE.MeshLambertMaterial({ color: 0x3a3f4a }),
    );
    pole.position.set(x, (y - 4) / 2, z);
    this.group.add(pole);
  }

  makePalm(x, z, height = 7.5) {
    const rng = this.random;
    const palm = new THREE.Group();
    const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x8a6a4a });
    const lean = (rng() - 0.5) * 0.22;
    let px = 0; let pz = 0;
    const segments = 4;
    for (let i = 0; i < segments; i += 1) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.22 - i * 0.03, 0.26 - i * 0.03, height / segments + 0.2, 6), trunkMaterial);
      px += lean * (height / segments) * i * 0.4;
      seg.position.set(px, (height / segments) * (i + 0.5), pz);
      seg.rotation.z = -lean;
      seg.castShadow = true;
      palm.add(seg);
    }
    const topX = px + lean * height * 0.35;
    const frondMaterial = new THREE.MeshLambertMaterial({
      map: this.textures.palmFrond, alphaTest: 0.4, side: THREE.DoubleSide,
    });
    for (let i = 0; i < 7; i += 1) {
      const frond = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 3.6), frondMaterial);
      frond.geometry.translate(0, 1.8, 0);
      frond.position.set(topX, height, pz);
      frond.rotation.set(0.9 + rng() * 0.35, (i / 7) * Math.PI * 2, 0, 'YXZ');
      palm.add(frond);
    }
    palm.position.set(x, 0, z);
    this.group.add(palm);
    this.addCollider(x, z, 0.4, 0.4);
    return palm;
  }

  makeStreetlight(x, z) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, 6.4, 6),
      new THREE.MeshLambertMaterial({ color: 0x2f3542 }),
    );
    pole.position.set(x, 3.2, z);
    this.group.add(pole);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.18, 1.1),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
    );
    head.position.set(x, 6.4, z);
    this.group.add(head);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.textures.glowSprite, color: 0xffbe78, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.position.set(x, 6.4, z);
    glow.scale.setScalar(4.2);
    this.group.add(glow);
  }

  buildPalmsAndLights() {
    const L = CITY_LAYOUT;
    for (let z = -252; z <= 258; z += 15) {
      if (z > 8 && z < 40) continue; // keep the pier entrance clear
      this.makePalm(116.5, z + (this.random() - 0.5) * 3, 7 + this.random() * 2.5);
    }
    for (let i = 0; i < 26; i += 1) {
      this.makePalm(126 + this.random() * 20, -260 + this.random() * 520, 6.5 + this.random() * 3);
    }
    for (let z = -240; z <= 250; z += 27) {
      this.makeStreetlight(L.boulevardX - L.boulevardHalf - 1.6, z);
      this.makeStreetlight(L.boulevardX + L.boulevardHalf + 1.6, z + 13);
    }
    for (const x of L.roadXs) {
      for (const z of L.roadZs) {
        if (x === L.boulevardX) continue;
        this.makeStreetlight(x - L.roadHalf - 1.6, z - L.roadHalf - 1.6);
      }
    }
  }

  buildPierAndYacht() {
    const wood = new THREE.MeshLambertMaterial({ map: this.textures.woodMap });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(66, 0.5, 13), wood);
    deck.position.set(179, 0.32, 23);
    deck.receiveShadow = true;
    deck.name = 'PlayaCoralPier';
    this.group.add(deck);
    this.pierDeck = { minX: 146, maxX: 212, minZ: 16.5, maxZ: 29.5, height: 0.57 };
    const pileMaterial = new THREE.MeshLambertMaterial({ color: 0x5d4630 });
    for (let x = 150; x <= 210; x += 10) {
      for (const z of [18, 28]) {
        const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 3.4, 6), pileMaterial);
        pile.position.set(x, -0.9, z);
        this.group.add(pile);
      }
    }
    for (let x = 156; x <= 206; x += 12.5) {
      this.makeStreetlight(x, 17.6);
    }
    // The getaway yacht anchored offshore — mission 4's rendezvous.
    const yacht = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(16, 2.6, 5), new THREE.MeshLambertMaterial({ color: 0xf4f6f8 }));
    hull.position.y = 0.8;
    yacht.add(hull);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(8, 2.2, 3.8), new THREE.MeshLambertMaterial({ color: 0x9fd8e8 }));
    cabin.position.set(-1, 3, 0);
    yacht.add(cabin);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 9, 6), new THREE.MeshLambertMaterial({ color: 0xcccccc }));
    mast.position.set(3, 6.5, 0);
    yacht.add(mast);
    yacht.position.set(330, 0, 46);
    yacht.rotation.y = 0.5;
    this.group.add(yacht);
    this.yacht = yacht;
    this.yachtPosition = new THREE.Vector3(330, 0, 46);
  }

  buildHarbour() {
    const rng = this.random;
    const colours = [0xc23b2e, 0x2e6fc2, 0xe0a51e, 0x2ea88a, 0xd96c2e, 0x7a4fc2];
    const containerGeo = new THREE.BoxGeometry(6.1, 2.6, 2.45);
    for (let i = 0; i < 64; i += 1) {
      const x = -238 + rng() * 360;
      const z = -292 + rng() * 104;
      if (Math.abs(x + 200) < 9 || Math.abs(x + 140) < 9 || Math.abs(x + 80) < 9) continue;
      if (Math.abs(z + 200) < 9) continue;
      const stack = 1 + Math.floor(rng() * 3);
      for (let s = 0; s < stack; s += 1) {
        const box = new THREE.Mesh(containerGeo, new THREE.MeshLambertMaterial({ color: colours[Math.floor(rng() * colours.length)] }));
        box.position.set(x, 1.3 + s * 2.6, z);
        box.rotation.y = rng() < 0.5 ? 0 : Math.PI / 2;
        box.castShadow = true;
        this.group.add(box);
      }
      this.addCollider(x, z, 3.2, 3.2);
    }
    // Two simple gantry cranes silhouetted against the sunset.
    for (const cx of [-120, 30]) {
      const crane = new THREE.Group();
      const steel = new THREE.MeshLambertMaterial({ color: 0x37404e });
      for (const dz of [-7, 7]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 21, 1.2), steel);
        leg.position.set(0, 10.5, dz);
        crane.add(leg);
      }
      const jib = new THREE.Mesh(new THREE.BoxGeometry(26, 1.4, 1.4), steel);
      jib.position.set(6, 21, 0);
      crane.add(jib);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 2.6), new THREE.MeshLambertMaterial({ color: 0xe0a51e }));
      cab.position.set(12, 19.4, 0);
      crane.add(cab);
      crane.position.set(cx, 0, -238);
      this.group.add(crane);
      this.addCollider(cx, -238, 2, 8.5);
    }
    // A stunt ramp on the harbour apron: drive up the harbour road's west end and fly.
    const ramp = new THREE.Mesh(
      new THREE.BoxGeometry(10, 0.4, 7),
      new THREE.MeshLambertMaterial({ color: 0x8f96a3 }),
    );
    ramp.position.set(-226, 1.35, -200);
    ramp.rotation.z = 0.42;
    this.group.add(ramp);
    this.ramp = { minX: -231, maxX: -221, minZ: -203.5, maxZ: -196.5, height: 2.6, alongX: true };
  }

  buildCustomsGarage() {
    const walls = new THREE.MeshLambertMaterial({ color: 0x4a4f5e });
    const accent = new THREE.MeshLambertMaterial({ color: 0x1e8f6e });
    const gx = -171; const gz = 64;
    const back = new THREE.Mesh(new THREE.BoxGeometry(26, 8, 1), walls);
    back.position.set(gx, 4, gz + 14);
    this.group.add(back);
    this.addCollider(gx, gz + 14, 13, 0.6);
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 8, 28), walls);
      wall.position.set(gx + side * 13, 4, gz);
      this.group.add(wall);
      this.addCollider(gx + side * 13, gz, 0.6, 14);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(28, 0.8, 30), accent);
    roof.position.set(gx, 8.4, gz);
    roof.castShadow = true;
    this.group.add(roof);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(21, 3.3),
      new THREE.MeshBasicMaterial({ map: this.textures.signTextures.customs, transparent: true, side: THREE.DoubleSide }),
    );
    sign.position.set(gx, 6.8, gz - 14.6);
    sign.rotation.y = Math.PI;
    this.group.add(sign);
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(15, 11),
      new THREE.MeshBasicMaterial({ color: 0x2affc4, transparent: true, opacity: 0.16, side: THREE.DoubleSide }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.rotation.z = Math.PI;
    pad.position.set(gx, 0.06, gz - 6);
    this.group.add(pad);
    const lamp = new THREE.PointLight(0x3affc0, 60, 30, 1.8);
    lamp.position.set(gx, 5.5, gz);
    this.group.add(lamp);
    this.customsPad = { minX: gx - 7.5, maxX: gx + 7.5, minZ: gz - 11.5, maxZ: gz - 0.5 };
    this.customsPosition = new THREE.Vector3(gx, 0, gz - 6);
  }

  /** Height of the drivable surface at (x, z): pier deck and the stunt ramp rise above 0. */
  groundHeightAt(x, z) {
    const p = this.pierDeck;
    if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) return p.height;
    const r = this.ramp;
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
      return ((x - r.minX) / (r.maxX - r.minX)) * r.height;
    }
    return 0;
  }

  isWater(x, z) {
    if (x <= CITY_LAYOUT.shoreX) return false;
    const p = this.pierDeck;
    if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) return false;
    return true;
  }

  /** Push a circle at (x, z) out of every building AABB; returns true when it hit something. */
  resolveCircle(position, radius) {
    let hit = false;
    for (const c of this.colliders) {
      const nearX = Math.max(c.minX, Math.min(position.x, c.maxX));
      const nearZ = Math.max(c.minZ, Math.min(position.z, c.maxZ));
      const dx = position.x - nearX;
      const dz = position.z - nearZ;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      hit = true;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        position.x = nearX + (dx / d) * radius;
        position.z = nearZ + (dz / d) * radius;
      } else {
        // centre inside the box: leave by the shallowest face
        const left = position.x - c.minX; const right = c.maxX - position.x;
        const top = position.z - c.minZ; const bottom = c.maxZ - position.z;
        const min = Math.min(left, right, top, bottom);
        if (min === left) position.x = c.minX - radius;
        else if (min === right) position.x = c.maxX + radius;
        else if (min === top) position.z = c.minZ - radius;
        else position.z = c.maxZ + radius;
      }
    }
    return hit;
  }

  districtAt(x, z) {
    if (x > 112) return 'PLAYA CORAL';
    if (z < -168) return 'MUELLE NORTE';
    if (Math.abs(x) < 84 && Math.abs(z) < 84) return 'CORONA DOWNTOWN';
    if (x < -150) return 'COSTA OESTE';
    return 'SOLIS CENTRE';
  }

  update(dt, elapsed) {
    this.textures.waterMap.offset.x = (elapsed * 0.008) % 1;
    this.textures.waterMap.offset.y = Math.sin(elapsed * 0.11) * 0.02;
    if (this.yacht) {
      this.yacht.position.y = Math.sin(elapsed * 0.7) * 0.22;
      this.yacht.rotation.z = Math.sin(elapsed * 0.5) * 0.02;
    }
  }
}
