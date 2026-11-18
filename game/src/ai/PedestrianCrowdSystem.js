// PedestrianCrowdSystem — the walking population of Puerto Solis. Citizens are
// articulated low-poly figures (built here, shared with the campaign's guards)
// who stroll the promenade, the pier and the sidewalks, cross at intersections,
// scatter in panic from gunfire and reckless cars, and — when the player rips a
// driver out of a traffic car — sprint away from the hijack. A citizen knocked
// down fades back into the crowd at a fresh sidewalk after a while, so the
// streets never empty out.
import * as THREE from 'three';
import { CITY_LAYOUT } from '../world/SunsetCoastalCity.js';
import { createSeededRandom } from '../world/ProceduralCityTextures.js';

const SHIRT_COLOURS = [0xef476f, 0xffd166, 0x06d6a0, 0x118ab2, 0xf78c6b, 0x9b5de5, 0xf2f2f2, 0x2ec4b6];
const PANTS_COLOURS = [0x2b2d42, 0x3d405b, 0x6c5849, 0x274156, 0x8d99ae];
const SKIN_COLOURS = [0xe0ac69, 0xc68863, 0x8d5524, 0xffdbac, 0x6f4423];
const HAIR_COLOURS = [0x201409, 0x4a2c14, 0x777777, 0xd9b380, 0xb03a2e];

/**
 * Build one articulated humanoid figure. Limbs hang from shoulder/hip pivots so
 * animateHumanoid can swing them; the returned object keeps every part named.
 */
export function createHumanoidFigure({ shirt = 0xef476f, pants = 0x2b2d42, skin = 0xe0ac69, hair = 0x201409 } = {}) {
  const group = new THREE.Group();
  const skinMat = new THREE.MeshLambertMaterial({ color: skin });
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const pantsMat = new THREE.MeshLambertMaterial({ color: pants });
  const hairMat = new THREE.MeshLambertMaterial({ color: hair });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.8, 0.4), shirtMat);
  torso.position.y = 1.26;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.42, 0.4), skinMat);
  head.position.y = 1.9;
  group.add(head);
  const hairCap = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.16, 0.44), hairMat);
  hairCap.position.y = 2.08;
  group.add(hairCap);

  const limb = (w, h, d, mat) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(0, -h / 2, 0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    return mesh;
  };
  const armL = limb(0.22, 0.74, 0.24, shirtMat);
  armL.position.set(-0.48, 1.62, 0);
  group.add(armL);
  const armR = limb(0.22, 0.74, 0.24, shirtMat);
  armR.position.set(0.48, 1.62, 0);
  group.add(armR);
  const legL = limb(0.28, 0.84, 0.3, pantsMat);
  legL.position.set(-0.19, 0.88, 0);
  group.add(legL);
  const legR = limb(0.28, 0.84, 0.3, pantsMat);
  legR.position.set(0.19, 0.88, 0);
  group.add(legR);
  torso.castShadow = true;
  head.castShadow = true;
  return { group, torso, head, armL, armR, legL, legR };
}

/** Swing a figure's arms and legs for a walk cycle; `amount` scales the stride. */
export function animateHumanoid(figure, phase, amount) {
  const swing = Math.sin(phase) * 0.6 * amount;
  figure.legL.rotation.x = swing;
  figure.legR.rotation.x = -swing;
  figure.armL.rotation.x = -swing * 0.75;
  figure.armR.rotation.x = swing * 0.75;
}

class Citizen {
  constructor(scene, rng) {
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    this.figure = createHumanoidFigure({
      shirt: pick(SHIRT_COLOURS), pants: pick(PANTS_COLOURS), skin: pick(SKIN_COLOURS), hair: pick(HAIR_COLOURS),
    });
    this.group = this.figure.group;
    scene.add(this.group);
    this.health = 100;
    this.dead = false;
    this.state = 'walk'; // walk | panic | down
    this.phase = rng() * 10;
    this.walkSpeed = 1.4 + rng() * 1.2;
    this.panicTimer = 0;
    this.downTimer = 0;
    this.threat = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.heading = 0;
    this.placeOnSidewalk(rng);
  }

  /** Drop the citizen on a random stroll lane: promenade, pier, or a sidewalk. */
  placeOnSidewalk(rng) {
    const L = CITY_LAYOUT;
    const roll = rng();
    if (roll < 0.3) {
      const z = -248 + rng() * 496;
      this.group.position.set(115.5 + (rng() - 0.5) * 2.4, 0, z);
      this.target.set(this.group.position.x, 0, z + (rng() < 0.5 ? -110 : 110));
    } else if (roll < 0.42) {
      this.group.position.set(152 + rng() * 54, 0.57, 19 + rng() * 8);
      this.target.set(152 + rng() * 54, 0.57, 23);
    } else if (rng() < 0.5) {
      const road = L.roadXs[Math.floor(rng() * L.roadXs.length)];
      const half = (road === L.boulevardX ? L.boulevardHalf : L.roadHalf) + 1.9;
      const x = road + (rng() < 0.5 ? -half : half);
      const z = -248 + rng() * 496;
      this.group.position.set(x, 0, z);
      this.target.set(x, 0, z + (rng() < 0.5 ? -120 : 120));
    } else {
      const road = L.roadZs[Math.floor(rng() * L.roadZs.length)];
      const z = road + (rng() < 0.5 ? -(L.roadHalf + 1.9) : L.roadHalf + 1.9);
      const x = -248 + rng() * 380;
      this.group.position.set(x, 0, z);
      this.target.set(x + (rng() < 0.5 ? -120 : 120), 0, z);
    }
    this.heading = Math.atan2(this.target.x - this.group.position.x, this.target.z - this.group.position.z);
    this.group.rotation.set(0, this.heading, 0);
  }
}

export class PedestrianCrowdSystem {
  constructor(scene, city) {
    this.scene = scene;
    this.city = city;
    this.rng = createSeededRandom(90210);
    this.citizens = [];
    this.onCitizenDown = null; // (citizen, cause) => void — wanted/cash hooks
    this.elapsed = 0;
    for (let i = 0; i < 42; i += 1) this.citizens.push(new Citizen(scene, this.rng));
  }

  /** Gunfire at `position`: everyone within earshot runs from it. */
  notifyGunshot(position) {
    for (const citizen of this.citizens) {
      if (citizen.dead) continue;
      if (citizen.group.position.distanceTo(position) < 34) {
        citizen.state = 'panic';
        citizen.panicTimer = 2.4 + this.rng() * 1.6;
        citizen.threat.copy(position);
      }
    }
  }

  /** A hijacked driver appears at the car door and sprints away from it. */
  ejectDriverAt(position, heading) {
    let chosen = null;
    for (const citizen of this.citizens) {
      if (!citizen.dead && citizen.group.position.distanceTo(position) > 60) { chosen = citizen; break; }
    }
    if (!chosen) chosen = this.citizens[0];
    chosen.dead = false;
    chosen.health = 100;
    chosen.group.rotation.x = 0;
    chosen.group.position.copy(position);
    chosen.group.position.y = this.city.groundHeightAt(position.x, position.z);
    chosen.state = 'panic';
    chosen.panicTimer = 3.2;
    chosen.threat.set(position.x - Math.sin(heading) * 6, 0, position.z - Math.cos(heading) * 6);
    return chosen;
  }

  /** Hurt a citizen; returns true when this hit takes them down. */
  damageCitizen(citizen, amount, cause) {
    if (citizen.dead) return false;
    citizen.health -= amount;
    if (citizen.health > 0) {
      citizen.state = 'panic';
      citizen.panicTimer = Math.max(citizen.panicTimer, 2.2);
      citizen.threat.copy(citizen.group.position);
      return false;
    }
    citizen.dead = true;
    citizen.state = 'down';
    citizen.downTimer = 9 + this.rng() * 6;
    citizen.group.rotation.x = -Math.PI / 2;
    citizen.group.position.y = this.city.groundHeightAt(citizen.group.position.x, citizen.group.position.z) + 0.25;
    if (this.onCitizenDown) this.onCitizenDown(citizen, cause);
    return true;
  }

  update(dt, vehicles, playerVehicle) {
    this.elapsed += dt;
    const rng = this.rng;
    for (const citizen of this.citizens) {
      const pos = citizen.group.position;
      if (citizen.state === 'down') {
        citizen.downTimer -= dt;
        if (citizen.downTimer <= 0) {
          citizen.dead = false;
          citizen.health = 100;
          citizen.state = 'walk';
          citizen.group.rotation.x = 0;
          citizen.placeOnSidewalk(rng);
        }
        continue;
      }

      // Cars are the crowd's mortal enemy: dive away from anything fast and
      // close, and go down if it actually connects.
      let dangerCar = null;
      for (const vehicle of vehicles) {
        if (vehicle.kind === 'boat') continue;
        const d = pos.distanceTo(vehicle.position);
        if (d > 6) continue;
        const speed = Math.abs(vehicle.forwardSpeed());
        if (d < 1.25 && speed > 2.5) {
          citizen.threat.copy(vehicle.position);
          this.damageCitizen(citizen, 1000, 'vehicle');
          break;
        }
        if (speed > 6 && d < 5) dangerCar = vehicle;
      }
      if (citizen.state === 'down') continue;
      if (dangerCar && citizen.state !== 'panic') {
        citizen.state = 'panic';
        citizen.panicTimer = 1.4;
        citizen.threat.copy(dangerCar.position);
      }

      let speed = citizen.walkSpeed;
      let goal = citizen.target;
      if (citizen.state === 'panic') {
        citizen.panicTimer -= dt;
        speed = 5.6;
        if (citizen.panicTimer <= 0) citizen.state = 'walk';
      }
      const dx = goal.x - pos.x;
      const dz = goal.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (citizen.state !== 'panic' && dist < 2.2) {
        // Reached the end of the stroll: turn around or wander to a new lane.
        if (rng() < 0.72) {
          citizen.target.set(pos.x - dx, 0, pos.z - dz);
        } else {
          citizen.placeOnSidewalk(rng);
        }
        continue;
      }
      let dirX;
      let dirZ;
      if (citizen.state === 'panic') {
        dirX = pos.x - citizen.threat.x;
        dirZ = pos.z - citizen.threat.z;
        const len = Math.hypot(dirX, dirZ) || 1;
        dirX /= len; dirZ /= len;
      } else {
        dirX = dx / (dist || 1);
        dirZ = dz / (dist || 1);
      }
      const nextX = pos.x + dirX * speed * dt;
      const nextZ = pos.z + dirZ * speed * dt;
      const walkable = (x, z) => !this.city.isWater(x, z) || this.city.groundHeightAt(x, z) > 0;
      if (walkable(nextX, nextZ)) {
        pos.x = Math.max(-258, Math.min(232, nextX));
        pos.z = Math.max(-258, Math.min(258, nextZ));
      } else if (citizen.state === 'panic') {
        // Slide along the shoreline instead of freezing against it: try
        // each axis on its own so a panicking citizen still escapes.
        if (walkable(nextX, pos.z)) pos.x = Math.max(-258, Math.min(232, nextX));
        else if (walkable(pos.x, nextZ)) pos.z = Math.max(-258, Math.min(258, nextZ));
      }
      this.city.resolveCircle(pos, 0.4);
      pos.y = this.city.groundHeightAt(pos.x, pos.z);
      const targetHeading = Math.atan2(dirX, dirZ);
      let diff = targetHeading - citizen.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      citizen.heading += diff * Math.min(1, dt * 8);
      citizen.group.rotation.y = citizen.heading;
      citizen.phase += dt * speed * 2.4;
      animateHumanoid(citizen.figure, citizen.phase, citizen.state === 'panic' ? 1.25 : 0.85);
    }
  }
}
