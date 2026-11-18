// WeaponsAndProjectiles — Val's four ways to make trouble: her fists, the
// Solis 9mm pistol, the Pulso micro-SMG and the Costa tactical shotgun. Shots
// are genuine raycasts: every pellet is tested against the city's building
// boxes and against every registered hittable (citizens, syndicate guards,
// officers, vehicles), then drawn as a short-lived glowing tracer with a
// muzzle flash and a burst of impact sparks. The same module resolves the
// shots fired AT the player by guards and the SPD, and runs the cash and
// ammunition pickups that trouble leaves behind.
import * as THREE from 'three';

export const WEAPONS = [
  { id: 'unarmed', name: 'UNARMED', damage: 26, rate: 0.42, auto: false, spread: 0, pellets: 1, range: 2.4, ammo: Infinity },
  { id: 'pistol', name: 'SOLIS 9MM', damage: 34, rate: 0.27, auto: false, spread: 0.007, pellets: 1, range: 120, ammo: Infinity },
  { id: 'smg', name: 'PULSO MICRO-SMG', damage: 15, rate: 0.095, auto: true, spread: 0.023, pellets: 1, range: 110, ammo: 320 },
  { id: 'shotgun', name: 'COSTA TACTICAL', damage: 13, rate: 0.85, auto: false, spread: 0.05, pellets: 5, range: 55, ammo: 48 },
];

const TRACER_POOL = 56;

/** Ray vs a ground-standing box (XZ slab test, generous height band). */
function rayBuilding(origin, dir, box) {
  let near = 0;
  let far = Infinity;
  const axes = [
    [origin.x, dir.x, box.minX, box.maxX],
    [origin.z, dir.z, box.minZ, box.maxZ],
  ];
  for (const [o, d, mn, mx] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < mn || o > mx) return Infinity;
    } else {
      let t1 = (mn - o) / d;
      let t2 = (mx - o) / d;
      if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; }
      near = Math.max(near, t1);
      far = Math.min(far, t2);
      if (near > far) return Infinity;
    }
  }
  const y = origin.y + dir.y * near;
  if (y < -0.5 || y > 95) return Infinity;
  return near;
}

/** Ray vs a sphere; returns the entry distance or Infinity. */
function raySphere(origin, dir, centre, radius) {
  const ox = centre.x - origin.x;
  const oy = centre.y - origin.y;
  const oz = centre.z - origin.z;
  const along = ox * dir.x + oy * dir.y + oz * dir.z;
  if (along < 0) return Infinity;
  const d2 = ox * ox + oy * oy + oz * oz - along * along;
  const r2 = radius * radius;
  if (d2 > r2) return Infinity;
  return Math.max(0, along - Math.sqrt(r2 - d2));
}

export class WeaponsAndProjectiles {
  constructor(scene, city, effects, audio, textures) {
    this.scene = scene;
    this.city = city;
    this.effects = effects;
    this.audio = audio;
    this.index = 0;
    this.ammo = { smg: 320, shotgun: 48 };
    this.cooldown = 0;
    this.wasFiring = false;
    this.hittables = [];
    this.pickups = [];
    this.onCrime = null; // (kind, position) => void
    this.onPlayerHit = null; // (damage) => void
    this.onPickup = null; // (kind, amount) => void

    // Tracer pool: one additive line per recent pellet, recycled round-robin.
    this.tracers = [];
    this.tracerCursor = 0;
    for (let i = 0; i < TRACER_POOL; i += 1) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const material = new THREE.LineBasicMaterial({
        color: 0xffd76a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const line = new THREE.Line(geometry, material);
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }

    // Muzzle flash: a glow sprite plus a short point light at the gun hand.
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: textures.glowSprite, color: 0xffcf7a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.flash.scale.setScalar(1.15);
    scene.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffb45e, 0, 13, 1.9);
    scene.add(this.flashLight);
    this.flashLife = 0;

    this.pickupMaterials = {
      cash: new THREE.MeshLambertMaterial({ color: 0x2fae5f, emissive: 0x0d5c2a }),
      ammo: new THREE.MeshLambertMaterial({ color: 0xe07b26, emissive: 0x6e3405 }),
    };
    this.pickupGeometry = new THREE.BoxGeometry(0.55, 0.34, 0.55);
    this.glowTexture = textures.glowSprite;
  }

  get weapon() {
    return WEAPONS[this.index];
  }

  ammoText() {
    const w = this.weapon;
    if (w.ammo === Infinity) return '∞';
    return String(Math.max(0, this.ammo[w.id] ?? 0));
  }

  select(index) {
    if (index >= 0 && index < WEAPONS.length) this.index = index;
    return this.weapon;
  }

  cycle(delta) {
    this.index = (this.index + delta + WEAPONS.length) % WEAPONS.length;
    return this.weapon;
  }

  giveAmmo(weaponId, amount) {
    if (weaponId in this.ammo) this.ammo[weaponId] += amount;
  }

  registerHittable(entry) {
    if (!this.hittables.includes(entry)) this.hittables.push(entry);
    return entry;
  }

  unregisterHittable(entry) {
    const i = this.hittables.indexOf(entry);
    if (i >= 0) this.hittables.splice(i, 1);
  }

  /** Draw one tracer segment; it fades inside `update` over ~80 ms. */
  spawnTracer(from, to, color = 0xffd76a) {
    const slot = this.tracers[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % TRACER_POOL;
    const attr = slot.line.geometry.attributes.position;
    attr.setXYZ(0, from.x, from.y, from.z);
    attr.setXYZ(1, to.x, to.y, to.z);
    attr.needsUpdate = true;
    slot.line.material.color.setHex(color);
    slot.line.material.opacity = 0.95;
    slot.line.visible = true;
    slot.life = 0.085;
  }

  spawnPickup(position, amount, kind, weaponId = null) {
    const group = new THREE.Group();
    const box = new THREE.Mesh(this.pickupGeometry, this.pickupMaterials[kind]);
    box.position.y = 0.55;
    group.add(box);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTexture, color: kind === 'cash' ? 0x3dff8e : 0xffa62b,
      transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.setScalar(2.1);
    glow.position.y = 0.6;
    group.add(glow);
    group.position.copy(position);
    group.position.y = this.city.groundHeightAt(position.x, position.z);
    this.scene.add(group);
    this.pickups.push({ group, kind, amount, weaponId, phase: Math.random() * 6 });
  }

  spawnCashPickup(position, amount) {
    this.spawnPickup(position, amount, 'cash');
  }

  spawnAmmoPickup(position, weaponId, amount) {
    this.spawnPickup(position, amount, 'ammo', weaponId);
  }

  /** Nearest ray hit among buildings, hittables and the ground plane. */
  castRay(origin, dir, maxRange) {
    let bestT = maxRange;
    let bestEntry = null;
    for (const box of this.city.colliders) {
      const t = rayBuilding(origin, dir, box);
      if (t < bestT) { bestT = t; bestEntry = null; }
    }
    const centre = new THREE.Vector3();
    for (const entry of this.hittables) {
      if (entry.dead) continue;
      const p = entry.getPosition();
      centre.set(p.x, p.y + (entry.centreHeight ?? 1.0), p.z);
      const t = raySphere(origin, dir, centre, entry.radius ?? 0.62);
      if (t < bestT) { bestT = t; bestEntry = entry; }
    }
    if (dir.y < -0.001) {
      // Ground plane at the local surface height, so shots thud into the
      // pier deck instead of the sea-level plane running beneath it.
      let tGround = -origin.y / dir.y;
      if (tGround > 0) {
        const surface = this.city.groundHeightAt(origin.x + dir.x * tGround, origin.z + dir.z * tGround);
        if (surface > 0.01) tGround = (surface - origin.y) / dir.y;
        if (tGround > 0 && tGround < bestT) { bestT = tGround; bestEntry = null; }
      }
    }
    return { t: bestT, entry: bestEntry, point: origin.clone().addScaledVector(dir, bestT) };
  }

  /**
   * The player's trigger. Call every frame with the frame's dt, whether the
   * trigger is held, the camera's aim origin/direction and the muzzle world
   * position. Returns true on the frames a shot actually leaves the gun.
   */
  tryFire(dt, firing, aimOrigin, aimDir, muzzle) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const w = this.weapon;
    const triggerEdge = firing && !this.wasFiring;
    this.wasFiring = firing;
    if (!firing || this.cooldown > 0) return false;
    if (!w.auto && !triggerEdge) return false;
    if (w.ammo !== Infinity && (this.ammo[w.id] ?? 0) <= 0) {
      this.cooldown = 0.3;
      if (this.audio) this.audio.blip('alarm');
      return false;
    }
    this.cooldown = w.rate;
    if (w.ammo !== Infinity) this.ammo[w.id] -= 1;

    if (w.id === 'unarmed') {
      // A swing: anything hittable inside arm's reach and the aim cone falls.
      let struck = false;
      for (const entry of this.hittables) {
        if (entry.dead) continue;
        const p = entry.getPosition();
        const dx = p.x - aimOrigin.x;
        const dz = p.z - aimOrigin.z;
        const dist = Math.hypot(dx, dz);
        if (dist > w.range + (entry.radius ?? 0.6)) continue;
        if (dist > 0.4 && (dx * aimDir.x + dz * aimDir.z) / (dist || 1) < 0.35) continue;
        entry.onHit(w.damage, { weapon: w.id, point: p });
        struck = true;
      }
      if (this.audio) this.audio.shot('unarmed');
      if (struck && this.onCrime) this.onCrime('assault', muzzle);
      return true;
    }

    let anyHit = false;
    for (let pellet = 0; pellet < w.pellets; pellet += 1) {
      const dir = aimDir.clone();
      dir.x += (Math.random() - 0.5) * 2 * w.spread;
      dir.y += (Math.random() - 0.5) * 2 * w.spread;
      dir.z += (Math.random() - 0.5) * 2 * w.spread;
      dir.normalize();
      const hit = this.castRay(aimOrigin, dir, w.range);
      this.spawnTracer(muzzle, hit.point, 0xffd76a);
      if (hit.entry) {
        hit.entry.onHit(w.damage, { weapon: w.id, point: hit.point });
        anyHit = true;
      } else if (this.effects) {
        this.effects.sparks.burst(hit.point, 3, { speed: 2.2, life: 0.3 });
      }
    }
    this.flash.position.copy(muzzle);
    this.flash.material.opacity = 0.95;
    this.flashLife = 0.05;
    this.flashLight.position.copy(muzzle);
    this.flashLight.intensity = 26;
    if (this.audio) this.audio.shot(w.id);
    if (this.onCrime) this.onCrime(anyHit ? 'gunfireHit' : 'gunfire', muzzle);
    return true;
  }

  /**
   * A shot fired at the player by a guard or officer. Accuracy falls with
   * range; the tracer always shows, and a hit reports through onPlayerHit.
   */
  enemyFire(from, targetPos, { damage = 6, range = 42, tracerColor = 0xff9a5c } = {}) {
    const dist = from.distanceTo(targetPos);
    if (dist > range) return false;
    const aim = targetPos.clone();
    aim.y += 1.15;
    const hitChance = Math.max(0.12, Math.min(0.58, 0.66 - dist * 0.011));
    const hit = Math.random() < hitChance;
    if (!hit) {
      aim.x += (Math.random() - 0.5) * 3.2;
      aim.y += Math.random() * 1.4;
      aim.z += (Math.random() - 0.5) * 3.2;
    }
    const muzzle = from.clone();
    muzzle.y += 1.45;
    this.spawnTracer(muzzle, aim, tracerColor);
    if (this.audio && dist < 55) this.audio.shot('pistol');
    if (hit && this.onPlayerHit) this.onPlayerHit(damage);
    return hit;
  }

  update(dt, playerPos) {
    for (const slot of this.tracers) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      slot.line.material.opacity = Math.max(0, slot.life / 0.085) * 0.95;
      if (slot.life <= 0) slot.line.visible = false;
    }
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      const k = Math.max(0, this.flashLife / 0.05);
      this.flash.material.opacity = k * 0.95;
      this.flashLight.intensity = k * 26;
    } else {
      this.flash.material.opacity = 0;
      this.flashLight.intensity = 0;
    }
    for (let i = this.pickups.length - 1; i >= 0; i -= 1) {
      const pickup = this.pickups[i];
      pickup.phase += dt * 3.2;
      pickup.group.rotation.y = pickup.phase;
      pickup.group.children[0].position.y = 0.55 + Math.sin(pickup.phase * 1.4) * 0.12;
      if (playerPos && pickup.group.position.distanceTo(playerPos) < 1.7) {
        if (pickup.kind === 'cash') {
          if (this.onPickup) this.onPickup('cash', pickup.amount);
        } else {
          this.giveAmmo(pickup.weaponId, pickup.amount);
          if (this.onPickup) this.onPickup('ammo', pickup.amount);
        }
        if (this.audio) this.audio.blip(pickup.kind === 'cash' ? 'cash' : 'pickup');
        this.scene.remove(pickup.group);
        this.pickups.splice(i, 1);
      }
    }
  }
}
